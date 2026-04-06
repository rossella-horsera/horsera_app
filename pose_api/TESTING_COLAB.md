# Testing Pose API v6 on Google Colab

This guide covers testing the smart cropping and YOLOv8m-pose pipeline on Colab.

## Setup Cell

Run this first to install dependencies and export ONNX models:

```python
# Install dependencies
!pip install -q ultralytics opencv-python-headless numpy onnxruntime

# Export YOLOv8m models to ONNX
from ultralytics import YOLO

print("Exporting yolov8m (horse detection)...")
YOLO('yolov8m.pt').export(format='onnx', opset=12, simplify=False)

print("Exporting yolov8m-pose (pose estimation)...")
YOLO('yolov8m-pose.pt').export(format='onnx', opset=12, simplify=False)

print("Done! Models exported to yolov8m.onnx and yolov8m-pose.onnx")
```

## Upload pipeline.py

Upload `pipeline.py` from the repo, or clone the repo:

```python
# Option 1: Clone repo
!git clone https://github.com/YOUR_REPO/horsera_app.git
%cd horsera_app/pose_api

# Option 2: Upload file manually
from google.colab import files
uploaded = files.upload()  # Select pipeline.py
```

## Upload Test Video

```python
from google.colab import files
import os

print("Upload a test video (MP4/MOV):")
uploaded = files.upload()
VIDEO_PATH = list(uploaded.keys())[0]
print(f"Uploaded: {VIDEO_PATH}")
```

## Test 1: Video Analysis with Smart Cropping

```python
import pipeline

# Test with smart cropping + EMA smoothing (default)
print("=" * 60)
print("TEST 1: Video analysis WITH smart cropping + smoothing")
print("=" * 60)

result = pipeline.analyze_video(
    VIDEO_PATH,
    sample_fps=1,
    use_smart_crop=True,
    use_smoothing=True,
)

print(f"\nResults:")
print(f"  Frames analyzed: {result.framesAnalyzed} / {result.framesTotal}")
print(f"  Detection rate:  {result.detectionRate:.1%}")
print(f"  Overall score:   {result.overallScore:.2f}")
print(f"  APS score:       {result.apsScore:.2f}")
print(f"  CAE index:       {result.caeIndex:.2f}")

print(f"\nBiometrics:")
for k, v in result.biometrics.__dict__.items():
    print(f"  {k}: {v:.3f}")

print(f"\nInsights:")
for insight in result.insights:
    print(f"  - {insight}")
```

## Test 2: Compare Smart Crop vs Legacy

```python
import time

# With smart cropping
print("=" * 60)
print("TEST 2a: WITH smart cropping")
print("=" * 60)
t0 = time.time()
result_crop = pipeline.analyze_video(VIDEO_PATH, use_smart_crop=True)
t_crop = time.time() - t0

print(f"  Detection rate: {result_crop.detectionRate:.1%}")
print(f"  Overall score:  {result_crop.overallScore:.2f}")
print(f"  Time: {t_crop:.1f}s")

# Without smart cropping (legacy)
print("\n" + "=" * 60)
print("TEST 2b: WITHOUT smart cropping (legacy)")
print("=" * 60)
t0 = time.time()
result_legacy = pipeline.analyze_video(VIDEO_PATH, use_smart_crop=False)
t_legacy = time.time() - t0

print(f"  Detection rate: {result_legacy.detectionRate:.1%}")
print(f"  Overall score:  {result_legacy.overallScore:.2f}")
print(f"  Time: {t_legacy:.1f}s")

# Compare
print("\n" + "=" * 60)
print("COMPARISON")
print("=" * 60)
print(f"Detection rate: {result_crop.detectionRate:.1%} (crop) vs {result_legacy.detectionRate:.1%} (legacy)")
print(f"Overall score:  {result_crop.overallScore:.2f} (crop) vs {result_legacy.overallScore:.2f} (legacy)")
print(f"Time: {t_crop:.1f}s (crop) vs {t_legacy:.1f}s (legacy)")
```

## Test 3: Single Frame Analysis

