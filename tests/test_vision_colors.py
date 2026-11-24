import unittest

import cv2
import numpy as np

from vision import COLORES_INDICADORES, detectar_colores


class DetectarColoresTest(unittest.TestCase):
    def test_detects_green_red_and_yellow_together(self):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        cv2.rectangle(frame, (15, 70), (65, 120), (0, 255, 0), -1)
        cv2.rectangle(frame, (125, 70), (175, 120), (0, 0, 255), -1)
        cv2.rectangle(frame, (245, 70), (295, 120), (0, 255, 255), -1)

        result = detectar_colores(frame)

        self.assertTrue(result["detectado"])
        self.assertEqual(result["colores"], list(COLORES_INDICADORES))
        self.assertIn(result["color"], COLORES_INDICADORES)

    def test_largest_color_is_selected_as_follow_target(self):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        cv2.rectangle(frame, (15, 80), (55, 120), (0, 255, 0), -1)
        cv2.rectangle(frame, (210, 55), (300, 145), (0, 0, 255), -1)

        result = detectar_colores(frame)

        self.assertEqual(result["color"], "rojo")
        self.assertGreater(result["x"], 0.7)

    def test_no_color_returns_empty_color_list(self):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)

        result = detectar_colores(frame)

        self.assertFalse(result["detectado"])
        self.assertEqual(result["colores"], [])


if __name__ == "__main__":
    unittest.main()
