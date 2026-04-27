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
import time
from dataclasses import dataclass, asdict
from typing import Any, Callable, Optional, Tuple

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

PERSON_CLASS_ID = 0      # COCO class 0 = person
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


def _env_float(name: str, default: float, minimum: float = 0.0) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, float(raw))
    except Exception:
        logger.warning("[config] Invalid float for %s=%r; using default=%s", name, raw, default)
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    logger.warning("[config] Invalid boolean for %s=%r; using default=%s", name, raw, default)
    return default


SAMPLE_FPS       = _env_int("SAMPLE_FPS", 3)         # default sampling rate for full-video analysis
INFER_BATCH_SIZE = _env_int("INFER_BATCH_SIZE", 1)   # max sampled frames per ONNX inference call
SAMPLE_EVERY_FRAME = _env_bool("SAMPLE_EVERY_FRAME", False)
ADAPTIVE_SAMPLE_MAX_FPS = _env_int("ADAPTIVE_SAMPLE_MAX_FPS", 8)
ADAPTIVE_SAMPLE_MOTION_THRESHOLD = _env_float("ADAPTIVE_SAMPLE_MOTION_THRESHOLD", 18.0)
ADAPTIVE_SAMPLE_MOTION_WINDOW_SEC = _env_float("ADAPTIVE_SAMPLE_MOTION_WINDOW_SEC", 0.75)
ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC = _env_float("ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC", 1.5)
MISSING_HORSE_GRACE_FRAMES = _env_int("MISSING_HORSE_GRACE_FRAMES", 2, minimum=0)

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
    resultScope:   str
    scope:         dict[str, Any]

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
            "resultScope":    self.resultScope,
            "scope":          self.scope,
        }


@dataclass
class DetectedObjects:
    horses: list[np.ndarray]
    people: list[np.ndarray]


@dataclass
class RiderCandidate:
    score: float
    mounted_score: float
    center: np.ndarray
    torso_size: float
    pose_bbox: Tuple[float, float, float, float]
    person_bbox: Optional[Tuple[float, float, float, float]]
    kps: np.ndarray


@dataclass
class RiderTrackState:
    center: Optional[np.ndarray] = None
    torso_size: float = 0.0
    pose_bbox: Optional[Tuple[float, float, float, float]] = None
    confidence: float = 0.0
    missed_frames: int = 0

    def score_candidate(self, candidate: RiderCandidate) -> tuple[float, bool]:
        if self.center is None:
            return candidate.mounted_score, False

        scale = max(self.torso_size, candidate.torso_size, 30.0)
        distance = float(np.linalg.norm(candidate.center - self.center)) / scale
        continuity_bonus = max(0.0, 1.0 - distance) * 0.70
        jump_penalty = max(0.0, distance - 1.25) * 0.75
        adjusted = candidate.mounted_score + continuity_bonus - jump_penalty

        # Once we have a plausible rider track, avoid snapping to a different
        # standing person unless the geometry is clearly stronger.
        rejected = (
            self.missed_frames <= 4
            and distance > 2.25
            and candidate.mounted_score < self.confidence + 0.55
        )
        return adjusted, rejected

    def update(self, candidate: Optional[RiderCandidate]) -> None:
        if candidate is None:
            self.missed_frames += 1
            self.confidence *= 0.88
            return

        if self.center is None or self.missed_frames > 4:
            blend = 1.0
        else:
            blend = 0.35
        self.center = candidate.center if self.center is None else ((1.0 - blend) * self.center + blend * candidate.center)
        self.torso_size = (
            candidate.torso_size
            if self.torso_size <= 0
            else ((1.0 - blend) * self.torso_size + blend * candidate.torso_size)
        )
        self.pose_bbox = candidate.pose_bbox
        self.confidence = max(candidate.mounted_score, self.confidence * 0.70)
        self.missed_frames = 0


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