```python
import cv2
import numpy as np
from google.colab import files
import matplotlib.pyplot as plt

# Upload a single frame image
print("Upload a test image (JPG/PNG):")
uploaded = files.upload()
IMAGE_PATH = list(uploaded.keys())[0]

# Or extract a frame from video
# cap = cv2.VideoCapture(VIDEO_PATH)
# cap.set(cv2.CAP_PROP_POS_FRAMES, 100)
# ret, frame = cap.read()
# cap.release()
# IMAGE_PATH = None

if IMAGE_PATH:
    frame = cv2.imread(IMAGE_PATH)
else:
    frame = frame  # from video extraction above

print("=" * 60)
print("TEST 3: Single frame analysis")
print("=" * 60)

# With smart cropping
result_crop = pipeline.analyze_frame(frame, use_smart_crop=True)
print(f"\nWith smart crop:")
print(f"  Detected: {result_crop['detected']}")
print(f"  Valid:    {result_crop.get('valid', 'N/A')}")
print(f"  APS:      {result_crop.get('apsScore', 0):.3f}")
print(f"  Crop region: {result_crop.get('cropRegion')}")

# Without smart cropping
result_legacy = pipeline.analyze_frame(frame, use_smart_crop=False)
print(f"\nWithout smart crop:")
print(f"  Detected: {result_legacy['detected']}")
print(f"  Valid:    {result_legacy.get('valid', 'N/A')}")
print(f"  APS:      {result_legacy.get('apsScore', 0):.3f}")
```

## Test 4: Side-by-Side Annotated Comparison (Legacy vs Smart Crop)

This is the key visual comparison test. It draws full skeletons on frames using both methods.

