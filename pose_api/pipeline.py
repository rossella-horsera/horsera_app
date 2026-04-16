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
INPUT_SIZE     = 640     # YOLO input resolution


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(raw))
    except Exception:
        logger.warning("[config] Invalid integer for %s=%r; using default=%d", name, raw, default)
        return default


SAMPLE_FPS       = _env_int("SAMPLE_FPS", 3)         # default sampling rate for full-video analysis
INFER_BATCH_SIZE = _env_int("INFER_BATCH_SIZE", 1)   # max sampled frames per ONNX inference call

# Keypoint indices for occlusion handling
LEFT_BODY = [5, 7, 9, 11, 13, 15]    # left shoulder through ankle
RIGHT_BODY = [6, 8, 10, 12, 14, 16]  # right shoulder through ankle
LEFT_LOWER_BODY = [11, 13, 15]       # left hip, knee, ankle
RIGHT_LOWER_BODY = [12, 14, 16]      # right hip, knee, ankle

# Skeleton drawing configuration
SKELETON_CONNECTIONS = [
    (0, 1), (0, 2), (1, 3), (2, 4),           # Head
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # Arms
    (5, 11), (6, 12), (11, 12),               # Torso
    (11, 13), (13, 15), (12, 14), (14, 16),   # Legs
]

DRAW_COLORS = {
    'bone': (60, 90, 140),
    'keypoint': (110, 169, 201),
    'low_conf': (163, 127, 107),
    'crop_box': (255, 255, 0),
}

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
    framesSampled: int
    framesTotal:   int
    sampleFps:     float
    sampleIntervalSec: float
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
            "framesSampled":  self.framesSampled,
            "framesTotal":    self.framesTotal,
            "sampleFps":      self.sampleFps,
            "sampleIntervalSec": self.sampleIntervalSec,
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
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    # Auto-detect GPU support
    available = ort.get_available_providers()
    require_cuda = os.environ.get("REQUIRE_CUDA", "").strip().lower() in {"1", "true", "yes", "on"}
    has_cuda = "CUDAExecutionProvider" in available
    logger.info("[models] Available ONNX providers: %s", available)

    if require_cuda and not has_cuda:
        raise RuntimeError(
            f"[models] REQUIRE_CUDA is set but CUDAExecutionProvider is unavailable. providers={available}"
        )

    if has_cuda:
        cuda_options = {
            # Keep host<->device copies on the default stream for safer interop.
            "do_copy_in_default_stream": "1",
            # Heuristic search is faster to initialize; tune via env if needed.
            "cudnn_conv_algo_search": os.environ.get("ORT_CUDNN_CONV_ALGO_SEARCH", "HEURISTIC"),
        }
        providers = [("CUDAExecutionProvider", cuda_options), "CPUExecutionProvider"]
        logger.info("[models] Using CUDA GPU acceleration")
    else:
        providers = ["CPUExecutionProvider"]
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        logger.info("[models] Using CPU (CUDA not available)")

    if _horse_sess is None:
        if os.path.exists(horse_path):
            logger.info(f"[models] Loading horse detector (yolov8m): {horse_path}")
        else:
            logger.error(f"[models] yolov8m.onnx NOT FOUND at {horse_path}")
        _horse_sess = ort.InferenceSession(horse_path, opts, providers=providers)
        logger.info(f"[models] horse input shape: {_horse_sess.get_inputs()[0].shape}")
        for o in _horse_sess.get_outputs():
            logger.info(f"[models] horse output: {o.name} {o.shape}")

    if _pose_sess is None:
        if os.path.exists(pose_path):
            logger.info(f"[models] Loading pose model (yolov8m-pose): {pose_path}")
        else:
            logger.error(f"[models] yolov8m-pose.onnx NOT FOUND at {pose_path}")
        _pose_sess = ort.InferenceSession(pose_path, opts, providers=providers)
        logger.info(f"[models] pose input shape: {_pose_sess.get_inputs()[0].shape}")
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


def _model_max_batch(sess) -> Optional[int]:
    shape = list(sess.get_inputs()[0].shape or [])
    if not shape:
        return None
    b = shape[0]
    if isinstance(b, int) and b > 0:
        return b
    return None


