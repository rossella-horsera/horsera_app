"""
Run the pose pipeline on a local video, with no GCS, Firestore, or API involved.

Usage (from pose_api/, with yolov8m.onnx and yolov8m-pose.onnx next to pipeline.py):
    python scripts/smoke_test.py path/to/ride.mp4 [--seconds 20] [--fps 3] [--json out.json]

Prints progress, the detection summary, scores, and a sample of keypoints, so you can
tell whether a problem is in the model/pipeline or in the cloud plumbing around it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", help="Path to a local ride video")
    parser.add_argument("--seconds", type=float, default=None, help="Only analyze the first N seconds")
    parser.add_argument("--fps", type=int, default=pipeline.SAMPLE_FPS, help="Sampling rate (default: SAMPLE_FPS)")
    parser.add_argument("--json", default=None, help="Write the full result payload to this file")
    args = parser.parse_args()

    for name in ("yolov8m.onnx", "yolov8m-pose.onnx"):
        path = os.path.join(pipeline._MODEL_DIR, name)
        if not os.path.exists(path):
            print(f"Missing model: {path}\nExport it first (see HANDOFF.md section 6.1).", file=sys.stderr)
            return 2

    def on_progress(update: dict) -> None:
        print(
            f"  [{update.get('phase')}] sampled={update.get('sampled_count')} "
            f"horse_frames={update.get('horse_frames')} valid_poses={update.get('valid_poses')} "
            f"detection_rate={update.get('detection_rate')}"
        )

    started = time.monotonic()
    result = pipeline.analyze_video(
        args.video,
        sample_fps=args.fps,
        progress_callback=on_progress,
        max_duration_sec=args.seconds,
        result_scope="preview" if args.seconds else "full",
    ).to_dict()
    elapsed = time.monotonic() - started

    frames = result.get("framesData") or []
    detected = [f for f in frames if f.get("detected")]
    print(f"\nDone in {elapsed:.1f}s")
    print(f"framesSampled={result['framesSampled']} framesAnalyzed={result['framesAnalyzed']} "
          f"detectionRate={result['detectionRate']:.2f} apsScore={result['apsScore']:.2f} caeIndex={result['caeIndex']:.2f}")
    print("biometrics:", json.dumps(result["biometrics"]))
    print("ridingQuality:", json.dumps(result["ridingQuality"]))
    print("overallScore:", result["overallScore"])
    if result["detectionRate"] < 0.3:
        print("WARNING: low detection rate, so the scores above are mostly defaults and should not be trusted.")
    for frame in detected[:3]:
        kps = frame.get("keypoints") or []
        print(f"  t={frame.get('frame_time')}s first keypoints: {kps[:3]}")

    if args.json:
        with open(args.json, "w") as fh:
            # numpy scalars are not JSON-serializable by default
            json.dump(result, fh, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        print(f"Wrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