```python
import cv2
import matplotlib.pyplot as plt
import numpy as np

# COCO skeleton connections for drawing
SKELETON_CONNECTIONS = [
    (0, 1), (0, 2), (1, 3), (2, 4),           # Head
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),  # Arms
    (5, 11), (6, 12), (11, 12),               # Torso
    (11, 13), (13, 15), (12, 14), (14, 16),   # Legs
]

KEYPOINT_NAMES = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
]

def draw_skeleton(image, keypoints, color=(0, 255, 0), thickness=2, conf_thresh=0.3):
    """Draw skeleton with keypoints and connections on image."""
    img = image.copy()
    kps = np.array(keypoints)

    # Draw connections
    for (i, j) in SKELETON_CONNECTIONS:
        if kps[i, 2] > conf_thresh and kps[j, 2] > conf_thresh:
            pt1 = (int(kps[i, 0]), int(kps[i, 1]))
            pt2 = (int(kps[j, 0]), int(kps[j, 1]))
            cv2.line(img, pt1, pt2, color, thickness, cv2.LINE_AA)

    # Draw keypoints
    for i, (x, y, conf) in enumerate(kps):
        if conf > conf_thresh:
            # Color by confidence: green (high) -> yellow -> red (low)
            c = max(0, min(1, (conf - 0.3) / 0.5))
            point_color = (int(255 * (1-c)), int(255 * c), 0)  # BGR
            cv2.circle(img, (int(x), int(y)), 4, point_color, -1, cv2.LINE_AA)
            cv2.circle(img, (int(x), int(y)), 5, (255, 255, 255), 1, cv2.LINE_AA)

    return img

def compute_avg_confidence(keypoints):
    """Compute average keypoint confidence."""
    kps = np.array(keypoints)
    valid = kps[:, 2] > 0.1
    if not valid.any():
        return 0.0
    return float(kps[valid, 2].mean())

def count_valid_keypoints(keypoints, thresh=0.3):
    """Count keypoints above confidence threshold."""
    kps = np.array(keypoints)
    return int((kps[:, 2] > thresh).sum())

# Extract frames from video for comparison
cap = cv2.VideoCapture(VIDEO_PATH)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)

# Sample 4 frames evenly across the video
frame_indices = [int(total_frames * i / 5) for i in range(1, 5)]
frames = []
for idx in frame_indices:
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ret, frame = cap.read()
    if ret:
        frames.append((idx, frame))
cap.release()

print(f"Extracted {len(frames)} frames from video ({total_frames} total)")
print("=" * 70)

# Create comparison figure
fig, axes = plt.subplots(len(frames), 3, figsize=(18, 5 * len(frames)))
if len(frames) == 1:
    axes = axes.reshape(1, -1)

for row, (frame_idx, frame) in enumerate(frames):
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # Run both methods
    result_legacy = pipeline.analyze_frame(frame, use_smart_crop=False)
    result_smart = pipeline.analyze_frame(frame, use_smart_crop=True)

    # Column 1: Original frame
    axes[row, 0].imshow(frame_rgb)
    axes[row, 0].set_title(f"Frame {frame_idx} (t={frame_idx/fps:.1f}s)", fontsize=12)
    axes[row, 0].axis('off')

    # Column 2: Legacy method (production)
    if result_legacy['detected'] and result_legacy['keypoints']:
        img_legacy = draw_skeleton(frame_rgb, result_legacy['keypoints'],
                                   color=(255, 100, 100), thickness=2)
        axes[row, 1].imshow(img_legacy)
        aps = result_legacy['apsScore']
        avg_conf = compute_avg_confidence(result_legacy['keypoints'])
        n_valid = count_valid_keypoints(result_legacy['keypoints'])
        axes[row, 1].set_title(
            f"LEGACY (Production)\nAPS: {aps:.2f} | Conf: {avg_conf:.2f} | KPs: {n_valid}/17",
            fontsize=11, color='darkred'
        )
    else:
        axes[row, 1].imshow(frame_rgb)
        axes[row, 1].set_title("LEGACY: No pose detected", fontsize=11, color='red')
    axes[row, 1].axis('off')

    # Column 3: Smart crop method (new)
    if result_smart['detected'] and result_smart['keypoints']:
        img_smart = draw_skeleton(frame_rgb, result_smart['keypoints'],
                                  color=(100, 255, 100), thickness=2)
        # Draw crop region if available
        if result_smart.get('cropRegion'):
            x1, y1, x2, y2 = result_smart['cropRegion']
            cv2.rectangle(img_smart, (x1, y1), (x2, y2), (0, 255, 255), 2)
        axes[row, 2].imshow(img_smart)
        aps = result_smart['apsScore']
        avg_conf = compute_avg_confidence(result_smart['keypoints'])
        n_valid = count_valid_keypoints(result_smart['keypoints'])
        axes[row, 2].set_title(
            f"SMART CROP (New)\nAPS: {aps:.2f} | Conf: {avg_conf:.2f} | KPs: {n_valid}/17",
            fontsize=11, color='darkgreen'
        )
    else:
        axes[row, 2].imshow(frame_rgb)
        axes[row, 2].set_title("SMART CROP: No pose detected", fontsize=11, color='red')
    axes[row, 2].axis('off')

    # Print comparison for this frame
    print(f"\nFrame {frame_idx}:")
    if result_legacy['detected']:
        print(f"  Legacy:     APS={result_legacy['apsScore']:.2f}, "
              f"Conf={compute_avg_confidence(result_legacy['keypoints']):.2f}, "
              f"KPs={count_valid_keypoints(result_legacy['keypoints'])}/17")
    else:
        print(f"  Legacy:     NOT DETECTED")
    if result_smart['detected']:
        print(f"  Smart Crop: APS={result_smart['apsScore']:.2f}, "
              f"Conf={compute_avg_confidence(result_smart['keypoints']):.2f}, "
              f"KPs={count_valid_keypoints(result_smart['keypoints'])}/17")
    else:
        print(f"  Smart Crop: NOT DETECTED")

plt.suptitle("Pose Estimation Comparison: Legacy (Red) vs Smart Crop (Green)",
             fontsize=14, fontweight='bold', y=1.01)
plt.tight_layout()
plt.savefig('pose_comparison.png', dpi=150, bbox_inches='tight')
plt.show()

print("\n" + "=" * 70)
print("Saved comparison to pose_comparison.png")
```

## Test 5: Detailed Single-Frame Comparison with Crop Visualization

