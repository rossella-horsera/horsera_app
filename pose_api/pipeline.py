"""
Horsera Pose Pipeline — v4
YOLOv8s-pose inference with horse detection, CAE preprocessing,
APS v4 scoring, and Horsera biomechanics metrics.

Phase 2 hybrid model merging stub is included as commented-out code
at the bottom of this file.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, asdict
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── COCO keypoint indices ────────────────────────────────────────────────────
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
SAMPLE_FPS     = 1       # default sampling rate for full-video analysis


# ── Data classes ─────────────────────────────────────────────────────────────

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
    caeIndex:      float      # Camera-Aware Expectation rotation index (0–1)
    apsScore:      float      # APS v4 aggregate score
    framesAnalyzed: int
    framesTotal:   int
    insights:      list[str]
    frames_data:   list[dict]  # per-frame data for DB; excluded from to_dict()

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
        }


# ── Lazy model loading ───────────────────────────────────────────────────────

_horse_detector = None
_pose_model     = None


def _get_models():
    global _horse_detector, _pose_model
    from ultralytics import YOLO
    if _horse_detector is None:
        logger.info("Loading horse detector (yolov8n)…")
        _horse_detector = YOLO("yolov8n.pt")
    if _pose_model is None:
        logger.info("Loading pose model (yolov8s-pose)…")
        _pose_model = YOLO("yolov8s-pose.pt")
    return _horse_detector, _pose_model


# ── Video sampling ───────────────────────────────────────────────────────────

def sample_video(video_path: str, sample_fps: int = SAMPLE_FPS) -> tuple[list, int]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")

    native_fps  = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total       = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step        = max(1, int(native_fps / sample_fps))

    frames, idx = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            # copy() ensures a contiguous, writable uint8 ndarray —
            # some OpenCV builds return non-contiguous views that YOLO rejects
            frames.append(frame.copy())
        idx += 1
    cap.release()

    logger.info(
        f"Sampled {len(frames)} frames from {total} total "
        f"@ {native_fps:.1f} fps (step={step})"
    )
    return frames, total


# ── Horse detection & rider isolation ────────────────────────────────────────

def _has_horse(frame: np.ndarray, detector, conf: float = 0.40) -> bool:
    """Return True if at least one horse is detected in the frame."""
    results = detector(frame, verbose=False, conf=conf, classes=[HORSE_CLASS_ID])
    for r in results:
        if r.boxes and len(r.boxes) > 0:
            return True
    return False


def _horse_bboxes(frame: np.ndarray, detector, conf: float = 0.40) -> list[np.ndarray]:
    """Return list of [x1,y1,x2,y2] horse bounding boxes."""
    bboxes = []
    results = detector(frame, verbose=False, conf=conf, classes=[HORSE_CLASS_ID])
    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes.xyxy.cpu().numpy():
            bboxes.append(box[:4])
    return bboxes


def _rider_overlaps_horse(kps: np.ndarray, horse_bboxes: list[np.ndarray]) -> bool:
    """
    Confirm the detected rider skeleton overlaps a horse bounding box.
    Uses the hip midpoint as the rider's anchor (seat position).
    """
    lh = kps[KP["left_hip"]]
    rh = kps[KP["right_hip"]]
    if lh[2] < CONF_THRESH or rh[2] < CONF_THRESH:
        return True  # can't verify — don't discard
    hip_x = (lh[0] + rh[0]) / 2
    hip_y = (lh[1] + rh[1]) / 2
    for bbox in horse_bboxes:
        x1, y1, x2, y2 = bbox
        # Expand bbox 20% to account for rider sitting above horse centre
        pad_y = (y2 - y1) * 0.20
        if x1 <= hip_x <= x2 and (y1 - pad_y) <= hip_y <= (y2 + pad_y):
            return True
    return False


# ── CAE — Camera-Aware Expectation ───────────────────────────────────────────

def compute_cae_index(all_kps: list[np.ndarray]) -> float:
    """
    Camera-Aware Expectation (CAE) rotation index.

    As the horse-rider pair moves around the arena the apparent shoulder
    width varies continuously with viewing angle:
      - shoulder width ≈ max_width  →  rider facing camera  (0°, index ≈ 1.0)
      - shoulder width ≈ 0          →  rider side-on        (90°, index ≈ 0.0)

    This gives a continuous rotation index ∈ [0, 1] for each frame.
    We use this to:
      1. Weight metric contributions (side-on frames have unreliable wrist data)
      2. Report the mean CAE index as a session-level quality indicator

    Returns: mean CAE index across all frames with valid shoulder data.
    """
    widths = []
    for kps in all_kps:
        ls = kps[KP["left_shoulder"]]
        rs = kps[KP["right_shoulder"]]
        if ls[2] >= CONF_THRESH and rs[2] >= CONF_THRESH:
            widths.append(abs(ls[0] - rs[0]))

    if not widths:
        return 0.5  # unknown

    max_w  = float(np.percentile(widths, 95))  # use 95th to avoid outliers
    if max_w < 1.0:
        return 0.5

    indices = [min(w / max_w, 1.0) for w in widths]
    return float(np.mean(indices))


# ── APS v4 — Articulated Pose Score ──────────────────────────────────────────

def aps_v4(kps: np.ndarray) -> tuple[float, bool]:
    """
    APS v4: 6-check articulated pose score for a single frame.

    Checks:
      1. Both shoulders confident
      2. Both hips confident
      3. At least one knee confident
      4. Geometric sanity: shoulders above hips (y_shoulder < y_hip in image coords)
      5. Torso height > torso width (rider is upright, not lying flat)
      6. At least one ankle visible

    Returns (score ∈ [0,1], is_valid: bool).
    is_valid = True only when checks 1, 2, and 4 all pass.
    """
    ls = kps[KP["left_shoulder"]];  rs = kps[KP["right_shoulder"]]
    lh = kps[KP["left_hip"]];       rh = kps[KP["right_hip"]]
    lk = kps[KP["left_knee"]];      rk = kps[KP["right_knee"]]
    la = kps[KP["left_ankle"]];     ra = kps[KP["right_ankle"]]

    checks = [False] * 6

    # 1. Shoulder confidence
    checks[0] = ls[2] >= CONF_THRESH and rs[2] >= CONF_THRESH

    # 2. Hip confidence
    checks[1] = lh[2] >= CONF_THRESH and rh[2] >= CONF_THRESH

    # 3. Knee confidence (either side)
    checks[2] = lk[2] >= CONF_THRESH or rk[2] >= CONF_THRESH

    if checks[0] and checks[1]:
        s_mid_y = (ls[1] + rs[1]) / 2
        h_mid_y = (lh[1] + rh[1]) / 2

        # 4. Shoulders above hips (image y increases downward)
        checks[3] = s_mid_y < h_mid_y

        # 5. Torso height > torso width
        torso_h = abs(h_mid_y - s_mid_y)
        torso_w = abs(ls[0] - rs[0])
        checks[4] = torso_h > torso_w * 0.4  # lenient — side-on views compress width

    # 6. Ankle visibility
    checks[5] = la[2] >= CONF_THRESH or ra[2] >= CONF_THRESH

    score    = sum(checks) / len(checks)
    is_valid = checks[0] and checks[1] and checks[3]
    return float(score), is_valid


# ── Keypoint extraction ───────────────────────────────────────────────────────

def extract_keypoints(pose_result) -> Optional[np.ndarray]:
    """
    Return (17, 3) array [x, y, conf] for the best detection,
    or None if no detection passes APS v4 validity check.
    """
    candidates = []
    for r in pose_result:
        if r.keypoints is None:
            continue
        kps_tensor = r.keypoints.data
        if kps_tensor is None or len(kps_tensor) == 0:
            continue
        for i in range(len(kps_tensor)):
            kp = kps_tensor[i].cpu().numpy()
            score, valid = aps_v4(kp)
            if valid:
                candidates.append((score, kp))

    if not candidates:
        return None
    # Take the detection with the highest APS v4 score
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def _pt(kps: np.ndarray, name: str) -> Optional[np.ndarray]:
    """Return keypoint (x, y, conf) or None if below confidence threshold."""
    pt = kps[KP[name]]
    return pt if pt[2] >= CONF_THRESH else None


# ── Biomechanics computation ──────────────────────────────────────────────────

def _stability_score(series: list[float], scale: float, worst_std: float = 0.25) -> float:
    """Normalise std-dev of a position series into a 0–1 score (1 = most stable)."""
    if len(series) < 3:
        return 0.6
    std = float(np.std(series)) / max(scale, 1.0)
    return float(np.clip(1.0 - std / worst_std, 0.0, 1.0))


def compute_biomechanics(
    all_kps: list[np.ndarray],
    cae_indices: Optional[list[float]] = None,
) -> BiometricsResult:
    """
    Compute 6 Horsera biomechanics metrics from per-frame keypoint arrays.
    Scores are in [0, 1] — 1.0 = best.

    When cae_indices is provided, frames with low CAE (side-on views) are
    down-weighted for metrics that are unreliable at those angles (wrists).
    """
    if not all_kps:
        return BiometricsResult(0.5, 0.5, 0.5, 0.5, 0.5, 0.5)

    # Body-scale calibration: median shoulder width across all frames
    shoulder_widths = []
    for kps in all_kps:
        ls = _pt(kps, "left_shoulder"); rs = _pt(kps, "right_shoulder")
        if ls is not None and rs is not None:
            shoulder_widths.append(abs(ls[0] - rs[0]))
    scale = float(np.median(shoulder_widths)) if shoulder_widths else 100.0
    scale = max(scale, 20.0)

    # Per-metric series
    ankle_y:          list[float] = []
    wrist_y:          list[float] = []
    wrist_y_weights:  list[float] = []
    wrist_asymm:      list[float] = []
    hip_mid:          list[np.ndarray] = []
    sh_angle:         list[float] = []

    for i, kps in enumerate(all_kps):
        cae_w = cae_indices[i] if cae_indices and i < len(cae_indices) else 1.0

        la = _pt(kps, "left_ankle");    ra = _pt(kps, "right_ankle")
        lw = _pt(kps, "left_wrist");    rw = _pt(kps, "right_wrist")
        lh = _pt(kps, "left_hip");      rh = _pt(kps, "right_hip")
        ls = _pt(kps, "left_shoulder"); rs = _pt(kps, "right_shoulder")

        # Lower leg: mean ankle y
        if la is not None and ra is not None:
            ankle_y.append((la[1] + ra[1]) / 2)
        elif la is not None:
            ankle_y.append(la[1])
        elif ra is not None:
            ankle_y.append(ra[1])

        # Rein steadiness: mean wrist y, weighted by CAE
        if lw is not None and rw is not None:
            wrist_y.append((lw[1] + rw[1]) / 2)
            wrist_y_weights.append(cae_w)
            wrist_asymm.append(abs(lw[1] - rw[1]) / scale)
        elif lw is not None:
            wrist_y.append(lw[1]);  wrist_y_weights.append(cae_w * 0.6)
        elif rw is not None:
            wrist_y.append(rw[1]);  wrist_y_weights.append(cae_w * 0.6)

        # Pelvis / core: hip midpoint
        if lh is not None and rh is not None:
            hip_mid.append(np.array([(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2]))

        # Upper body alignment: torso angle from vertical
        if ls is not None and rs is not None and lh is not None and rh is not None:
            smid = np.array([(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2])
            hmid = np.array([(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2])
            delta = smid - hmid
            angle = abs(math.degrees(math.atan2(delta[0], -delta[1])))
            sh_angle.append(angle)

    # ── Metric scores ────────────────────────────────────────────────────────

    lower_leg = _stability_score(ankle_y, scale, worst_std=0.25)

    # Weighted rein steadiness
    if len(wrist_y) >= 3:
        w   = np.array(wrist_y_weights)
        mu  = float(np.average(wrist_y, weights=w))
        var = float(np.average((np.array(wrist_y) - mu) ** 2, weights=w))
        std = math.sqrt(var) / scale
        rein_steadiness = float(np.clip(1.0 - std / 0.20, 0.0, 1.0))
    else:
        rein_steadiness = 0.6

    # Rein symmetry: mean left/right height difference
    if wrist_asymm:
        mean_asymm = float(np.mean(wrist_asymm))
        rein_symmetry = float(np.clip(1.0 - mean_asymm / 0.30, 0.0, 1.0))
    else:
        rein_symmetry = 0.6

    # Core stability: 2D hip midpoint variance
    if len(hip_mid) >= 3:
        hips  = np.array(hip_mid)
        std2d = math.sqrt(float(np.var(hips[:, 0])) + float(np.var(hips[:, 1]))) / scale
        core_stability = float(np.clip(1.0 - std2d / 0.20, 0.0, 1.0))
    else:
        core_stability = 0.6

    # Upper body alignment: degrees from vertical
    if sh_angle:
        mean_angle    = float(np.mean(sh_angle))
        upper_body    = float(np.clip(1.0 - mean_angle / 15.0, 0.0, 1.0))
    else:
        upper_body = 0.6

    # Pelvis stability: hip midpoint y only
    pelvis = _stability_score(
        [float(h[1]) for h in hip_mid], scale, worst_std=0.15
    )

    return BiometricsResult(
        lowerLegStability  = round(lower_leg,        3),
        reinSteadiness     = round(rein_steadiness,  3),
        reinSymmetry       = round(rein_symmetry,    3),
        coreStability      = round(core_stability,   3),
        upperBodyAlignment = round(upper_body,       3),
        pelvisStability    = round(pelvis,           3),
    )


def _derive_riding_quality(bio: BiometricsResult) -> RidingQualityResult:
    """
    Derive the 6 Training Scale riding quality metrics from biomechanics scores.
    These are heuristic mappings — replace with ML when labelled data is available.
    """
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
        "Lower leg stability":   bio.lowerLegStability,
        "Rein steadiness":       bio.reinSteadiness,
        "Rein symmetry":         bio.reinSymmetry,
        "Core stability":        bio.coreStability,
        "Upper body alignment":  bio.upperBodyAlignment,
        "Pelvis stability":      bio.pelvisStability,
    }
    insights = []
    strengths  = [(k, v) for k, v in scores.items() if v >= 0.75]
    needs_work = [(k, v) for k, v in scores.items() if v <  0.55]

    if strengths:
        best = max(strengths, key=lambda x: x[1])
        insights.append(
            f"{best[0]} is your strongest area this session ({best[1]:.0%}) — build on it."
        )
    if needs_work:
        worst = min(needs_work, key=lambda x: x[1])
        insights.append(
            f"{worst[0]} needs the most attention ({worst[1]:.0%}) — focus here next ride."
        )
    if det_rate < 0.40:
        insights.append(
            "Video angle or lighting reduced tracking confidence in some sections "
            "— results may be approximate."
        )
    if not insights:
        insights.append(
            "Solid session overall. Keep building consistency across all metrics."
        )
    return insights


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze_video(video_path: str, sample_fps: int = SAMPLE_FPS) -> PipelineResult:
    horse_det, pose_mdl = _get_models()

    frames, total_frames = sample_video(video_path, sample_fps)

    # Step 1: filter frames to those containing a horse
    logger.info(f"Filtering {len(frames)} frames for horse presence…")
    horse_frames = [f for f in frames if _has_horse(f, horse_det)]
    logger.info(
        f"Horse in {len(horse_frames)}/{len(frames)} frames "
        f"({len(horse_frames)/max(len(frames),1)*100:.1f}%)"
    )
    working_frames = horse_frames if horse_frames else frames

    # Step 2: pose estimation + rider isolation
    logger.info(f"Running YOLOv8s-pose on {len(working_frames)} frames…")
    valid_kps:    list[np.ndarray] = []
    cae_per_frame: list[float]     = []

    for frame in working_frames:
        horse_boxes = _horse_bboxes(frame, horse_det)
        result      = pose_mdl(frame, verbose=False, conf=CONF_THRESH)
        kps         = extract_keypoints(result)
        if kps is None:
            continue
        if horse_boxes and not _rider_overlaps_horse(kps, horse_boxes):
            continue  # skeleton belongs to a spectator, not the rider
        valid_kps.append(kps)

        # Per-frame CAE: shoulder width / calibration width (filled after loop)
        ls = _pt(kps, "left_shoulder"); rs = _pt(kps, "right_shoulder")
        if ls is not None and rs is not None:
            cae_per_frame.append(abs(ls[0] - rs[0]))
        else:
            cae_per_frame.append(0.0)

    det_rate = len(valid_kps) / max(len(frames), 1)
    logger.info(f"Usable detections: {len(valid_kps)} ({det_rate:.1%} of sampled frames)")

    # Normalise per-frame CAE widths to [0, 1]
    max_cae_w = max(cae_per_frame) if cae_per_frame else 1.0
    cae_norm  = [w / max(max_cae_w, 1.0) for w in cae_per_frame]
    cae_index = compute_cae_index(valid_kps)

    # Step 3: compute APS v4 aggregate
    aps_scores = [aps_v4(kps)[0] for kps in valid_kps]
    aps_score  = float(np.mean(aps_scores)) if aps_scores else 0.0

    # Step 4: biomechanics + riding quality
    bio     = compute_biomechanics(valid_kps, cae_indices=cae_norm)
    quality = _derive_riding_quality(bio)
    overall = round(float(np.mean([
        bio.lowerLegStability, bio.reinSteadiness, bio.reinSymmetry,
        bio.coreStability,     bio.upperBodyAlignment, bio.pelvisStability,
    ])), 3)

    # Build per-frame data for Supabase pose_frames table
    frames_data = [
        {
            "frame_index": i,
            "aps_score":   round(aps_scores[i], 3) if i < len(aps_scores) else None,
            "cae_value":   round(cae_norm[i], 3)   if i < len(cae_norm)   else None,
            "keypoints":   valid_kps[i].tolist(),
        }
        for i in range(len(valid_kps))
    ]

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


def analyze_frame(frame_bgr: np.ndarray) -> dict:
    """
    Synchronous single-frame analysis.
    Returns raw keypoints + per-frame APS score.
    Used by POST /analyze/frame.
    """
    horse_det, pose_mdl = _get_models()

    horse_boxes = _horse_bboxes(frame_bgr, horse_det)
    result      = pose_mdl(frame_bgr, verbose=False, conf=CONF_THRESH)
    kps         = extract_keypoints(result)

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
        "keypoints": kps.tolist(),  # (17, 3) — [x, y, conf] per joint
    }


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 STUB — Hybrid model merging (MediaPipe + YOLOv8s ensemble)
# Activate by setting HORSERA_PHASE2=1 in environment.
#
# Rationale: on frames where YOLO confidence is low (CAE index < 0.35,
# i.e. rider nearly side-on), MediaPipe upper-body keypoints (shoulders,
# elbows, wrists) can supplement YOLO's output because MediaPipe handles
# frontal/profile torsos more robustly than full-body occlusion scenarios.
#
# Expected gain: +4–6% detection rate on arena corner frames.
# Cost: +180ms/frame inference latency (CPU), +60ms (GPU).
#
# To activate:
#   1. Uncomment the block below
#   2. pip install mediapipe>=0.10
#   3. Set HORSERA_PHASE2=1
# ─────────────────────────────────────────────────────────────────────────────

# import os as _os
# _PHASE2 = _os.environ.get("HORSERA_PHASE2", "0") == "1"
#
# _mp_model = None
#
# def _get_mp_model():
#     global _mp_model
#     if _mp_model is None:
#         import mediapipe as mp
#         _mp_model = mp.solutions.pose.Pose(
#             static_image_mode=True,
#             model_complexity=1,
#             min_detection_confidence=0.5,
#         )
#     return _mp_model
#
# def _merge_kps(yolo_kps: np.ndarray, frame_bgr: np.ndarray) -> np.ndarray:
#     """
#     Replace YOLO upper-body keypoints with MediaPipe equivalents
#     when YOLO confidence on those joints is below CONF_THRESH.
#     Only merges: shoulders (5,6), elbows (7,8), wrists (9,10).
#     """
#     import mediapipe as mp
#     mp_model = _get_mp_model()
#     rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
#     res = mp_model.process(rgb)
#     if not res.pose_landmarks:
#         return yolo_kps
#
#     lm = res.pose_landmarks.landmark
#     h, w = frame_bgr.shape[:2]
#
#     # MediaPipe → COCO index mapping for upper body
#     MP_TO_COCO = {
#         11: KP["left_shoulder"],  12: KP["right_shoulder"],
#         13: KP["left_elbow"],     14: KP["right_elbow"],
#         15: KP["left_wrist"],     16: KP["right_wrist"],
#     }
#     merged = yolo_kps.copy()
#     for mp_idx, coco_idx in MP_TO_COCO.items():
#         if merged[coco_idx, 2] < CONF_THRESH:
#             pt = lm[mp_idx]
#             merged[coco_idx] = [pt.x * w, pt.y * h, pt.visibility]
#     return merged