def _motion_thumbnail(frame: np.ndarray, size: int = 64) -> np.ndarray:
    """Cheap grayscale thumbnail used for per-frame motion heuristics."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (size, size), interpolation=cv2.INTER_AREA)


def _motion_score(current_thumb: np.ndarray, previous_thumb: Optional[np.ndarray]) -> float:
    if previous_thumb is None:
        return 0.0
    diff = cv2.absdiff(current_thumb, previous_thumb)
    return float(np.mean(diff))


def _record_batch_size(batch_stats: Optional[dict[str, list[int]]], key: str, size: int) -> None:
    if batch_stats is None:
        return
    batch_stats.setdefault(key, []).append(int(size))


def _describe_batch_sizes(label: str, sizes: list[int]) -> str:
    if not sizes:
        return f"{label}=none"
    counts: dict[int, int] = {}
    for size in sizes:
        counts[size] = counts.get(size, 0) + 1
    histogram = ",".join(f"{size}:{counts[size]}" for size in sorted(counts))
    avg = sum(sizes) / max(len(sizes), 1)
    return (
        f"{label}=count:{len(sizes)} avg:{avg:.2f} min:{min(sizes)} max:{max(sizes)} "
        f"sizes={histogram}"
    )


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
        max_missing_frames: int = MISSING_HORSE_GRACE_FRAMES,
    ):
        self.padding_factor = padding_factor
        self.top_padding = top_padding
        self.ema_alpha = ema_alpha
        self.jump_threshold = jump_threshold
        self.output_height = output_height
        self.use_smoothing = use_smoothing
        self.max_missing_frames = max(0, int(max_missing_frames))

        # State for EMA smoothing
        self.prev_bbox: Optional[np.ndarray] = None
        self.smoothed_bbox: Optional[np.ndarray] = None
        self.last_horse_bbox: Optional[np.ndarray] = None
        self.missing_horse_frames = 0

    def reset(self) -> None:
        """Reset smoothing state (call when starting a new video)."""
        self.prev_bbox = None
        self.smoothed_bbox = None
        self.last_horse_bbox = None
        self.missing_horse_frames = 0

    def active_horse_bbox(self) -> Optional[Tuple[int, int, int, int]]:
        """Return the latest horse bbox while the cropper is still within the missing-horse grace window."""
        if self.last_horse_bbox is None or self.missing_horse_frames > self.max_missing_frames:
            return None
        return tuple(self.last_horse_bbox.astype(int))

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
                self.missing_horse_frames += 1
                # Keep the last crop only briefly. After that, return no crop so we
                # don't drift onto a trainer or other person on foot.
                if (
                    self.smoothed_bbox is not None
                    and self.missing_horse_frames <= self.max_missing_frames
                ):
                    return tuple(self.smoothed_bbox.astype(int))
                return None
            # Use the largest horse detection
            areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in horse_bboxes]
            horse_bbox = tuple(horse_bboxes[np.argmax(areas)].astype(int))

        self.missing_horse_frames = 0
        self.last_horse_bbox = np.array(horse_bbox, dtype=float)

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

def _decode_class_boxes(
    pred: np.ndarray,
    class_id: int,
    ratio: float,
    dw: float,
    dh: float,
    W: int,
    H: int,
) -> list[np.ndarray]:
    """Decode [N,84] detections for one COCO class into original pixel coords."""
    scores = pred[:, 4 + class_id]
    mask = scores > DET_CONF
    if not mask.any():
        return []

    pred_f = pred[mask]
    scores_f = scores[mask]
    boxes_xyxy = _xywh2xyxy(pred_f[:, :4])
    keep = _nms(boxes_xyxy, scores_f)

    result = []
    for i in keep:
        b = boxes_xyxy[i].copy()
        b[[0, 2]], b[[1, 3]] = _scale_back(b[[0, 2]], b[[1, 3]], ratio, dw, dh, W, H)
        result.append(b)
    return result


def _decode_horse_boxes(pred: np.ndarray, ratio: float, dw: float, dh: float, W: int, H: int) -> list[np.ndarray]:
    """Decode horse predictions into [x1,y1,x2,y2] original pixel coords."""
    return _decode_class_boxes(pred, HORSE_CLASS_ID, ratio, dw, dh, W, H)


def _object_bboxes_batch(
    frames: list[np.ndarray],
    sess,
    batch_stats: Optional[dict[str, list[int]]] = None,
) -> list[DetectedObjects]:
    """Return horse and person bboxes for each frame from the existing detector pass."""
    if not frames:
        return []

    max_batch = _model_max_batch(sess)
    target_batch = min(INFER_BATCH_SIZE, len(frames))
    if max_batch is not None:
        target_batch = min(target_batch, max_batch)
    target_batch = max(1, target_batch)

    if len(frames) > 1 and target_batch == 1:
        logger.debug("[batch] detector model currently fixed at batch=1; using sequential inference")

    all_objects: list[DetectedObjects] = []
    for start in range(0, len(frames), target_batch):
        chunk = frames[start:start + target_batch]
        _record_batch_size(batch_stats, "detector", len(chunk))
        inp_batch, metas = _preprocess_batch(chunk)
        preds = _predict_rows(sess, inp_batch, channels=84)
        for pred, meta in zip(preds, metas):
            ratio, dw, dh, W, H = meta
            all_objects.append(DetectedObjects(
                horses=_decode_class_boxes(pred, HORSE_CLASS_ID, ratio, dw, dh, W, H),
                people=_decode_class_boxes(pred, PERSON_CLASS_ID, ratio, dw, dh, W, H),
            ))
    return all_objects


def _horse_bboxes_batch(
    frames: list[np.ndarray],
    sess,
    batch_stats: Optional[dict[str, list[int]]] = None,
) -> list[list[np.ndarray]]:
    """Return horse bboxes for each frame in the input list."""
    return [objects.horses for objects in _object_bboxes_batch(frames, sess, batch_stats=batch_stats)]


def _horse_bboxes(frame: np.ndarray, sess) -> list[np.ndarray]:
    """Return [x1,y1,x2,y2] horse bounding boxes in original pixel coords."""
    return _horse_bboxes_batch([frame], sess)[0]


def _primary_horse_bbox(horse_boxes: list[np.ndarray]) -> Optional[Tuple[int, int, int, int]]:
    """Pick the largest detected horse box as the crop/selection reference for a frame."""
    if not horse_boxes:
        return None
    areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in horse_boxes]
    return tuple(horse_boxes[int(np.argmax(areas))].astype(int))


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


def _run_pose_batch(
    frames: list[np.ndarray],
    sess,
    batch_stats: Optional[dict[str, list[int]]] = None,
) -> list[list[np.ndarray]]:
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
        _record_batch_size(batch_stats, "pose", len(chunk))
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
    batch_stats: Optional[dict[str, list[int]]] = None,
    tracker: Optional[RiderTrackState] = None,
    selection_stats: Optional[dict[str, int]] = None,
) -> tuple[list[Optional[np.ndarray]], int, int]:
    """
    Run model inference for a sampled frame batch.

    Returns:
      selected_keypoints_per_frame, horse_frames_detected, cropped_frames_used
    """
    if not frames:
        return [], 0, 0

    objects_batch = _object_bboxes_batch(frames, horse_sess, batch_stats=batch_stats)
    horse_boxes_batch = [objects.horses for objects in objects_batch]
    horse_count = sum(1 for boxes in horse_boxes_batch if boxes)

    if cropper is None:
        pose_batch = _run_pose_batch(frames, pose_sess, batch_stats=batch_stats)
        selected: list[Optional[np.ndarray]] = []
        for kps_list, objects in zip(pose_batch, objects_batch):
            selected.append(_select_mounted_rider(
                kps_list,
                crop_region=None,
                horse_bbox=_primary_horse_bbox(objects.horses),
                person_bboxes=objects.people,
                tracker=tracker,
                selection_stats=selection_stats,
            ))
        return selected, horse_count, 0

    crop_count = 0
    pose_inputs: list[np.ndarray] = []
    pose_input_indices: list[int] = []
    crop_regions: list[Optional[Tuple[int, int, int, int]]] = []
    active_horse_bboxes: list[Optional[Tuple[int, int, int, int]]] = []
    crop_scales: list[float] = []
    crop_offsets: list[Tuple[int, int]] = []

    # Build crop inputs sequentially so EMA smoothing remains temporally consistent.
    for frame_idx, (frame, horse_boxes) in enumerate(zip(frames, horse_boxes_batch)):
        horse_bbox = _primary_horse_bbox(horse_boxes)
        crop_region = cropper.get_crop_region(frame, horse_sess, horse_bbox)
        crop_regions.append(crop_region)
        active_horse_bboxes.append(cropper.active_horse_bbox())

        if crop_region is None:
            continue

        crop_count += 1
        cropped_frame, scale, offset = cropper.crop_and_scale(frame, crop_region)
        pose_inputs.append(cropped_frame)
        pose_input_indices.append(frame_idx)
        crop_scales.append(scale)
        crop_offsets.append(offset)

    pose_batch = _run_pose_batch(pose_inputs, pose_sess, batch_stats=batch_stats) if pose_inputs else []
    transformed_by_frame: dict[int, list[np.ndarray]] = {}
    selected: list[Optional[np.ndarray]] = [None] * len(frames)
    for batch_idx, frame_idx in enumerate(pose_input_indices):
        kps_list = pose_batch[batch_idx]
        scale = crop_scales[batch_idx]
        offset = crop_offsets[batch_idx]
        transformed_by_frame[frame_idx] = [
            cropper.transform_keypoints_to_original(kps, scale, offset)
            for kps in kps_list
        ]

    for frame_idx in range(len(frames)):
        transformed = transformed_by_frame.get(frame_idx, [])
        selected[frame_idx] = _select_mounted_rider(
            transformed,
            crop_region=crop_regions[frame_idx],
            horse_bbox=active_horse_bboxes[frame_idx],
            person_bboxes=objects_batch[frame_idx].people,
            tracker=tracker,
            selection_stats=selection_stats,
        )

    return selected, horse_count, crop_count


def _run_pose_with_crop(
    frame: np.ndarray,
    pose_sess,
    horse_sess,
    cropper: SmartCropper,
) -> Tuple[
    list[np.ndarray],
    Optional[Tuple[int, int, int, int]],
    Optional[Tuple[int, int, int, int]],
]:
    """
    Run pose estimation with smart cropping for improved accuracy.

    1. Detect horse and compute crop region (with optional EMA smoothing)
    2. Crop and scale up the region for higher effective resolution
    3. Run pose estimation on the cropped region
    4. Transform keypoints back to original frame coordinates

    Returns:
        (keypoints_list, crop_region, horse_bbox): List of (17, 3) keypoint arrays
        in original frame coordinates, the crop region used, and the horse bbox
        used to validate that the selected person is actually mounted.
    """
    # Get crop region (uses horse detection internally)
    crop_region = cropper.get_crop_region(frame, horse_sess)
    horse_bbox = cropper.active_horse_bbox()

    if crop_region is None or horse_bbox is None:
        # Mounted analysis only: if we do not have a horse reference, do not run
        # full-frame pose, because that often latches onto a trainer on foot.
        return [], None, None

    # Crop and scale up
    cropped_frame, scale, offset = cropper.crop_and_scale(frame, crop_region)

    # Run pose on cropped frame
    kps_list = _run_pose(cropped_frame, pose_sess)

    # Transform keypoints back to original frame coordinates
    transformed = []
    for kps in kps_list:
        transformed.append(cropper.transform_keypoints_to_original(kps, scale, offset))

    return transformed, crop_region, horse_bbox


def _select_mounted_rider(
    kps_list: list[np.ndarray],
    crop_region: Optional[Tuple[int, int, int, int]],
    horse_bbox: Optional[Tuple[int, int, int, int]] = None,
    person_bboxes: Optional[list[np.ndarray]] = None,
    tracker: Optional[RiderTrackState] = None,
    selection_stats: Optional[dict[str, int]] = None,
) -> Optional[np.ndarray]:
    """
    Select the person most likely to be the mounted rider.

    Mounted analysis is stricter than generic person tracking: candidates must
    look plausible relative to the crop region and, when available, the horse
    bbox itself. If no candidate looks mounted, return None instead of falling
    back to the "best person" in frame.
    """
    if not kps_list or (crop_region is None and horse_bbox is None):
        if tracker is not None:
            tracker.update(None)
        return None

    if len(kps_list) > 1:
        _inc_selection_stat(selection_stats, "multi_candidate_frames")

    candidates: list[RiderCandidate] = []
    for kps in kps_list:
        candidate = _mounted_candidate_score(
            kps,
            crop_region=crop_region,
            horse_bbox=horse_bbox,
            person_bboxes=person_bboxes,
            selection_stats=selection_stats,
        )
        if candidate is None:
            continue
        if tracker is not None:
            adjusted_score, continuity_rejected = tracker.score_candidate(candidate)
            if continuity_rejected:
                _inc_selection_stat(selection_stats, "continuity_rejections")
                continue
            candidate.score = adjusted_score
        else:
            candidate.score = candidate.mounted_score
        candidates.append(candidate)

    if not candidates:
        if tracker is not None:
            tracker.update(None)
        return None

    best = max(candidates, key=lambda item: (item.score, item.mounted_score))
    if tracker is not None:
        tracker.update(best)
    _inc_selection_stat(selection_stats, "selected_valid_rider_frames")
    return best.kps


# ── Horse/rider isolation ─────────────────────────────────────────────────────

def _inc_selection_stat(selection_stats: Optional[dict[str, int]], key: str) -> None:
    if selection_stats is not None:
        selection_stats[key] = selection_stats.get(key, 0) + 1


def _as_box_tuple(box: Tuple[float, float, float, float] | np.ndarray) -> Tuple[float, float, float, float]:
    x1, y1, x2, y2 = [float(v) for v in box]
    return (x1, y1, x2, y2)


def _bbox_area(box: Tuple[float, float, float, float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _bbox_intersection(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _bbox_iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    inter = _bbox_intersection(a, b)
    union = _bbox_area(a) + _bbox_area(b) - inter
    return inter / max(union, 1e-7)


def _pose_bbox(kps: np.ndarray, min_conf: float = CONF_THRESH) -> Optional[Tuple[float, float, float, float]]:
    visible = kps[kps[:, 2] >= min_conf]
    if visible.size == 0:
        return None
    return (
        float(np.min(visible[:, 0])),
        float(np.min(visible[:, 1])),
        float(np.max(visible[:, 0])),
        float(np.max(visible[:, 1])),
    )


def _match_person_bbox(
    pose_bbox: Tuple[float, float, float, float],
    person_bboxes: Optional[list[np.ndarray]],
) -> Optional[Tuple[float, float, float, float]]:
    if not person_bboxes:
        return None

    pose_cx = (pose_bbox[0] + pose_bbox[2]) / 2.0
    pose_cy = (pose_bbox[1] + pose_bbox[3]) / 2.0
    best: Optional[Tuple[float, Tuple[float, float, float, float]]] = None
    for raw_box in person_bboxes:
        box = _as_box_tuple(raw_box)
        iou = _bbox_iou(pose_bbox, box)
        contains_center = box[0] <= pose_cx <= box[2] and box[1] <= pose_cy <= box[3]
        score = iou + (0.20 if contains_center else 0.0)
        if best is None or score > best[0]:
            best = (score, box)

    if best is None or best[0] <= 0.02:
        return None
    return best[1]

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


def _pair_midpoint(kps: np.ndarray, left_name: str, right_name: str) -> Optional[np.ndarray]:
    left = kps[KP[left_name]]
    right = kps[KP[right_name]]
    if left[2] < CONF_THRESH or right[2] < CONF_THRESH:
        return None
    return np.array([
        (left[0] + right[0]) / 2,
        (left[1] + right[1]) / 2,
    ], dtype=float)


def _mounted_candidate_score(
    kps: np.ndarray,
    crop_region: Optional[Tuple[int, int, int, int]],
    horse_bbox: Optional[Tuple[int, int, int, int]],
    person_bboxes: Optional[list[np.ndarray]] = None,
    selection_stats: Optional[dict[str, int]] = None,
) -> Optional[RiderCandidate]:
    """
    Score how plausibly this pose belongs to the mounted rider rather than a
    trainer on foot. Higher is better; None means reject the candidate.
    """
    aps_score, valid = aps_v4(kps)
    if not valid:
        return None

    hip_mid = _pair_midpoint(kps, "left_hip", "right_hip")
    shoulder_mid = _pair_midpoint(kps, "left_shoulder", "right_shoulder")
    if hip_mid is None or shoulder_mid is None:
        return None

    pose_bbox = _pose_bbox(kps)
    if pose_bbox is None:
        return None
    person_bbox = _match_person_bbox(pose_bbox, person_bboxes)

    hip_x = float(hip_mid[0])
    hip_y = float(hip_mid[1])
    shoulder_x = float(shoulder_mid[0])
    shoulder_y = float(shoulder_mid[1])
    torso_size = max(float(np.linalg.norm(hip_mid - shoulder_mid)), 20.0)
    score = float(aps_score)

    if crop_region is not None:
        crop_y1, crop_y2 = crop_region[1], crop_region[3]
        crop_h = max(float(crop_y2 - crop_y1), 1.0)
        hip_crop_ratio = (hip_y - crop_y1) / crop_h
        shoulder_crop_ratio = (shoulder_y - crop_y1) / crop_h

        # Mounted riders sit in the upper portion of the horse crop. People on
        # the ground tend to place their hips much lower in the crop.
        if hip_crop_ratio > 0.68:
            return None
        if shoulder_crop_ratio > 0.72:
            return None

        score += max(0.0, 0.68 - hip_crop_ratio) * 0.75
        score += max(0.0, 0.72 - shoulder_crop_ratio) * 0.25

    if horse_bbox is not None:
        x1, y1, x2, y2 = [float(v) for v in horse_bbox]
        horse_w = max(x2 - x1, 1.0)
        horse_h = max(y2 - y1, 1.0)
        horse_cx = (x1 + x2) / 2.0

        if not _rider_overlaps_horse(kps, [np.asarray(horse_bbox, dtype=float)]):
            return None

        hip_rel_y = (hip_y - y1) / horse_h
        shoulder_rel_y = (shoulder_y - y1) / horse_h

        if hip_x < (x1 - horse_w * 0.18) or hip_x > (x2 + horse_w * 0.18):
            return None
        if hip_rel_y < -0.10 or hip_rel_y > 0.68:
            return None
        if shoulder_rel_y > 0.75:
            return None

        torso_x = (hip_x + shoulder_x) / 2.0
        torso_rel_x = (torso_x - x1) / horse_w
        torso_rel_y = ((hip_y + shoulder_y) / 2.0 - y1) / horse_h
        saddle_band = (x1 + horse_w * 0.12, x2 - horse_w * 0.12)
        if torso_x < (x1 - horse_w * 0.08) or torso_x > (x2 + horse_w * 0.08):
            _inc_selection_stat(selection_stats, "likely_trainer_rejections")
            return None
        if torso_rel_y > 0.58:
            _inc_selection_stat(selection_stats, "likely_trainer_rejections")
            return None

        horizontal_score = max(0.0, 1.0 - abs(hip_x - horse_cx) / max(horse_w * 0.65, 1.0))
        vertical_score = max(0.0, 1.0 - abs(hip_rel_y - 0.38) / 0.38)
        shoulder_score = max(0.0, 1.0 - max(shoulder_rel_y, 0.0) / 0.75)
        saddle_score = 1.0 if saddle_band[0] <= torso_x <= saddle_band[1] else 0.55
        score += horizontal_score * 0.45
        score += vertical_score * 0.55
        score += shoulder_score * 0.20
        score += saddle_score * 0.25

        ankle_y_values = [
            float(kps[KP[name]][1])
            for name in ("left_ankle", "right_ankle")
            if kps[KP[name]][2] >= CONF_THRESH
        ]
        if ankle_y_values:
            ankle_rel_y = (float(np.mean(ankle_y_values)) - y1) / horse_h
            # Standing people keep both their hips and ankles low in the horse
            # box. Mounted riders generally do not.
            if hip_rel_y > 0.55 and ankle_rel_y > 0.95:
                _inc_selection_stat(selection_stats, "likely_trainer_rejections")
                return None
            if ankle_rel_y > 1.10 and hip_rel_y > 0.28 and shoulder_rel_y > -0.35:
                score -= 0.85

        if person_bbox is not None:
            px1, py1, px2, py2 = person_bbox
            person_h = max(py2 - py1, 1.0)
            person_w = max(px2 - px1, 1.0)
            person_bottom_rel = (py2 - y1) / horse_h
            person_top_rel = (py1 - y1) / horse_h
            person_center_x = (px1 + px2) / 2.0
            horse_overlap_ratio = _bbox_intersection(person_bbox, (x1, y1, x2, y2)) / max(_bbox_area(person_bbox), 1.0)
            vertical_person_shape = person_h / max(person_w, 1.0)

            score += min(horse_overlap_ratio, 1.0) * 0.30
            score += max(0.0, 1.0 - abs(person_center_x - horse_cx) / max(horse_w * 0.80, 1.0)) * 0.15

            standing_person = (
                person_bottom_rel > 1.06
                and person_h > horse_h * 0.62
                and vertical_person_shape > 1.55
                and hip_rel_y > 0.24
            )
            beside_horse = (
                person_center_x < x1 + horse_w * 0.10
                or person_center_x > x2 - horse_w * 0.10
                or torso_rel_x < 0.08
                or torso_rel_x > 0.92
            )
            if standing_person and (beside_horse or person_top_rel > -0.55):
                _inc_selection_stat(selection_stats, "likely_trainer_rejections")
                return None
            if standing_person:
                score -= 1.10
            elif person_bottom_rel > 1.05 and hip_rel_y > 0.35:
                score -= 0.50

    if score < 0.95:
        return None

    center = np.array([
        (float(hip_mid[0]) + float(shoulder_mid[0])) / 2.0,
        (float(hip_mid[1]) + float(shoulder_mid[1])) / 2.0,
    ], dtype=float)
    return RiderCandidate(
        score=score,
        mounted_score=score,
        center=center,
        torso_size=torso_size,
        pose_bbox=pose_bbox,
        person_bbox=person_bbox,
        kps=kps,
    )


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
    progress_callback: Optional[Callable[[dict[str, Any]], None]] = None,
    max_duration_sec: Optional[float] = None,
    result_scope: str = "full",
) -> PipelineResult:
    """
    Analyze a video for rider biomechanics.

    Args:
        video_path: Path to the video file
        sample_fps: Frame sampling rate (default 3 fps)
        use_smart_crop: Enable smart cropping for better pose accuracy (default True)
        use_smoothing: Enable EMA smoothing for crop region stability (default True)
        max_duration_sec: Optional early cutoff for preview analysis.
        result_scope: Describes whether the result is "preview" or "full".
    """
    horse_sess, pose_sess = _get_sessions()

    native_fps, total_frames = _video_meta(video_path)
    duration_estimate_sec = total_frames / max(native_fps, 1e-6)
    bounded_duration_estimate_sec = duration_estimate_sec
    if max_duration_sec is not None and max_duration_sec > 0:
        bounded_duration_estimate_sec = min(duration_estimate_sec, float(max_duration_sec))
    sample_every_frame = SAMPLE_EVERY_FRAME or sample_fps <= 0
    effective_sample_fps = native_fps if sample_every_frame else max(float(sample_fps), 1.0)
    adaptive_sample_fps = min(float(ADAPTIVE_SAMPLE_MAX_FPS), native_fps)
    adaptive_sample_enabled = (
        not sample_every_frame
        and adaptive_sample_fps > effective_sample_fps
        and (ADAPTIVE_SAMPLE_MOTION_WINDOW_SEC > 0 or ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC > 0)
    )
    progress_sample_fps = adaptive_sample_fps if adaptive_sample_enabled else effective_sample_fps
    estimated_samples = total_frames if sample_every_frame else max(
        1,
        int(math.ceil(bounded_duration_estimate_sec * progress_sample_fps)),
    )
    sample_interval = 1.0 / max(effective_sample_fps, 1.0)
    adaptive_sample_interval = 1.0 / max(adaptive_sample_fps, 1.0)
    sample_epsilon = 0.0 if sample_every_frame else 0.5 / max(native_fps, effective_sample_fps, 1.0)
    approx_effective = native_fps if sample_every_frame else min(progress_sample_fps, native_fps)
    if sample_every_frame:
        cadence_label = "every frame"
    elif adaptive_sample_enabled:
        cadence_label = (
            f"adaptive cadence ({sample_interval:.3f}s baseline, "
            f"{adaptive_sample_interval:.3f}s burst)"
        )
    else:
        cadence_label = f"{sample_interval:.3f}s cadence"
    logger.info(
        f"[analyze_video] {total_frames} frames @ {native_fps:.1f} fps — "
        f"sampling on {cadence_label} (~{approx_effective:.1f} fps target), "
        f"scope={result_scope} max_duration={max_duration_sec}"
    )
    logger.info(
        f"[analyze_video] smart_crop={use_smart_crop} smoothing={use_smoothing}"
    )
    logger.info(
        "[analyze_video] infer_batch_size=%s sample_every_frame=%s adaptive_sample_enabled=%s "
        "adaptive_sample_fps=%.1f motion_threshold=%.1f reacquire_window=%.2fs",
        INFER_BATCH_SIZE,
        sample_every_frame,
        adaptive_sample_enabled,
        adaptive_sample_fps,
        ADAPTIVE_SAMPLE_MOTION_THRESHOLD,
        ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC,
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
    batch_stats: dict[str, list[int]] = {}
    selection_stats: dict[str, int] = {}
    rider_tracker = RiderTrackState()
    latest_processed_time = 0.0
    last_progress_emit_at = 0.0
    previous_motion_thumb: Optional[np.ndarray] = None
    motion_boost_until = 0.0
    reacquire_until = 0.0
    motion_trigger_count = 0
    reacquire_trigger_count = 0
    adaptive_sample_count = 0

    def emit_progress(phase: str, force: bool = False) -> None:
        nonlocal last_progress_emit_at
        if progress_callback is None:
            return

        now = time.monotonic()
        if not force and (now - last_progress_emit_at) < 2.0:
            return

        processed_ratio = 0.0
        if bounded_duration_estimate_sec > 0:
            processed_ratio = min(1.0, latest_processed_time / bounded_duration_estimate_sec)
        if sampled_count > 0:
            processed_ratio = max(processed_ratio, min(1.0, sampled_count / max(estimated_samples, 1)))

        payload = {
            "phase": phase,
            "sampled_count": sampled_count,
            "estimated_samples": estimated_samples,
            "valid_poses": len(valid_kps),
            "horse_frames": horse_count,
            "cropped_frames": crop_count,
            "detection_rate": round(len(valid_kps) / max(sampled_count, 1), 4) if sampled_count else 0.0,
            "processed_seconds": round(float(latest_processed_time), 3),
            "duration_seconds_estimate": round(float(duration_estimate_sec), 3),
            "progress_pct": round(float(processed_ratio), 4),
        }
        progress_callback(payload)
        last_progress_emit_at = now

    emit_progress("starting", force=True)

    def _flush_sampled_batch() -> None:
        nonlocal horse_count, crop_count, latest_processed_time
        nonlocal reacquire_until, reacquire_trigger_count, next_sample_time
        if not sampled_frames:
            return
        selected_batch, horse_hits, crop_hits = _run_inference_batch(
            sampled_frames,
            horse_sess,
            pose_sess,
            cropper,
            batch_stats=batch_stats,
            tracker=rider_tracker,
            selection_stats=selection_stats,
        )
        horse_count += horse_hits
        crop_count += crop_hits

        saw_reacquire_miss = False
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
            elif adaptive_sample_enabled and ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC > 0:
                saw_reacquire_miss = True
                new_reacquire_until = frame_time + ADAPTIVE_SAMPLE_REACQUIRE_WINDOW_SEC
                if new_reacquire_until > reacquire_until + 1e-6:
                    reacquire_trigger_count += 1
                reacquire_until = max(reacquire_until, new_reacquire_until)

            timeline_entries.append(timeline_entry)

        if sampled_times:
            latest_processed_time = max(latest_processed_time, float(sampled_times[-1]))
            if saw_reacquire_miss:
                next_sample_time = min(next_sample_time, float(sampled_times[-1]))

        sampled_frames.clear()
        sampled_indices.clear()
        sampled_times.clear()
        sampled_slots.clear()
        emit_progress("sampling")

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
            if max_duration_sec is not None and max_duration_sec > 0 and frame_time >= float(max_duration_sec):
                del raw_frame
                break

            adaptive_boost_active = False
            if adaptive_sample_enabled:
                current_motion_thumb = _motion_thumbnail(raw_frame)
                motion_score = _motion_score(current_motion_thumb, previous_motion_thumb)
                previous_motion_thumb = current_motion_thumb
                if motion_score >= ADAPTIVE_SAMPLE_MOTION_THRESHOLD:
                    new_motion_until = frame_time + ADAPTIVE_SAMPLE_MOTION_WINDOW_SEC
                    if new_motion_until > motion_boost_until + 1e-6:
                        motion_trigger_count += 1
                    motion_boost_until = max(motion_boost_until, new_motion_until)
                    next_sample_time = min(next_sample_time, frame_time)
                adaptive_boost_active = frame_time < max(motion_boost_until, reacquire_until)

            current_sample_interval = adaptive_sample_interval if adaptive_boost_active else sample_interval
            current_sample_epsilon = (
                0.0
                if sample_every_frame
                else 0.5 / max(native_fps, (1.0 / max(current_sample_interval, 1e-6)), 1.0)
            )
            should_sample = sample_every_frame or (frame_time + current_sample_epsilon >= next_sample_time)
            if should_sample:
                sample_slot = sampled_count
                sampled_count += 1
                if adaptive_boost_active:
                    adaptive_sample_count += 1
                frame = np.ascontiguousarray(raw_frame, dtype=np.uint8)
                del raw_frame
                sampled_frames.append(frame)
                sampled_indices.append(idx)
                sampled_times.append(frame_time)
                sampled_slots.append(sample_slot)
                if len(sampled_frames) >= INFER_BATCH_SIZE:
                    _flush_sampled_batch()
                if sample_every_frame:
                    next_sample_time = frame_time + sample_interval
                else:
                    next_sample_time = frame_time + current_sample_interval
            else:
                del raw_frame

            idx += 1
    finally:
        _flush_sampled_batch()
        cap.release()

    emit_progress("sampling", force=True)

    det_rate = len(valid_kps) / max(sampled_count, 1)
    duration_sec = (timeline_entries[-1]["frame_time"] if timeline_entries else 0.0) + (1.0 / max(native_fps, 1.0))
    effective_sample_fps = sampled_count / max(duration_sec, 1e-6) if sampled_count else 0.0
    logger.info(
        f"[analyze_video] sampled={sampled_count} horse_frames={horse_count} "
        f"cropped_frames={crop_count} valid_poses={len(valid_kps)} "
        f"det_rate={det_rate:.1%} effective_sample_fps={effective_sample_fps:.2f}"
    )
    if adaptive_sample_enabled:
        logger.info(
            "[analyze_video] adaptive_samples=%s motion_triggers=%s reacquire_triggers=%s",
            adaptive_sample_count,
            motion_trigger_count,
            reacquire_trigger_count,
        )
    logger.info(
        "[analyze_video] %s %s",
        _describe_batch_sizes("detector_batches", batch_stats.get("detector", [])),
        _describe_batch_sizes("pose_batches", batch_stats.get("pose", [])),
    )
    logger.info(
        "[analyze_video] rider_selection multi_candidate_frames=%s "
        "likely_trainer_rejections=%s continuity_rejections=%s selected_valid_rider_frames=%s",
        selection_stats.get("multi_candidate_frames", 0),
        selection_stats.get("likely_trainer_rejections", 0),
        selection_stats.get("continuity_rejections", 0),
        selection_stats.get("selected_valid_rider_frames", 0),
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
        sampleFps      = round(float(effective_sample_fps), 3),
        sampleIntervalSec = round(sample_interval, 6),
        insights       = _generate_insights(bio, det_rate),
        frames_data    = frames_data,
        resultScope    = result_scope,
        scope          = {
            "kind": "first_segment" if result_scope == "preview" else "full",
            "duration_seconds": round(float(duration_sec), 3),
            "sample_fps": round(float(effective_sample_fps), 3),
        },
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
        kps_list, crop_region, horse_bbox = _run_pose_with_crop(
            frame_bgr, pose_sess, horse_sess, cropper
        )
        # Use mounted rider selection
        kps = _select_mounted_rider(kps_list, crop_region, horse_bbox)

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
        kps_list = _run_pose(frame_bgr, pose_sess)
        kps = _select_mounted_rider(
            kps_list,
            crop_region=None,
            horse_bbox=_primary_horse_bbox(horse_boxes),
        )

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