def _preprocess_batch(frames: list[np.ndarray]) -> tuple[np.ndarray, list[tuple[float, float, float, int, int]]]:
    """
    Batch-preprocess frames.
    Returns:
      input_batch: (N, 3, INPUT_SIZE, INPUT_SIZE)
      metas: list of (ratio, dw, dh, W, H)
    """
    inputs: list[np.ndarray] = []
    metas: list[tuple[float, float, float, int, int]] = []
    for frame in frames:
        H, W = frame.shape[:2]
        inp, ratio, dw, dh = _preprocess(frame)
        inputs.append(inp)
        metas.append((ratio, dw, dh, W, H))
    return np.concatenate(inputs, axis=0), metas


def _predict_rows(sess, batch_input: np.ndarray, channels: int) -> list[np.ndarray]:
    """
    Run ONNX session and normalize output shape to per-item [N, C] rows.
    """
    raw = np.asarray(sess.run(None, {sess.get_inputs()[0].name: batch_input})[0])

    # Single item outputs
    if raw.ndim == 2:
        if raw.shape[0] == channels:   # [C, N]
            return [raw.T]
        if raw.shape[1] == channels:   # [N, C]
            return [raw]

    # Batched outputs
    if raw.ndim == 3:
        if raw.shape[1] == channels:   # [B, C, N]
            return [raw[i].T for i in range(raw.shape[0])]
        if raw.shape[2] == channels:   # [B, N, C]
            return [raw[i] for i in range(raw.shape[0])]

    raise RuntimeError(
        f"Unexpected ONNX output shape {tuple(raw.shape)} for channels={channels}"
    )


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


# ── Occlusion Detection ───────────────────────────────────────────────────────

def detect_camera_side(keypoints: np.ndarray, threshold: float = 0.12) -> str:
    """
    Detect which side of the horse the camera is on FOR THIS FRAME.

    Uses confidence asymmetry - higher confidence side is more visible.
    Works even when horse is circling (camera side changes per frame).

    Args:
        keypoints: (17, 3) array [x, y, conf]
        threshold: Confidence difference to trigger occlusion marking

    Returns:
        'left': Camera on left, left legs likely occluded
        'right': Camera on right, right legs likely occluded
        'front': Roughly centered, both sides visible
    """
    # Get mean confidence for left vs right body
    left_confs = [keypoints[i, 2] for i in LEFT_BODY if keypoints[i, 2] > 0.1]
    right_confs = [keypoints[i, 2] for i in RIGHT_BODY if keypoints[i, 2] > 0.1]

    left_conf = np.mean(left_confs) if left_confs else 0.0
    right_conf = np.mean(right_confs) if right_confs else 0.0

    diff = right_conf - left_conf

    if diff > threshold:
        # Right side more visible -> camera on LEFT -> left legs occluded
        return 'left'
    elif diff < -threshold:
        # Left side more visible -> camera on RIGHT -> right legs occluded
        return 'right'
    else:
        return 'front'


def mark_occluded_keypoints(
    keypoints: np.ndarray,
    camera_side: str,
    conf_boost_visible: float = 0.0,
) -> np.ndarray:
    """
    Mark far-side lower body keypoints as occluded (conf=0).

    Only marks legs (hip, knee, ankle) - upper body usually visible above horse.

    Args:
        keypoints: (17, 3) array [x, y, conf]
        camera_side: 'left', 'right', or 'front'
        conf_boost_visible: Optional boost to visible side confidence

    Returns:
        Keypoints with occluded points marked (conf=0)
    """
    kps = keypoints.copy()

    if camera_side == 'left':
        # Camera on left -> LEFT legs behind horse
        for i in LEFT_LOWER_BODY:
            kps[i, 2] = 0.0
    elif camera_side == 'right':
        # Camera on right -> RIGHT legs behind horse
        for i in RIGHT_LOWER_BODY:
            kps[i, 2] = 0.0
    # 'front' -> no occlusion

    return kps


def process_keypoints_with_occlusion(keypoints: np.ndarray) -> tuple[np.ndarray, str]:
    """
    Detect camera side and mark occluded keypoints in one call.

    Returns:
        (processed_keypoints, camera_side)
    """
    camera_side = detect_camera_side(keypoints)
    processed = mark_occluded_keypoints(keypoints, camera_side)
    return processed, camera_side


# ── Skeleton Drawing ──────────────────────────────────────────────────────────