```python
import cv2
import matplotlib.pyplot as plt
import numpy as np

# Load a single frame (or upload one)
cap = cv2.VideoCapture(VIDEO_PATH)
cap.set(cv2.CAP_PROP_POS_FRAMES, int(cap.get(cv2.CAP_PROP_FRAME_COUNT) / 2))
ret, frame = cap.read()
cap.release()

frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
h, w = frame.shape[:2]

# Get results from both methods
result_legacy = pipeline.analyze_frame(frame, use_smart_crop=False)
result_smart = pipeline.analyze_frame(frame, use_smart_crop=True)

# Create 2x2 comparison figure
fig, axes = plt.subplots(2, 2, figsize=(14, 12))

# Top-left: Original with crop region overlay
axes[0, 0].imshow(frame_rgb)
if result_smart.get('cropRegion'):
    x1, y1, x2, y2 = result_smart['cropRegion']
    rect = plt.Rectangle((x1, y1), x2-x1, y2-y1,
                          fill=False, color='cyan', linewidth=3, linestyle='--')
    axes[0, 0].add_patch(rect)
    crop_w, crop_h = x2 - x1, y2 - y1
    scale = 640 / crop_h
    axes[0, 0].set_title(f"Original ({w}x{h}) + Crop Region\n"
                         f"Crop: {crop_w}x{crop_h} → Scale: {scale:.1f}x", fontsize=11)
else:
    axes[0, 0].set_title(f"Original ({w}x{h}) - No crop region", fontsize=11)
axes[0, 0].axis('off')

# Top-right: Cropped and scaled region
if result_smart.get('cropRegion'):
    cropper = pipeline.SmartCropper(use_smoothing=False)
    cropped, scale, offset = cropper.crop_and_scale(frame, result_smart['cropRegion'])
    cropped_rgb = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
    axes[0, 1].imshow(cropped_rgb)
    axes[0, 1].set_title(f"Cropped & Scaled ({cropped.shape[1]}x{cropped.shape[0]})\n"
                         f"Effective resolution: {scale:.1f}x increase", fontsize=11)
else:
    axes[0, 1].imshow(frame_rgb)
    axes[0, 1].set_title("No crop available", fontsize=11)
axes[0, 1].axis('off')

# Bottom-left: Legacy pose estimation
if result_legacy['detected'] and result_legacy['keypoints']:
    img_legacy = draw_skeleton(frame_rgb, result_legacy['keypoints'],
                               color=(255, 80, 80), thickness=3)
    axes[1, 0].imshow(img_legacy)
    kps = np.array(result_legacy['keypoints'])
    valid_mask = kps[:, 2] > 0.3
    conf_str = ", ".join([f"{KEYPOINT_NAMES[i][:3]}:{kps[i,2]:.1f}"
                          for i in range(17) if valid_mask[i]])
    axes[1, 0].set_title(f"LEGACY Method\n"
                         f"APS: {result_legacy['apsScore']:.3f} | "
                         f"Valid KPs: {valid_mask.sum()}/17\n"
                         f"Avg Conf: {kps[valid_mask, 2].mean():.2f}",
                         fontsize=11, color='darkred')
else:
    axes[1, 0].imshow(frame_rgb)
    axes[1, 0].set_title("LEGACY: No pose detected", fontsize=11, color='red')
axes[1, 0].axis('off')

# Bottom-right: Smart crop pose estimation
if result_smart['detected'] and result_smart['keypoints']:
    img_smart = draw_skeleton(frame_rgb, result_smart['keypoints'],
                              color=(80, 255, 80), thickness=3)
    axes[1, 1].imshow(img_smart)
    kps = np.array(result_smart['keypoints'])
    valid_mask = kps[:, 2] > 0.3
    axes[1, 1].set_title(f"SMART CROP Method\n"
                         f"APS: {result_smart['apsScore']:.3f} | "
                         f"Valid KPs: {valid_mask.sum()}/17\n"
                         f"Avg Conf: {kps[valid_mask, 2].mean():.2f}",
                         fontsize=11, color='darkgreen')
else:
    axes[1, 1].imshow(frame_rgb)
    axes[1, 1].set_title("SMART CROP: No pose detected", fontsize=11, color='red')
axes[1, 1].axis('off')

plt.suptitle("Single Frame Detailed Comparison", fontsize=14, fontweight='bold')
plt.tight_layout()
plt.savefig('single_frame_comparison.png', dpi=150, bbox_inches='tight')
plt.show()

# Print detailed keypoint comparison
print("\n" + "=" * 70)
print("DETAILED KEYPOINT COMPARISON")
print("=" * 70)
print(f"{'Keypoint':<15} {'Legacy Conf':>12} {'Smart Conf':>12} {'Difference':>12}")
print("-" * 55)

if result_legacy['detected'] and result_smart['detected']:
    kps_legacy = np.array(result_legacy['keypoints'])
    kps_smart = np.array(result_smart['keypoints'])

    for i, name in enumerate(KEYPOINT_NAMES):
        conf_l = kps_legacy[i, 2]
        conf_s = kps_smart[i, 2]
        diff = conf_s - conf_l
        marker = "+" if diff > 0.05 else ("-" if diff < -0.05 else " ")
        print(f"{name:<15} {conf_l:>12.3f} {conf_s:>12.3f} {diff:>+12.3f} {marker}")

    print("-" * 55)
    print(f"{'AVERAGE':<15} {kps_legacy[:, 2].mean():>12.3f} {kps_smart[:, 2].mean():>12.3f} "
          f"{kps_smart[:, 2].mean() - kps_legacy[:, 2].mean():>+12.3f}")
```

