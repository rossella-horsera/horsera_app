"""
Horsera Pose Pipeline — v6 (ONNX Runtime + Smart Crop)
YOLOv8m-pose inference via ONNX Runtime — no PyTorch at runtime.
Smart cropping for improved pose accuracy, horse-aware detection, CAE preprocessing, APS v4 scoring.

Key improvements over v5:
- Upgraded to YOLOv8m (medium) models for better accuracy
- Smart cropping: detect horse bbox, expand with padding, scale up for higher effective resolution
- Rolling/adaptive crop with optional EMA smoothing for temporal stability
- ~3-4x effective resolution increase on rider pose estimation

Memory budget: ~300 MB peak (medium models are larger than small/nano).
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass, asdict
from typing import Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── COCO keypoint indices ─────────────────────────────────────────────────────
KP = {
    "nose": 0, "left_eye": 1, "right_eye": 2,
    "left_ear": 3, "right_ear": 4,
    "left_shoulder": 5, "right_shoulder": 6,
    "left_elbow": 7, "right_elbow": 8,
    "left_wrist": 9, "right_wrist": 10,
    "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14,
    "left_ankle": 15, "right_ankle": 16,
}

HORSE_CLASS_ID = 17      # COCO class 17 = horse
CONF_THRESH    = 0.35    # minimum keypoint confidence accepted
DET_CONF       = 0.30    # minimum horse detection confidence (lowered for better recall)
SAMPLE_FPS     = 1       # default sampling rate for full-video analysis
INPUT_SIZE     = 640     # YOLO input resolution

# Smart crop configuration
CROP_PADDING_FACTOR = 0.20    # expand horse bbox by 20%
CROP_TOP_PADDING    = 0.50    # extra top padding for rider's head (50% of bbox height)
CROP_EMA_ALPHA      = 0.3     # EMA smoothing factor (0 = no smoothing, 1 = no memory)
CROP_JUMP_THRESHOLD = 0.15    # reset EMA if bbox jumps > 15% of frame dimension
CROP_OUTPUT_HEIGHT  = 640     # target height for cropped region (maintains aspect ratio)

_MODEL_DIR = os.path.dirname(os.path.abspath(__file__))


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class BiometricsResult:
    lowerLegStability:   float
    reinSteadiness:      float
    reinSymmetry:        float
    coreStability:       float
    upperBodyAlignment:  float
    pelvisStability:     float


@dataclass
class RidingQualityResult:
    rhythm:       float
    relaxation:   float
    contact:      float
    impulsion:    float
    straightness: float
    balance:      float


@dataclass
class PipelineResult:
    biometrics:    BiometricsResult
    ridingQuality: RidingQualityResult
    overallScore:  float
    detectionRate: float
    caeIndex:      float
    apsScore:      float
    framesAnalyzed: int
    framesTotal:   int
    insights:      list[str]
    frames_data:   list[dict]

    def to_dict(self) -> dict:
        return {
            "biometrics":     asdict(self.biometrics),
            "ridingQuality":  asdict(self.ridingQuality),
            "overallScore":   self.overallScore,
            "detectionRate":  self.detectionRate,
            "caeIndex":       self.caeIndex,
            "apsScore":       self.apsScore,
            "framesAnalyzed": self.framesAnalyzed,
            "framesTotal":    self.framesTotal,
            "insights":       self.insights,
            "framesData":     self.frames_data,
        }


# ── ONNX Session Loading ──────────────────────────────────────────────────────
# onnxruntime is imported lazily so the module loads quickly.
# Sessions are singletons — loaded once, reused for every inference call.

_horse_sess = None
_pose_sess  = None


def _get_sessions():
    global _horse_sess, _pose_sess
    import onnxruntime as ort  # lazy — ~100 MB, loaded on first analysis request

    horse_path = os.path.join(_MODEL_DIR, "yolov8m.onnx")
    pose_path  = os.path.join(_MODEL_DIR, "yolov8m-pose.onnx")

    opts = ort.SessionOptions()
    opts.intra_op_num_threads  = 2
    opts.inter_op_num_threads  = 1
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    providers = ["CPUExecutionProvider"]

    if _horse_sess is None:
        if os.path.exists(horse_path):
            logger.info(f"[models] Loading horse detector (yolov8m): {horse_path}")
        else:
            logger.error(f"[models] yolov8m.onnx NOT FOUND at {horse_path}")
        _horse_sess = ort.InferenceSession(horse_path, opts, providers=providers)
        for o in _horse_sess.get_outputs():
            logger.info(f"[models] horse output: {o.name} {o.shape}")

    if _pose_sess is None:
        if os.path.exists(pose_path):
            logger.info(f"[models] Loading pose model (yolov8m-pose): {pose_path}")
        else:
            logger.error(f"[models] yolov8m-pose.onnx NOT FOUND at {pose_path}")
        _pose_sess = ort.InferenceSession(pose_path, opts, providers=providers)
        for o in _pose_sess.get_outputs():
            logger.info(f"[models] pose output: {o.name} {o.shape}")

    return _horse_sess, _pose_sess


# ── Preprocessing ─────────────────────────────────────────────────────────────

def _letterbox(img: np.ndarray, size: int = INPUT_SIZE):
    """Resize + pad with grey to a square of `size` pixels."""
    h, w = img.shape[:2]
    r    = min(size / h, size / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    img  = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    dh   = (size - nh) / 2
    dw   = (size - nw) / 2
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    img  = cv2.copyMakeBorder(
        img, top, bottom, left, right,
        cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )
    return img, r, dw, dh


def _preprocess(frame: np.ndarray):
    """BGR frame → (NCHW float32, ratio, pad_dw, pad_dh)."""
    img, ratio, dw, dh = _letterbox(frame)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    img = np.ascontiguousarray(img.transpose(2, 0, 1)[np.newaxis])  # NCHW
    return img, ratio, dw, dh


# ── NMS ───────────────────────────────────────────────────────────────────────

def _xywh2xyxy(b: np.ndarray) -> np.ndarray:
    out = b.copy()
    out[:, 0] = b[:, 0] - b[:, 2] / 2
    out[:, 1] = b[:, 1] - b[:, 3] / 2
    out[:, 2] = b[:, 0] + b[:, 2] / 2
    out[:, 3] = b[:, 1] + b[:, 3] / 2
    return out


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float = 0.45) -> list[int]:
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = boxes[:, 2], boxes[:, 3]
    areas  = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order  = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = order[0]; keep.append(int(i))
        if order.size == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-7)
        order = order[1:][iou <= iou_thresh]
    return keep


def _scale_back(coords_x, coords_y, ratio, dw, dh, W, H):
    """Shift letterbox padding and scale back to original image coordinates."""
    x = np.clip((coords_x - dw) / ratio, 0, W)
    y = np.clip((coords_y - dh) / ratio, 0, H)
    return x, y


# ── Smart Cropper ─────────────────────────────────────────────────────────────

class SmartCropper:
    """
    Smart cropping strategy for maximizing pose estimation accuracy.

    Detects horse bounding box, expands with padding (especially upward for rider),
    and optionally applies EMA smoothing for temporal stability across frames.

    The cropped region is scaled up to a target height, providing ~3-4x effective
    resolution increase for pose estimation on the rider.
    """

    def __init__(
        self,
        padding_factor: float = CROP_PADDING_FACTOR,
        top_padding: float = CROP_TOP_PADDING,
        ema_alpha: float = CROP_EMA_ALPHA,
        jump_threshold: float = CROP_JUMP_THRESHOLD,
        output_height: int = CROP_OUTPUT_HEIGHT,
        use_smoothing: bool = True,
    ):
        self.padding_factor = padding_factor
        self.top_padding = top_padding
        self.ema_alpha = ema_alpha
        self.jump_threshold = jump_threshold
        self.output_height = output_height
        self.use_smoothing = use_smoothing

        # State for EMA smoothing
        self.prev_bbox: Optional[np.ndarray] = None
        self.smoothed_bbox: Optional[np.ndarray] = None

    def reset(self) -> None:
        """Reset smoothing state (call when starting a new video)."""
        self.prev_bbox = None
        self.smoothed_bbox = None

    def _expand_bbox(
        self,
        bbox: Tuple[int, int, int, int],
        frame_h: int,
        frame_w: int,
    ) -> Tuple[int, int, int, int]:
        """Expand bbox by padding factor, with extra top padding for rider."""
        x1, y1, x2, y2 = bbox
        box_w = x2 - x1
        box_h = y2 - y1

        # Standard padding on all sides
        pad_x = int(box_w * self.padding_factor)
        pad_y = int(box_h * self.padding_factor)

        # Extra top padding for rider's head/upper body
        pad_y_top = int(box_h * self.top_padding)

        new_x1 = max(0, x1 - pad_x)
        new_y1 = max(0, y1 - pad_y - pad_y_top)
        new_x2 = min(frame_w, x2 + pad_x)
        new_y2 = min(frame_h, y2 + pad_y)

        return (new_x1, new_y1, new_x2, new_y2)

    def _smooth_bbox(
        self,
        bbox: Tuple[int, int, int, int],
        frame_h: int,
        frame_w: int,
    ) -> Tuple[int, int, int, int]:
        """Apply EMA smoothing with jump detection."""
        if not self.use_smoothing:
            return bbox

        curr = np.array(bbox, dtype=float)

        if self.smoothed_bbox is None:
            self.smoothed_bbox = curr.copy()
            self.prev_bbox = curr.copy()
            return bbox

        # Check for abrupt jump (> threshold of frame dimension)
        delta = np.abs(curr - self.prev_bbox)
        frame_dims = np.array([frame_w, frame_h, frame_w, frame_h])
        relative_jump = delta / frame_dims

        if np.any(relative_jump > self.jump_threshold):
            # Abrupt jump detected - reset tracking
            self.smoothed_bbox = curr.copy()
            logger.debug(f"[SmartCropper] Jump detected, resetting bbox tracking")
        else:
            # Apply EMA smoothing
            self.smoothed_bbox = self.ema_alpha * curr + (1 - self.ema_alpha) * self.smoothed_bbox

        self.prev_bbox = curr.copy()
        return tuple(self.smoothed_bbox.astype(int))

    def get_crop_region(
        self,
        frame: np.ndarray,
        horse_sess,
        horse_bbox: Optional[Tuple[int, int, int, int]] = None,
    ) -> Optional[Tuple[int, int, int, int]]:
        """
        Get the smart crop region for the frame.

        Args:
            frame: BGR image
            horse_sess: ONNX session for horse detection
            horse_bbox: Pre-computed horse bbox (if available, skips detection)

        Returns:
            (x1, y1, x2, y2) crop region in original frame coordinates, or None if no horse detected
        """
        frame_h, frame_w = frame.shape[:2]

        # Use provided bbox or detect horse
        if horse_bbox is None:
            horse_bboxes = _horse_bboxes(frame, horse_sess)
            if not horse_bboxes:
                # Fall back to previous bbox if available (for temporal continuity)
                if self.smoothed_bbox is not None:
                    return tuple(self.smoothed_bbox.astype(int))
                return None
            # Use the largest horse detection
            areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in horse_bboxes]
            horse_bbox = tuple(horse_bboxes[np.argmax(areas)].astype(int))

        # Expand bbox with padding
        expanded = self._expand_bbox(horse_bbox, frame_h, frame_w)

        # Apply smoothing if enabled
        smoothed = self._smooth_bbox(expanded, frame_h, frame_w)

        return smoothed

    def crop_and_scale(
        self,
        frame: np.ndarray,
        crop_region: Tuple[int, int, int, int],
    ) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """
        Crop frame to region and scale up to target height.

        Returns:
            cropped_frame: Scaled cropped image
            scale: Scale factor applied
            offset: (x, y) offset of crop region in original frame
        """
        x1, y1, x2, y2 = crop_region
        cropped = frame[y1:y2, x1:x2]

        crop_h = y2 - y1
        crop_w = x2 - x1

        if crop_h <= 0 or crop_w <= 0:
            return frame, 1.0, (0, 0)

        # Scale to target height, maintaining aspect ratio
        scale = self.output_height / crop_h
        new_w = int(crop_w * scale)
        new_h = self.output_height

        scaled = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        return scaled, scale, (x1, y1)

    def transform_keypoints_to_original(
        self,
        keypoints: np.ndarray,
        scale: float,
        offset: Tuple[int, int],
    ) -> np.ndarray:
        """
        Transform keypoints from cropped/scaled coordinates back to original frame.

        Args:
            keypoints: (17, 3) array [x, y, conf] in cropped frame coordinates
            scale: Scale factor that was applied to the crop
            offset: (x, y) offset of crop region in original frame

        Returns:
            keypoints: (17, 3) array in original frame coordinates
        """
        kps = keypoints.copy()
        kps[:, 0] = kps[:, 0] / scale + offset[0]
        kps[:, 1] = kps[:, 1] / scale + offset[1]
        return kps


# ── Horse Detection ───────────────────────────────────────────────────────────

def _horse_bboxes(frame: np.ndarray, sess) -> list[np.ndarray]:
    """Return [x1,y1,x2,y2] horse bounding boxes in original pixel coords."""
    H, W = frame.shape[:2]
    inp, ratio, dw, dh = _preprocess(frame)

    # YOLOv8m ONNX output: [1, 84, 8400]  →  [8400, 84]
    raw  = sess.run(None, {sess.get_inputs()[0].name: inp})[0][0]
    pred = raw.T  # [8400, 84]

    horse_scores = pred[:, 4 + HORSE_CLASS_ID]
    mask = horse_scores > DET_CONF
    if not mask.any():
        return []

    pred_f  = pred[mask]
    scores_f = horse_scores[mask]
    boxes_xyxy = _xywh2xyxy(pred_f[:, :4])
    keep = _nms(boxes_xyxy, scores_f)

    result = []
    for i in keep:
        b = boxes_xyxy[i].copy()
        b[[0, 2]], b[[1, 3]] = _scale_back(b[[0, 2]], b[[1, 3]], ratio, dw, dh, W, H)
        result.append(b)
    return result


# ── Pose Estimation ───────────────────────────────────────────────────────────

def _run_pose(frame: np.ndarray, sess) -> list[np.ndarray]:
    """
    Run YOLOv8m-pose ONNX inference.
    Returns list of (17, 3) arrays [x, y, conf] in original image coordinates.

    YOLOv8m-pose ONNX output: [1, 56, 8400]
      56 = 4 (bbox xywh) + 1 (person confidence) + 51 (17 keypoints × 3)
    """
    H, W = frame.shape[:2]
    inp, ratio, dw, dh = _preprocess(frame)

    raw  = sess.run(None, {sess.get_inputs()[0].name: inp})[0][0]  # [56, 8400]
    pred = raw.T  # [8400, 56]

    conf = pred[:, 4]
    mask = conf > CONF_THRESH
    if not mask.any():
        return []

    pred_f   = pred[mask]
    scores_f = conf[mask]
    boxes_xyxy = _xywh2xyxy(pred_f[:, :4])
    keep = _nms(boxes_xyxy, scores_f)

    results = []
    for i in keep:
        kp = pred_f[i, 5:].reshape(17, 3).copy()
        kp[:, 0], kp[:, 1] = _scale_back(kp[:, 0], kp[:, 1], ratio, dw, dh, W, H)
        results.append(kp)
    return results


def _run_pose_with_crop(
    frame: np.ndarray,
    pose_sess,
    horse_sess,
    cropper: SmartCropper,
) -> Tuple[list[np.ndarray], Optional[Tuple[int, int, int, int]]]:
    """
    Run pose estimation with smart cropping for improved accuracy.

    1. Detect horse and compute crop region (with optional EMA smoothing)
    2. Crop and scale up the region for higher effective resolution
    3. Run pose estimation on the cropped region
    4. Transform keypoints back to original frame coordinates

    Returns:
        (keypoints_list, crop_region): List of (17, 3) keypoint arrays in original
        frame coordinates, and the crop region used (for debugging/visualization)
    """
    # Get crop region (uses horse detection internally)
    crop_region = cropper.get_crop_region(frame, horse_sess)

    if crop_region is None:
        # No horse detected and no fallback - run on full frame
        return _run_pose(frame, pose_sess), None

    # Crop and scale up
    cropped_frame, scale, offset = cropper.crop_and_scale(frame, crop_region)

    # Run pose on cropped frame
    kps_list = _run_pose(cropped_frame, pose_sess)

    # Transform keypoints back to original frame coordinates
    transformed = []
    for kps in kps_list:
        transformed.append(cropper.transform_keypoints_to_original(kps, scale, offset))

    return transformed, crop_region


def _select_mounted_rider(
    kps_list: list[np.ndarray],
    crop_region: Optional[Tuple[int, int, int, int]],
) -> Optional[np.ndarray]:
    """
    Select the person most likely to be the mounted rider.

    Uses the "mounted rider priority" heuristic: prefer the person whose hip
    centroid is in the upper portion of the crop region (rider on horse vs
    person standing on ground).

    Falls back to APS v4 scoring if no clear mounted rider is found.
    """
    if not kps_list:
        return None

    if len(kps_list) == 1:
        kps = kps_list[0]
        _, valid = aps_v4(kps)
        return kps if valid else None

    # Use crop region height as reference, or fall back to y-coordinate analysis
    if crop_region is not None:
        crop_y1, crop_y2 = crop_region[1], crop_region[3]
        crop_h = crop_y2 - crop_y1
        upper_threshold = crop_y1 + crop_h * 0.6  # Upper 60% of crop
    else:
        # Fall back to using the minimum hip y-coordinate as reference
        all_hip_y = []
        for kps in kps_list:
            lh = kps[KP["left_hip"]]
            rh = kps[KP["right_hip"]]
            if lh[2] >= CONF_THRESH and rh[2] >= CONF_THRESH:
                all_hip_y.append((lh[1] + rh[1]) / 2)
        if all_hip_y:
            upper_threshold = min(all_hip_y) + (max(all_hip_y) - min(all_hip_y)) * 0.6
        else:
            upper_threshold = float('inf')

    # Find candidates in upper portion (mounted riders)
    candidates = []
    for kps in kps_list:
        lh = kps[KP["left_hip"]]
        rh = kps[KP["right_hip"]]
        aps_score, valid = aps_v4(kps)

        if not valid:
            continue

        if lh[2] >= CONF_THRESH and rh[2] >= CONF_THRESH:
            hip_y = (lh[1] + rh[1]) / 2
            is_upper = hip_y < upper_threshold
            candidates.append((kps, aps_score, hip_y, is_upper))
        else:
            candidates.append((kps, aps_score, float('inf'), False))

    if not candidates:
        return None

    # Prefer upper candidates (mounted riders)
    upper_candidates = [(kps, score, hip_y) for kps, score, hip_y, is_upper in candidates if is_upper]
    if upper_candidates:
        # Among upper candidates, pick the one with lowest hip_y (highest on screen)
        return min(upper_candidates, key=lambda x: x[2])[0]

    # No upper candidates - fall back to best APS score
    return max(candidates, key=lambda x: x[1])[0]


# ── Horse/rider isolation ─────────────────────────────────────────────────────

def _rider_overlaps_horse(kps: np.ndarray, horse_bboxes: list[np.ndarray]) -> bool:
    lh = kps[KP["left_hip"]]
    rh = kps[KP["right_hip"]]
    if lh[2] < CONF_THRESH or rh[2] < CONF_THRESH:
        return True
    hip_x = (lh[0] + rh[0]) / 2
    hip_y = (lh[1] + rh[1]) / 2
    for bbox in horse_bboxes:
        x1, y1, x2, y2 = bbox
        pad_y = (y2 - y1) * 0.20
        if x1 <= hip_x <= x2 and (y1 - pad_y) <= hip_y <= (y2 + pad_y):
            return True
    return False


# ── CAE — Camera-Aware Expectation ────────────────────────────────────────────

def compute_cae_index(all_kps: list[np.ndarray]) -> float:
    widths = []
    for kps in all_kps:
        ls = kps[KP["left_shoulder"]]; rs = kps[KP["right_shoulder"]]
        if ls[2] >= CONF_THRESH and rs[2] >= CONF_THRESH:
            widths.append(abs(ls[0] - rs[0]))
    if not widths:
        return 0.5
    max_w = float(np.percentile(widths, 95))
    if max_w < 1.0:
        return 0.5
    return float(np.mean([min(w / max_w, 1.0) for w in widths]))


# ── APS v4 ───────────────────────────────────────────────────────────────────

def aps_v4(kps: np.ndarray) -> tuple[float, bool]:
    ls = kps[KP["left_shoulder"]];  rs = kps[KP["right_shoulder"]]
    lh = kps[KP["left_hip"]];       rh = kps[KP["right_hip"]]
    lk = kps[KP["left_knee"]];      rk = kps[KP["right_knee"]]
    la = kps[KP["left_ankle"]];     ra = kps[KP["right_ankle"]]
    checks = [False] * 6
    checks[0] = ls[2] >= CONF_THRESH and rs[2] >= CONF_THRESH
    checks[1] = lh[2] >= CONF_THRESH and rh[2] >= CONF_THRESH
    checks[2] = lk[2] >= CONF_THRESH or  rk[2] >= CONF_THRESH
    if checks[0] and checks[1]:
        s_mid_y = (ls[1] + rs[1]) / 2
        h_mid_y = (lh[1] + rh[1]) / 2
        checks[3] = s_mid_y < h_mid_y
        torso_h  = abs(h_mid_y - s_mid_y)
        torso_w  = abs(ls[0] - rs[0])
        checks[4] = torso_h > torso_w * 0.4
    checks[5] = la[2] >= CONF_THRESH or ra[2] >= CONF_THRESH
    score    = sum(checks) / len(checks)
    is_valid = checks[0] and checks[1] and checks[3]
    return float(score), is_valid


# ── Keypoint extraction ───────────────────────────────────────────────────────

def extract_keypoints(kps_list: list[np.ndarray]) -> Optional[np.ndarray]:
    """Select the best valid (17,3) detection by APS v4 score."""
    candidates = []
    for kp in kps_list:
        score, valid = aps_v4(kp)
        if valid:
            candidates.append((score, kp))
    if not candidates:
        return None
    return max(candidates, key=lambda x: x[0])[1]


def _pt(kps: np.ndarray, name: str) -> Optional[np.ndarray]:
    pt = kps[KP[name]]
    return pt if pt[2] >= CONF_THRESH else None


# ── Biomechanics computation ──────────────────────────────────────────────────

def _stability_score(series: list[float], scale: float, worst_std: float = 0.25) -> float:
    if len(series) < 3:
        return 0.6
    std = float(np.std(series)) / max(scale, 1.0)
    return float(np.clip(1.0 - std / worst_std, 0.0, 1.0))


def compute_biomechanics(
    all_kps: list[np.ndarray],
    cae_indices: Optional[list[float]] = None,
) -> BiometricsResult:
    if not all_kps:
        return BiometricsResult(0.5, 0.5, 0.5, 0.5, 0.5, 0.5)

    shoulder_widths = []
    for kps in all_kps:
        ls = _pt(kps, "left_shoulder"); rs = _pt(kps, "right_shoulder")
        if ls is not None and rs is not None:
            shoulder_widths.append(abs(ls[0] - rs[0]))
    scale = float(np.median(shoulder_widths)) if shoulder_widths else 100.0
    scale = max(scale, 20.0)

    ankle_y: list[float] = []
    wrist_y: list[float] = []
    wrist_y_weights: list[float] = []
    wrist_asymm: list[float] = []
    hip_mid: list[np.ndarray] = []
    sh_angle: list[float] = []

    for i, kps in enumerate(all_kps):
        cae_w = cae_indices[i] if cae_indices and i < len(cae_indices) else 1.0
        la = _pt(kps, "left_ankle");    ra = _pt(kps, "right_ankle")
        lw = _pt(kps, "left_wrist");    rw = _pt(kps, "right_wrist")
        lh = _pt(kps, "left_hip");      rh = _pt(kps, "right_hip")
        ls = _pt(kps, "left_shoulder"); rs = _pt(kps, "right_shoulder")

        if la is not None and ra is not None:
            ankle_y.append((la[1] + ra[1]) / 2)
        elif la is not None:
            ankle_y.append(la[1])
        elif ra is not None:
            ankle_y.append(ra[1])

        if lw is not None and rw is not None:
            wrist_y.append((lw[1] + rw[1]) / 2);  wrist_y_weights.append(cae_w)
            wrist_asymm.append(abs(lw[1] - rw[1]) / scale)
        elif lw is not None:
            wrist_y.append(lw[1]);  wrist_y_weights.append(cae_w * 0.6)
        elif rw is not None:
            wrist_y.append(rw[1]);  wrist_y_weights.append(cae_w * 0.6)

        if lh is not None and rh is not None:
            hip_mid.append(np.array([(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2]))

        if ls is not None and rs is not None and lh is not None and rh is not None:
            smid  = np.array([(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2])
            hmid  = np.array([(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2])
            delta = smid - hmid
            sh_angle.append(abs(math.degrees(math.atan2(delta[0], -delta[1]))))

    lower_leg = _stability_score(ankle_y, scale, worst_std=0.25)

    if len(wrist_y) >= 3:
        w   = np.array(wrist_y_weights)
        mu  = float(np.average(wrist_y, weights=w))
        var = float(np.average((np.array(wrist_y) - mu) ** 2, weights=w))
        std = math.sqrt(var) / scale
        rein_steadiness = float(np.clip(1.0 - std / 0.20, 0.0, 1.0))
    else:
        rein_steadiness = 0.6

    if wrist_asymm:
        rein_symmetry = float(np.clip(1.0 - float(np.mean(wrist_asymm)) / 0.30, 0.0, 1.0))
    else:
        rein_symmetry = 0.6

    if len(hip_mid) >= 3:
        hips   = np.array(hip_mid)
        std2d  = math.sqrt(float(np.var(hips[:, 0])) + float(np.var(hips[:, 1]))) / scale
        core_stability = float(np.clip(1.0 - std2d / 0.20, 0.0, 1.0))
    else:
        core_stability = 0.6

    upper_body = float(np.clip(1.0 - float(np.mean(sh_angle)) / 15.0, 0.0, 1.0)) if sh_angle else 0.6
    pelvis     = _stability_score([float(h[1]) for h in hip_mid], scale, worst_std=0.15)

    return BiometricsResult(
        lowerLegStability  = round(lower_leg,        3),
        reinSteadiness     = round(rein_steadiness,  3),
        reinSymmetry       = round(rein_symmetry,    3),
        coreStability      = round(core_stability,   3),
        upperBodyAlignment = round(upper_body,       3),
        pelvisStability    = round(pelvis,           3),
    )


def _derive_riding_quality(bio: BiometricsResult) -> RidingQualityResult:
    return RidingQualityResult(
        rhythm       = round((bio.lowerLegStability + bio.pelvisStability) / 2, 3),
        relaxation   = round((bio.coreStability + bio.pelvisStability) / 2, 3),
        contact      = round((bio.reinSteadiness + bio.reinSymmetry) / 2, 3),
        impulsion    = round((bio.lowerLegStability + bio.coreStability) / 2, 3),
        straightness = round((bio.reinSymmetry + bio.upperBodyAlignment) / 2, 3),
        balance      = round(
            (bio.coreStability + bio.upperBodyAlignment + bio.pelvisStability) / 3, 3
        ),
    )


def _generate_insights(bio: BiometricsResult, det_rate: float) -> list[str]:
    scores = {
        "Lower leg stability":  bio.lowerLegStability,
        "Rein steadiness":      bio.reinSteadiness,
        "Rein symmetry":        bio.reinSymmetry,
        "Core stability":       bio.coreStability,
        "Upper body alignment": bio.upperBodyAlignment,
        "Pelvis stability":     bio.pelvisStability,
    }
    insights = []
    strengths  = [(k, v) for k, v in scores.items() if v >= 0.75]
    needs_work = [(k, v) for k, v in scores.items() if v <  0.55]
    if strengths:
        best = max(strengths, key=lambda x: x[1])
        insights.append(f"{best[0]} is your strongest area this session ({best[1]:.0%}) — build on it.")
    if needs_work:
        worst = min(needs_work, key=lambda x: x[1])
        insights.append(f"{worst[0]} needs the most attention ({worst[1]:.0%}) — focus here next ride.")
    if det_rate < 0.40:
        insights.append(
            "Video angle or lighting reduced tracking confidence in some sections "
            "— results may be approximate."
        )
    if not insights:
        insights.append("Solid session overall. Keep building consistency across all metrics.")
    return insights


# ── Video metadata ────────────────────────────────────────────────────────────

def _video_meta(video_path: str, sample_fps: int = SAMPLE_FPS) -> tuple[float, int, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")
    native_fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    step = max(1, int(native_fps / sample_fps))
    return native_fps, total_frames, step


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze_video(
    video_path: str,
    sample_fps: int = SAMPLE_FPS,
    use_smart_crop: bool = True,
    use_smoothing: bool = True,
) -> PipelineResult:
    """
    Analyze a video for rider biomechanics.

    Args:
        video_path: Path to the video file
        sample_fps: Frame sampling rate (default 1 fps)
        use_smart_crop: Enable smart cropping for better pose accuracy (default True)
        use_smoothing: Enable EMA smoothing for crop region stability (default True)
    """
    horse_sess, pose_sess = _get_sessions()

    native_fps, total_frames, step = _video_meta(video_path, sample_fps)
    logger.info(
        f"[analyze_video] {total_frames} frames @ {native_fps:.1f} fps — "
        f"sampling every {step} frames (~{sample_fps} fps effective)"
    )
    logger.info(
        f"[analyze_video] smart_crop={use_smart_crop} smoothing={use_smoothing}"
    )

    # Initialize smart cropper for rolling/adaptive crop
    cropper = SmartCropper(use_smoothing=use_smoothing) if use_smart_crop else None

    # Stream frames one at a time — never buffer the full list in RAM.
    valid_kps:     list[np.ndarray] = []
    valid_times:   list[float]      = []   # actual video timestamp for each valid frame
    cae_per_frame: list[float]      = []
    sampled_count  = 0
    horse_count    = 0
    crop_count     = 0

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    idx = 0
    try:
        while True:
            ok, raw_frame = cap.read()
            if not ok:
                break

            if idx % step == 0:
                sampled_count += 1
                frame = np.ascontiguousarray(raw_frame, dtype=np.uint8)
                del raw_frame

                # Run pose estimation (with or without smart cropping)
                if cropper is not None:
                    kps_list, crop_region = _run_pose_with_crop(
                        frame, pose_sess, horse_sess, cropper
                    )
                    if crop_region is not None:
                        crop_count += 1
                        horse_count += 1
                    # Use mounted rider selection for better accuracy
                    kps = _select_mounted_rider(kps_list, crop_region)
                else:
                    # Legacy path: no smart cropping
                    horse_boxes = _horse_bboxes(frame, horse_sess)
                    if horse_boxes:
                        horse_count += 1
                    kps_list = _run_pose(frame, pose_sess)
                    kps = extract_keypoints(kps_list)
                    if kps is not None and horse_boxes and not _rider_overlaps_horse(kps, horse_boxes):
                        kps = None

                del frame

                if kps is not None:
                    valid_kps.append(kps)
                    valid_times.append(idx / native_fps)
                    ls = _pt(kps, "left_shoulder")
                    rs = _pt(kps, "right_shoulder")
                    cae_per_frame.append(
                        abs(ls[0] - rs[0])
                        if ls is not None and rs is not None
                        else 0.0
                    )
            else:
                del raw_frame

            idx += 1
    finally:
        cap.release()

    det_rate = len(valid_kps) / max(sampled_count, 1)
    logger.info(
        f"[analyze_video] sampled={sampled_count} horse_frames={horse_count} "
        f"cropped_frames={crop_count} valid_poses={len(valid_kps)} det_rate={det_rate:.1%}"
    )

    max_cae_w = max(cae_per_frame) if cae_per_frame else 1.0
    cae_norm  = [w / max(max_cae_w, 1.0) for w in cae_per_frame]
    cae_index = compute_cae_index(valid_kps)

    aps_scores = [aps_v4(kps)[0] for kps in valid_kps]
    aps_score  = float(np.mean(aps_scores)) if aps_scores else 0.0

    bio     = compute_biomechanics(valid_kps, cae_indices=cae_norm)
    quality = _derive_riding_quality(bio)
    overall = round(float(np.mean([
        bio.lowerLegStability, bio.reinSteadiness, bio.reinSymmetry,
        bio.coreStability,     bio.upperBodyAlignment, bio.pelvisStability,
    ])), 3)

    _fw = max(frame_w, 1)
    _fh = max(frame_h, 1)
    frames_data = []
    for i in range(len(valid_kps)):
        kp = valid_kps[i].copy()
        kp[:, 0] = np.clip(kp[:, 0] / _fw, 0.0, 1.0)   # normalize x → 0-1
        kp[:, 1] = np.clip(kp[:, 1] / _fh, 0.0, 1.0)   # normalize y → 0-1
        frames_data.append({
            "frame_index": i,
            "frame_time":  round(valid_times[i], 3) if i < len(valid_times) else round(float(i), 3),
            "aps_score":   round(aps_scores[i], 3) if i < len(aps_scores) else None,
            "cae_value":   round(cae_norm[i], 3)   if i < len(cae_norm)   else None,
            "keypoints":   kp.tolist(),
        })

    return PipelineResult(
        biometrics     = bio,
        ridingQuality  = quality,
        overallScore   = overall,
        detectionRate  = round(det_rate,  3),
        caeIndex       = round(cae_index, 3),
        apsScore       = round(aps_score, 3),
        framesAnalyzed = len(valid_kps),
        framesTotal    = total_frames,
        insights       = _generate_insights(bio, det_rate),
        frames_data    = frames_data,
    )


def analyze_frame(frame_bgr: np.ndarray, use_smart_crop: bool = True) -> dict:
    """
    Synchronous single-frame analysis. Used by POST /analyze/frame.

    Args:
        frame_bgr: BGR image (OpenCV format)
        use_smart_crop: Enable smart cropping for better pose accuracy (default True)
    """
    horse_sess, pose_sess = _get_sessions()

    if use_smart_crop:
        # Use stateless smart cropping (no EMA smoothing for single frame)
        cropper = SmartCropper(use_smoothing=False)
        kps_list, crop_region = _run_pose_with_crop(
            frame_bgr, pose_sess, horse_sess, cropper
        )
        # Use mounted rider selection
        kps = _select_mounted_rider(kps_list, crop_region)

        if kps is None:
            return {"detected": False, "keypoints": None, "apsScore": 0.0}

        aps, valid = aps_v4(kps)
        return {
            "detected":  True,
            "valid":     valid,
            "apsScore":  round(aps, 3),
            "keypoints": kps.tolist(),
            "cropRegion": list(crop_region) if crop_region else None,
        }
    else:
        # Legacy path: no smart cropping
        horse_boxes = _horse_bboxes(frame_bgr, horse_sess)
        kps_list    = _run_pose(frame_bgr, pose_sess)
        kps         = extract_keypoints(kps_list)

        if kps is None:
            return {"detected": False, "keypoints": None, "apsScore": 0.0}

        if horse_boxes and not _rider_overlaps_horse(kps, horse_boxes):
            return {"detected": False, "keypoints": None, "apsScore": 0.0,
                    "reason": "skeleton_not_on_horse"}

        aps, valid = aps_v4(kps)
        return {
            "detected":  True,
            "valid":     valid,
            "apsScore":  round(aps, 3),
            "keypoints": kps.tolist(),
        }