def draw_skeleton(
    frame: np.ndarray,
    keypoints: np.ndarray,
    conf_thresh: float = 0.3,
    thickness: int = 2,
    radius: int = 4,
) -> np.ndarray:
    """Draw skeleton. Occluded keypoints (conf=0) are automatically skipped."""
    kps = np.array(keypoints)

    # Draw bones - only if BOTH endpoints visible
    for (i, j) in SKELETON_CONNECTIONS:
        if kps[i, 2] > conf_thresh and kps[j, 2] > conf_thresh:
            pt1 = (int(kps[i, 0]), int(kps[i, 1]))
            pt2 = (int(kps[j, 0]), int(kps[j, 1]))
            cv2.line(frame, pt1, pt2, DRAW_COLORS['bone'], thickness, cv2.LINE_AA)

    # Draw keypoints
    for i in range(17):
        if kps[i, 2] > conf_thresh:
            pt = (int(kps[i, 0]), int(kps[i, 1]))
            color = DRAW_COLORS['keypoint'] if kps[i, 2] > 0.5 else DRAW_COLORS['low_conf']
            cv2.circle(frame, pt, radius, color, -1, cv2.LINE_AA)
            cv2.circle(frame, pt, radius + 1, (255, 255, 255), 1, cv2.LINE_AA)

    return frame


# ── Horse Detection ───────────────────────────────────────────────────────────

def _decode_horse_boxes(pred: np.ndarray, ratio: float, dw: float, dh: float, W: int, H: int) -> list[np.ndarray]:
    """Decode [N,84] horse predictions into [x1,y1,x2,y2] original pixel coords."""
    horse_scores = pred[:, 4 + HORSE_CLASS_ID]
    mask = horse_scores > DET_CONF
    if not mask.any():
        return []

    pred_f = pred[mask]
    scores_f = horse_scores[mask]
    boxes_xyxy = _xywh2xyxy(pred_f[:, :4])
    keep = _nms(boxes_xyxy, scores_f)

    result = []
    for i in keep:
        b = boxes_xyxy[i].copy()
        b[[0, 2]], b[[1, 3]] = _scale_back(b[[0, 2]], b[[1, 3]], ratio, dw, dh, W, H)
        result.append(b)
    return result


def _horse_bboxes_batch(frames: list[np.ndarray], sess) -> list[list[np.ndarray]]:
    """Return horse bboxes for each frame in the input list."""
    if not frames:
        return []

    max_batch = _model_max_batch(sess)
    target_batch = min(INFER_BATCH_SIZE, len(frames))
    if max_batch is not None:
        target_batch = min(target_batch, max_batch)
    target_batch = max(1, target_batch)

    if len(frames) > 1 and target_batch == 1:
        logger.debug("[batch] horse model currently fixed at batch=1; using sequential inference")

    all_boxes: list[list[np.ndarray]] = []
    for start in range(0, len(frames), target_batch):
        chunk = frames[start:start + target_batch]
        inp_batch, metas = _preprocess_batch(chunk)
        preds = _predict_rows(sess, inp_batch, channels=84)
        for pred, meta in zip(preds, metas):
            ratio, dw, dh, W, H = meta
            all_boxes.append(_decode_horse_boxes(pred, ratio, dw, dh, W, H))
    return all_boxes


def _horse_bboxes(frame: np.ndarray, sess) -> list[np.ndarray]:
    """Return [x1,y1,x2,y2] horse bounding boxes in original pixel coords."""
    return _horse_bboxes_batch([frame], sess)[0]


# ── Pose Estimation ───────────────────────────────────────────────────────────

def _decode_pose_keypoints(pred: np.ndarray, ratio: float, dw: float, dh: float, W: int, H: int) -> list[np.ndarray]:
    """Decode [N,56] pose predictions into list[(17,3)] in original pixel coords."""
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


def _run_pose_batch(frames: list[np.ndarray], sess) -> list[list[np.ndarray]]:
    """
    Run YOLOv8m-pose ONNX inference for a list of frames.
    Returns one list[(17,3)] per input frame.
    """
    if not frames:
        return []

    max_batch = _model_max_batch(sess)
    target_batch = min(INFER_BATCH_SIZE, len(frames))
    if max_batch is not None:
        target_batch = min(target_batch, max_batch)
    target_batch = max(1, target_batch)

    if len(frames) > 1 and target_batch == 1:
        logger.debug("[batch] pose model currently fixed at batch=1; using sequential inference")

    all_results: list[list[np.ndarray]] = []
    for start in range(0, len(frames), target_batch):
        chunk = frames[start:start + target_batch]
        inp_batch, metas = _preprocess_batch(chunk)
        preds = _predict_rows(sess, inp_batch, channels=56)
        for pred, meta in zip(preds, metas):
            ratio, dw, dh, W, H = meta
            all_results.append(_decode_pose_keypoints(pred, ratio, dw, dh, W, H))
    return all_results