## Test 6: EMA Smoothing Comparison

```python
import numpy as np

# Test smoothing effect on crop regions across frames
print("=" * 60)
print("TEST 5: EMA Smoothing effect on crop stability")
print("=" * 60)

horse_sess, pose_sess = pipeline._get_sessions()

# With smoothing
cropper_smooth = pipeline.SmartCropper(use_smoothing=True)
regions_smooth = []

# Without smoothing
cropper_raw = pipeline.SmartCropper(use_smoothing=False)
regions_raw = []

cap = cv2.VideoCapture(VIDEO_PATH)
frame_count = 0
max_frames = 30  # Test first 30 frames

while cap.isOpened() and frame_count < max_frames:
    ret, frame = cap.read()
    if not ret:
        break

    r_smooth = cropper_smooth.get_crop_region(frame, horse_sess)
    r_raw = cropper_raw.get_crop_region(frame, horse_sess)

    if r_smooth:
        regions_smooth.append(r_smooth)
    if r_raw:
        regions_raw.append(r_raw)

    frame_count += 1

cap.release()

# Analyze stability (lower std = more stable)
if regions_smooth and regions_raw:
    smooth_arr = np.array(regions_smooth)
    raw_arr = np.array(regions_raw)

    print(f"\nCrop region stability (std of x1, y1, x2, y2):")
    print(f"  With smoothing:    {smooth_arr.std(axis=0).mean():.1f} px")
    print(f"  Without smoothing: {raw_arr.std(axis=0).mean():.1f} px")
    print(f"  Improvement: {(1 - smooth_arr.std(axis=0).mean() / raw_arr.std(axis=0).mean()) * 100:.0f}% more stable")
else:
    print("Not enough frames with horse detection")
```

## Test 7: Memory Usage

```python
import tracemalloc

tracemalloc.start()

# Load models
horse_sess, pose_sess = pipeline._get_sessions()

current, peak = tracemalloc.get_traced_memory()
print(f"Model loading:")
print(f"  Current: {current / 1024 / 1024:.1f} MB")
print(f"  Peak:    {peak / 1024 / 1024:.1f} MB")

# Run one analysis
result = pipeline.analyze_video(VIDEO_PATH, sample_fps=2)

current, peak = tracemalloc.get_traced_memory()
print(f"\nAfter video analysis:")
print(f"  Current: {current / 1024 / 1024:.1f} MB")
print(f"  Peak:    {peak / 1024 / 1024:.1f} MB")

tracemalloc.stop()
```

## Expected Results

With smart cropping enabled, you should see:

1. **Higher detection rate** — cropping focuses on the horse/rider area
2. **Better APS scores** — higher resolution on rider improves keypoint accuracy
3. **More stable crop regions** — EMA smoothing reduces jitter between frames
4. **Slightly longer processing time** — extra crop/scale step adds overhead

## Troubleshooting

**"No horse detected"**
- Video may not contain a visible horse
- Try lowering `DET_CONF` in pipeline.py (currently 0.30)

**"ONNX model not found"**
- Ensure you ran the export cell first
- Check that `yolov8m.onnx` and `yolov8m-pose.onnx` exist in current directory

**Memory errors**
- YOLOv8m models require ~300 MB
- Use Colab with GPU runtime for better performance
- Reduce `sample_fps` for large videos
