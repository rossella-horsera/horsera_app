import os
import sys
import types
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.modules.setdefault("cv2", types.ModuleType("cv2"))

import pipeline  # noqa: E402


HORSE = (100, 200, 500, 420)
CROP = (60, 80, 540, 460)


def make_pose(
    x: float,
    shoulder_y: float,
    hip_y: float,
    knee_y: float,
    ankle_y: float,
    width: float = 44,
    conf: float = 0.90,
) -> np.ndarray:
    kps = np.zeros((17, 3), dtype=float)
    kps[:, 2] = 0.05

    half = width / 2.0
    points = {
        "nose": (x, shoulder_y - 42),
        "left_shoulder": (x - half, shoulder_y),
        "right_shoulder": (x + half, shoulder_y),
        "left_elbow": (x - half - 12, shoulder_y + 42),
        "right_elbow": (x + half + 12, shoulder_y + 42),
        "left_wrist": (x - half - 18, shoulder_y + 78),
        "right_wrist": (x + half + 18, shoulder_y + 78),
        "left_hip": (x - half * 0.8, hip_y),
        "right_hip": (x + half * 0.8, hip_y),
        "left_knee": (x - half * 0.9, knee_y),
        "right_knee": (x + half * 0.9, knee_y),
        "left_ankle": (x - half, ankle_y),
        "right_ankle": (x + half, ankle_y),
    }
    for name, (px, py) in points.items():
        kps[pipeline.KP[name]] = [px, py, conf]
    return kps


class RiderSelectionTests(unittest.TestCase):
    def test_mounted_rider_beats_standing_trainer(self) -> None:
        rider = make_pose(300, 150, 260, 335, 385)
        trainer = make_pose(315, 170, 290, 410, 505)
        people = [
            np.array([230, 135, 370, 395], dtype=float),
            np.array([260, 135, 370, 520], dtype=float),
        ]

        selected = pipeline._select_mounted_rider(
            [trainer, rider],
            crop_region=CROP,
            horse_bbox=HORSE,
            person_bboxes=people,
        )

        self.assertIs(selected, rider)

    def test_trainer_only_frame_is_skipped(self) -> None:
        trainer = make_pose(315, 170, 290, 410, 505)
        people = [np.array([260, 135, 370, 520], dtype=float)]

        selected = pipeline._select_mounted_rider(
            [trainer],
            crop_region=CROP,
            horse_bbox=HORSE,
            person_bboxes=people,
        )

        self.assertIsNone(selected)

    def test_tracker_keeps_rider_identity_through_lower_confidence_frame(self) -> None:
        tracker = pipeline.RiderTrackState()
        rider1 = make_pose(300, 150, 260, 335, 385)
        self.assertIs(
            pipeline._select_mounted_rider(
                [rider1],
                crop_region=CROP,
                horse_bbox=HORSE,
                person_bboxes=[np.array([230, 135, 370, 395], dtype=float)],
                tracker=tracker,
            ),
            rider1,
        )

        rider2 = make_pose(318, 154, 264, 340, 390, conf=0.62)
        trainer = make_pose(318, 170, 290, 410, 505, conf=0.95)
        selected = pipeline._select_mounted_rider(
            [trainer, rider2],
            crop_region=CROP,
            horse_bbox=HORSE,
            person_bboxes=[
                np.array([248, 140, 388, 400], dtype=float),
                np.array([265, 135, 375, 520], dtype=float),
            ],
            tracker=tracker,
        )

        self.assertIs(selected, rider2)

    def test_tracker_rejects_sudden_jump_to_other_person(self) -> None:
        wide_horse = (100, 200, 800, 420)
        wide_crop = (60, 80, 840, 460)
        tracker = pipeline.RiderTrackState()
        rider = make_pose(260, 150, 260, 335, 385)
        other_person = make_pose(710, 150, 260, 335, 385)

        self.assertIs(
            pipeline._select_mounted_rider(
                [rider],
                crop_region=wide_crop,
                horse_bbox=wide_horse,
                person_bboxes=[np.array([190, 135, 330, 395], dtype=float)],
                tracker=tracker,
            ),
            rider,
        )

        selected = pipeline._select_mounted_rider(
            [other_person],
            crop_region=wide_crop,
            horse_bbox=wide_horse,
            person_bboxes=[np.array([640, 135, 780, 395], dtype=float)],
            tracker=tracker,
        )

        self.assertIsNone(selected)


if __name__ == "__main__":
    unittest.main()
