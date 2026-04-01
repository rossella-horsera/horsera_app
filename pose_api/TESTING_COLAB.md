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

## Test 4: Visualize Smart Crop Region

```python
import cv2
import matplotlib.pyplot as plt
import numpy as np

# Load frame
cap = cv2.VideoCapture(VIDEO_PATH)
cap.set(cv2.CAP_PROP_POS_FRAMES, 50)  # Frame 50
ret, frame = cap.read()
cap.release()

# Get crop region
horse_sess, pose_sess = pipeline._get_sessions()
cropper = pipeline.SmartCropper(use_smoothing=False)
crop_region = cropper.get_crop_region(frame, horse_sess)

# Visualize
fig, axes = plt.subplots(1, 3, figsize=(15, 5))

# Original frame with crop box
frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
axes[0].imshow(frame_rgb)
axes[0].set_title(f"Original ({frame.shape[1]}x{frame.shape[0]})")
if crop_region:
    x1, y1, x2, y2 = crop_region
    rect = plt.Rectangle((x1, y1), x2-x1, y2-y1, fill=False, color='lime', linewidth=2)
    axes[0].add_patch(rect)
    axes[0].set_title(f"Original + Crop Region")

# Cropped and scaled
if crop_region:
    cropped, scale, offset = cropper.crop_and_scale(frame, crop_region)
    cropped_rgb = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)
    axes[1].imshow(cropped_rgb)
    axes[1].set_title(f"Cropped & Scaled ({cropped.shape[1]}x{cropped.shape[0]}, {scale:.1f}x)")
else:
    axes[1].set_title("No crop (horse not detected)")

# Run pose on cropped
result = pipeline.analyze_frame(frame, use_smart_crop=True)
if result['detected'] and result['keypoints']:
    kps = np.array(result['keypoints'])
    # Draw skeleton on original frame
    frame_skel = frame_rgb.copy()
    for i in range(17):
        if kps[i, 2] > 0.3:
            x, y = int(kps[i, 0]), int(kps[i, 1])
            cv2.circle(frame_skel, (x, y), 5, (255, 0, 0), -1)
    axes[2].imshow(frame_skel)
    axes[2].set_title(f"Pose (APS: {result['apsScore']:.2f})")
else:
    axes[2].imshow(frame_rgb)
    axes[2].set_title("No pose detected")

plt.tight_layout()
plt.savefig('smart_crop_test.png', dpi=150)
plt.show()

print(f"\nSaved visualization to smart_crop_test.png")
```

## Test 5: EMA Smoothing Comparison

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

## Test 6: Memory Usage

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
