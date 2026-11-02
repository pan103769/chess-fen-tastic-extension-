"""
Independent Audit Script: Evaluates board-analyzer.js heuristic logic on all 12 real benchmark PNG images.
Compares:
1. Occupancy detection (empty vs piece)
2. Color detection (white vs black)
3. Piece type recognition (verify whether it can or cannot recognize piece types)
"""

import json
import os
from PIL import Image
import numpy as np

GT_FILE = os.path.join(os.path.dirname(__file__), "fixtures", "benchmark", "ground_truth.json")
FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "benchmark")

def get_luminance(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b

def analyze_square_region(rgba_array, start_x, start_y, sq_w, sq_h):
    center_margin_x = int(sq_w * 0.2)
    center_margin_y = int(sq_h * 0.2)

    corner_lums = []
    center_lums = []

    for y in range(sq_h):
        cur_y = start_y + y
        for x in range(sq_w):
            cur_x = start_x + x
            r, g, b, a = rgba_array[cur_y, cur_x]
            lum = get_luminance(r, g, b)

            is_corner = (x < center_margin_x or x >= sq_w - center_margin_x) and \
                        (y < center_margin_y or y >= sq_h - center_margin_y)
            is_center = (center_margin_x <= x < sq_w - center_margin_x) and \
                        (center_margin_y <= y < sq_h - center_margin_y)

            if is_corner:
                corner_lums.append(lum)
            elif is_center:
                center_lums.append(lum)

    bg_lum = float(np.mean(corner_lums)) if corner_lums else 128.0
    center_lum = float(np.mean(center_lums)) if center_lums else 128.0
    std_dev = float(np.std(center_lums)) if center_lums else 0.0
    contrast_delta = abs(center_lum - bg_lum)

    is_occupied = std_dev >= 13.0 or contrast_delta >= 16.0
    occupancy = "occupied" if is_occupied else "empty"

    detected_color = "unknown"
    if is_occupied:
        if center_lum > bg_lum + 15 or center_lum > 165:
            detected_color = "white"
        elif center_lum < bg_lum - 15 or center_lum < 115:
            detected_color = "black"
        else:
            min_lum = min(center_lums) if center_lums else 0
            max_lum = max(center_lums) if center_lums else 255
            if min_lum < 60:
                detected_color = "black"
            elif max_lum > 200:
                detected_color = "white"

    return {
        "occupancy": occupancy,
        "detected_color": detected_color,
        "std_dev": std_dev,
        "contrast_delta": contrast_delta
    }

def main():
    with open(GT_FILE) as f:
        gt = json.load(f)

    total_squares = 0
    correct_occupancy = 0
    total_pieces = 0
    correct_color = 0

    print(f"{'Board ID':<25} | {'Occupancy Acc':<15} | {'Color Acc':<15} | {'Type Acc':<15}")
    print("-" * 75)

    files = "abcdefgh"
    ranks = [8, 7, 6, 5, 4, 3, 2, 1]

    for board_id, data in gt.items():
        img_path = os.path.join(FIXTURES_DIR, f"{board_id}.png")
        im = Image.open(img_path).convert("RGBA")
        w, h = im.size
        arr = np.array(im)

        sq_w = w / 8.0
        sq_h = h / 8.0
        gt_pieces = data.get("pieces", {})
        is_flipped = data.get("is_flipped", False)

        cur_files = "hgfedcba" if is_flipped else files
        cur_ranks = [1, 2, 3, 4, 5, 6, 7, 8] if is_flipped else ranks

        b_total_sq = 64
        b_corr_occ = 0
        b_total_p = 0
        b_corr_col = 0

        for r_idx, rank in enumerate(cur_ranks):
            start_y = int(round(r_idx * sq_h))
            actual_h = int(round((r_idx + 1) * sq_h)) - start_y
            for f_idx, file_char in enumerate(cur_files):
                start_x = int(round(f_idx * sq_w))
                actual_w = int(round((f_idx + 1) * sq_w)) - start_x

                sq = f"{file_char}{rank}"
                expected_piece = gt_pieces.get(sq, "empty")
                is_expected_occupied = (expected_piece != "empty")

                res = analyze_square_region(arr, start_x, start_y, actual_w, actual_h)

                # Check occupancy
                if (res["occupancy"] == "occupied") == is_expected_occupied:
                    b_corr_occ += 1

                # Check color
                if is_expected_occupied:
                    b_total_p += 1
                    expected_color = "white" if expected_piece.startswith("white_") else "black"
                    if res["detected_color"] == expected_color:
                        b_corr_col += 1

        total_squares += b_total_sq
        correct_occupancy += b_corr_occ
        total_pieces += b_total_p
        correct_color += b_corr_col

        occ_pct = (b_corr_occ / b_total_sq) * 100
        col_pct = (b_corr_col / b_total_p * 100) if b_total_p > 0 else 100.0

        print(f"{board_id:<25} | {occ_pct:>13.1f}% | {col_pct:>13.1f}% | {'0.0% (N/A)':>15}")

    print("=" * 75)
    print(f"Overall Occupancy Accuracy: {correct_occupancy}/{total_squares} ({(correct_occupancy/total_squares)*100:.2f}%)")
    print(f"Overall Piece Color Accuracy: {correct_color}/{total_pieces} ({(correct_color/total_pieces)*100:.2f}%)")
    print(f"Overall Piece Type Accuracy: 0.0% (board-analyzer.js has no piece type classifier)")

if __name__ == "__main__":
    main()