def _run_pose(frame: np.ndarray, sess) -> list[np.ndarray]:
    """
    Run YOLOv8m-pose ONNX inference.
    Returns list of (17, 3) arrays [x, y, conf] in original image coordinates.
    """
    return _run_pose_batch([frame], sess)[0]


def _run_inference_batch(
    frames: list[np.ndarray],
    horse_sess,
    pose_sess,
    cropper: Optional[SmartCropper],
) -> tuple[list[Optional[np.ndarray]], int, int]:
    """
    Run model inference for a sampled frame batch.

    Returns:
      selected_keypoints_per_frame, horse_frames_detected, cropped_frames_used
    """
    if not frames:
        return [], 0, 0

    horse_boxes_batch = _horse_bboxes_batch(frames, horse_sess)
    horse_count = sum(1 for boxes in horse_boxes_batch if boxes)

    if cropper is None:
        pose_batch = _run_pose_batch(frames, pose_sess)
        selected: list[Optional[np.ndarray]] = []
        for kps_list, horse_boxes in zip(pose_batch, horse_boxes_batch):
            kps = extract_keypoints(kps_list)
            if kps is not None and horse_boxes and not _rider_overlaps_horse(kps, horse_boxes):
                kps = None
            selected.append(kps)
        return selected, horse_count, 0

    crop_count = 0
    pose_inputs: list[np.ndarray] = []
    crop_regions: list[Optional[Tuple[int, int, int, int]]] = []
    crop_scales: list[float] = []
    crop_offsets: list[Tuple[int, int]] = []

    # Build crop inputs sequentially so EMA smoothing remains temporally consistent.
    for frame, horse_boxes in zip(frames, horse_boxes_batch):
        if horse_boxes:
            areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in horse_boxes]
            horse_bbox = tuple(horse_boxes[int(np.argmax(areas))].astype(int))
            frame_h, frame_w = frame.shape[:2]
            expanded = cropper._expand_bbox(horse_bbox, frame_h, frame_w)
            crop_region = cropper._smooth_bbox(expanded, frame_h, frame_w)
        else:
            # No horse in this frame: keep temporal continuity if we have history,
            # otherwise fall back to full-frame pose.
            if cropper.smoothed_bbox is not None:
                crop_region = tuple(cropper.smoothed_bbox.astype(int))
            else:
                crop_region = None
        crop_regions.append(crop_region)

        if crop_region is not None:
            crop_count += 1
            cropped_frame, scale, offset = cropper.crop_and_scale(frame, crop_region)
            pose_inputs.append(cropped_frame)
            crop_scales.append(scale)
            crop_offsets.append(offset)
        else:
            # Fall back to full-frame pose inference.
            pose_inputs.append(frame)
            crop_scales.append(1.0)
            crop_offsets.append((0, 0))

    pose_batch = _run_pose_batch(pose_inputs, pose_sess)
    selected: list[Optional[np.ndarray]] = []
    for kps_list, crop_region, scale, offset in zip(pose_batch, crop_regions, crop_scales, crop_offsets):
        if crop_region is not None:
            transformed = [cropper.transform_keypoints_to_original(kps, scale, offset) for kps in kps_list]
        else:
            transformed = kps_list
        selected.append(_select_mounted_rider(transformed, crop_region))

    return selected, horse_count, crop_count


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

def _video_meta(video_path: str) -> tuple[float, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")
    native_fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return native_fps, total_frames


def _frame_timestamp_seconds(
    cap: cv2.VideoCapture,
    frame_idx: int,
    native_fps: float,
    last_frame_time: float,
) -> float:
    """
    Best-effort per-frame timestamp.

    Prefer the decoder's millisecond position when available, and fall back to
    frame_idx / native_fps if the codec/container does not report timestamps.
    """
    if frame_idx == 0:
        return 0.0

    fallback = frame_idx / max(native_fps, 1e-6)
    pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)

    if pos_msec is None or not math.isfinite(pos_msec) or pos_msec < 0:
        frame_time = fallback
    else:
        frame_time = pos_msec / 1000.0
        if frame_time <= 0:
            frame_time = fallback

    if frame_time < last_frame_time:
        frame_time = max(last_frame_time, fallback)

    return frame_time


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
        sample_fps: Frame sampling rate (default 3 fps)
        use_smart_crop: Enable smart cropping for better pose accuracy (default True)
        use_smoothing: Enable EMA smoothing for crop region stability (default True)
    """
    horse_sess, pose_sess = _get_sessions()

    native_fps, total_frames = _video_meta(video_path)
    sample_interval = 1.0 / max(float(sample_fps), 1.0)
    sample_epsilon = 0.5 / max(native_fps, float(sample_fps), 1.0)
    approx_effective = min(float(sample_fps), native_fps)
    logger.info(
        f"[analyze_video] {total_frames} frames @ {native_fps:.1f} fps — "
        f"sampling on a {sample_interval:.3f}s cadence (~{approx_effective:.1f} fps target)"
    )
    logger.info(
        f"[analyze_video] smart_crop={use_smart_crop} smoothing={use_smoothing}"
    )
    logger.info(
        f"[analyze_video] infer_batch_size={INFER_BATCH_SIZE}"
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
    sampled_frames: list[np.ndarray] = []
    sampled_indices: list[int] = []
    sampled_times: list[float] = []
    sampled_slots: list[int] = []
    timeline_entries: list[dict] = []

    def _flush_sampled_batch() -> None:
        nonlocal horse_count, crop_count
        if not sampled_frames:
            return
        selected_batch, horse_hits, crop_hits = _run_inference_batch(
            sampled_frames, horse_sess, pose_sess, cropper
        )
        horse_count += horse_hits
        crop_count += crop_hits

        for sample_slot, frame_idx, frame_time, kps in zip(sampled_slots, sampled_indices, sampled_times, selected_batch):
            timeline_entry = {
                "sample_index": sample_slot,
                "source_frame_index": frame_idx,
                "frame_time": frame_time,
                "keypoints": None,
            }

            if kps is not None:
                # Apply occlusion detection per frame
                kps, _camera_side = process_keypoints_with_occlusion(kps)
                valid_kps.append(kps)
                valid_times.append(frame_time)
                ls = _pt(kps, "left_shoulder")
                rs = _pt(kps, "right_shoulder")
                cae_per_frame.append(
                    abs(ls[0] - rs[0])
                    if ls is not None and rs is not None
                    else 0.0
                )
                timeline_entry["keypoints"] = kps

            timeline_entries.append(timeline_entry)

        sampled_frames.clear()
        sampled_indices.clear()
        sampled_times.clear()
        sampled_slots.clear()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    idx = 0
    next_sample_time = 0.0
    last_frame_time = 0.0
    try:
        while True:
            ok, raw_frame = cap.read()
            if not ok:
                break

            frame_time = _frame_timestamp_seconds(cap, idx, native_fps, last_frame_time)
            last_frame_time = frame_time

            if frame_time + sample_epsilon >= next_sample_time:
                sample_slot = sampled_count
                sampled_count += 1
                frame = np.ascontiguousarray(raw_frame, dtype=np.uint8)
                del raw_frame
                sampled_frames.append(frame)
                sampled_indices.append(idx)
                sampled_times.append(frame_time)
                sampled_slots.append(sample_slot)
                if len(sampled_frames) >= INFER_BATCH_SIZE:
                    _flush_sampled_batch()
                while next_sample_time <= frame_time + sample_epsilon:
                    next_sample_time += sample_interval
            else:
                del raw_frame

            idx += 1
    finally:
        _flush_sampled_batch()
        cap.release()

    det_rate = len(valid_kps) / max(sampled_count, 1)
    duration_sec = (timeline_entries[-1]["frame_time"] if timeline_entries else 0.0) + (1.0 / max(native_fps, 1.0))
    effective_sample_fps = sampled_count / max(duration_sec, 1e-6) if sampled_count else 0.0
    logger.info(
        f"[analyze_video] sampled={sampled_count} horse_frames={horse_count} "
        f"cropped_frames={crop_count} valid_poses={len(valid_kps)} "
        f"det_rate={det_rate:.1%} effective_sample_fps={effective_sample_fps:.2f}"
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
    valid_idx = 0
    for entry in timeline_entries:
        kp = entry["keypoints"]
        normalized_kps = None
        aps_value = None
        cae_value = None
        if isinstance(kp, np.ndarray):
            normalized_kps = kp.copy()
            normalized_kps[:, 0] = np.clip(normalized_kps[:, 0] / _fw, 0.0, 1.0)   # normalize x → 0-1
            normalized_kps[:, 1] = np.clip(normalized_kps[:, 1] / _fh, 0.0, 1.0)   # normalize y → 0-1
            aps_value = round(aps_scores[valid_idx], 3) if valid_idx < len(aps_scores) else None
            cae_value = round(cae_norm[valid_idx], 3) if valid_idx < len(cae_norm) else None
            valid_idx += 1
        frames_data.append({
            "frame_index": entry["source_frame_index"],
            "source_frame_index": entry["source_frame_index"],
            "sample_index": entry["sample_index"],
            "frame_time":  round(float(entry["frame_time"]), 3),
            "detected":    normalized_kps is not None,
            "aps_score":   aps_value,
            "cae_value":   cae_value,
            "keypoints":   normalized_kps.tolist() if normalized_kps is not None else None,
        })

    return PipelineResult(
        biometrics     = bio,
        ridingQuality  = quality,
        overallScore   = overall,
        detectionRate  = round(det_rate,  3),
        caeIndex       = round(cae_index, 3),
        apsScore       = round(aps_score, 3),
        framesAnalyzed = len(valid_kps),
        framesSampled  = sampled_count,
        framesTotal    = total_frames,
        sampleFps      = round(float(sample_fps), 3),
        sampleIntervalSec = round(sample_interval, 6),
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

        # Apply occlusion detection
        kps, camera_side = process_keypoints_with_occlusion(kps)

        aps, valid = aps_v4(kps)
        return {
            "detected":   True,
            "valid":      valid,
            "apsScore":   round(aps, 3),
            "keypoints":  kps.tolist(),
            "cropRegion": list(crop_region) if crop_region else None,
            "cameraSide": camera_side,
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

        # Apply occlusion detection
        kps, camera_side = process_keypoints_with_occlusion(kps)

        aps, valid = aps_v4(kps)
        return {
            "detected":   True,
            "valid":      valid,
            "apsScore":   round(aps, 3),
            "keypoints":  kps.tolist(),
            "cameraSide": camera_side,
        }


# ── Annotated Video Export ────────────────────────────────────────────────────

def save_annotated_video(
    video_path: str,
    result: PipelineResult,
    output_path: str,
    show_crop_region: bool = False,
    conf_thresh: float = 0.3,
) -> str:
    """
    Save annotated video with skeleton overlays.
    Occluded keypoints are already marked in result.frames_data.

    Args:
        video_path: Path to the original video
        result: PipelineResult from analyze_video()
        output_path: Path to save the annotated video
        show_crop_region: Draw the crop region box (for debugging)
        conf_thresh: Minimum confidence to draw keypoints

    Returns:
        output_path on success
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (frame_w, frame_h))

    # Build time -> keypoints lookup
    frame_lookup = {round(fd['frame_time'], 3): fd for fd in result.frames_data}

    cropper, horse_sess = None, None
    if show_crop_region:
        try:
            horse_sess, _ = _get_sessions()
            cropper = SmartCropper(use_smoothing=True)
        except Exception:
            show_crop_region = False

    frame_idx = 0
    annotated = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            t = round(frame_idx / fps, 3)

            if t in frame_lookup:
                kps = np.array(frame_lookup[t]['keypoints'])
                # Denormalize from 0-1 to pixel coords
                kps[:, 0] *= frame_w
                kps[:, 1] *= frame_h
                draw_skeleton(frame, kps, conf_thresh)
                annotated += 1

            if show_crop_region and cropper and horse_sess:
                crop = cropper.get_crop_region(frame, horse_sess)
                if crop:
                    cv2.rectangle(
                        frame,
                        (crop[0], crop[1]),
                        (crop[2], crop[3]),
                        DRAW_COLORS['crop_box'],
                        2
                    )

            out.write(frame)
            frame_idx += 1
    finally:
        cap.release()
        out.release()

    logger.info(f"[save_annotated_video] Saved {output_path} ({annotated} frames with skeleton)")
    return output_path
