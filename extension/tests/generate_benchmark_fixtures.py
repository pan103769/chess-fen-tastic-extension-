"""
Generates diverse benchmark test fixture boards for Chess FEN-tastic:
1. lichess_brown: Lichess classic brown/wood theme (Italian Game)
2. lichess_blue: Lichess blue theme (Rook endgame)
3. chesscom_green: Chess.com classic green theme (Sicilian Defense)
4. board_flipped: Flipped board (Black at bottom)
5. board_low_contrast: Low-contrast printed book scan
6. illegal_missing_king: Missing White King (for rejection rate verification)
7. illegal_touching_kings: Touching kings on e4/e5 (for rejection rate verification)
"""

import os
import json
from PIL import Image, ImageDraw, ImageFont

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "benchmark")
GT_FILE = os.path.join(FIXTURES_DIR, "ground_truth.json")

PIECE_UNICODE = {
    "white_king": "K",
    "white_queen": "Q",
    "white_rook": "R",
    "white_bishop": "B",
    "white_knight": "N",
    "white_pawn": "P",
    "black_king": "k",
    "black_queen": "q",
    "black_rook": "r",
    "black_bishop": "b",
    "black_knight": "n",
    "black_pawn": "p",
}

def draw_board(pieces, light_color, dark_color, piece_white_color=(255, 255, 255), piece_black_color=(20, 20, 20), sq_size=40, is_flipped=False):
    width = sq_size * 8
    height = sq_size * 8
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)

    ranks = [1, 2, 3, 4, 5, 6, 7, 8] if is_flipped else [8, 7, 6, 5, 4, 3, 2, 1]
    files = "hgfedcba" if is_flipped else "abcdefgh"

    for r_idx, rank in enumerate(ranks):
        for f_idx, file_char in enumerate(files):
            sq = f"{file_char}{rank}"
            x = f_idx * sq_size
            y = r_idx * sq_size
            is_light = (r_idx + f_idx) % 2 == 0
            color = light_color if is_light else dark_color
            draw.rectangle([x, y, x + sq_size, y + sq_size], fill=color)

            piece = pieces.get(sq)
            if piece and piece != "empty":
                char = PIECE_UNICODE.get(piece, "")
                is_white = piece.startswith("white_")
                p_color = piece_white_color if is_white else piece_black_color
                outline_color = (0, 0, 0) if is_white else (255, 255, 255)
                # Draw letter centered
                cx = x + sq_size // 2
                cy = y + sq_size // 2
                # Draw outline
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    draw.text((cx - 5 + dx, cy - 8 + dy), char, fill=outline_color)
                draw.text((cx - 5, cy - 8), char, fill=p_color)

    return img

def fen_to_pieces(fen_placement):
    pieces = {}
    ranks = fen_placement.split("/")
    files = "abcdefgh"
    char_to_piece = {
        "K": "white_king", "Q": "white_queen", "R": "white_rook",
        "B": "white_bishop", "N": "white_knight", "P": "white_pawn",
        "k": "black_king", "q": "black_queen", "r": "black_rook",
        "b": "black_bishop", "n": "black_knight", "p": "black_pawn",
    }
    for r_idx, rank_str in enumerate(ranks):
        rank_num = 8 - r_idx
        f_idx = 0
        for char in rank_str:
            if char.isdigit():
                f_idx += int(char)
            else:
                sq = f"{files[f_idx]}{rank_num}"
                pieces[sq] = char_to_piece[char]
                f_idx += 1
    return pieces

def main():
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    with open(GT_FILE, "r") as f:
        gt = json.load(f)

    # 1. Lichess Classic Brown (Italian Game)
    fen_lichess_brown = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w - - 0 1"
    pieces_lb = fen_to_pieces(fen_lichess_brown.split()[0])
    img_lb = draw_board(pieces_lb, (240, 217, 181), (181, 136, 99))
    img_lb.save(os.path.join(FIXTURES_DIR, "lichess_brown.png"))
    gt["lichess_brown"] = {
        "pieces_count": len(pieces_lb),
        "fen": fen_lichess_brown,
        "theme": "lichess_brown",
        "is_legal": True,
        "pieces": pieces_lb
    }

    # 2. Lichess Blue Theme (Tactical Endgame)
    fen_lichess_blue = "8/5pk1/4p1p1/7p/3R3P/4PKP1/1r3P2/8 b - - 0 1"
    pieces_blue = fen_to_pieces(fen_lichess_blue.split()[0])
    img_blue = draw_board(pieces_blue, (222, 227, 230), (140, 162, 173))
    img_blue.save(os.path.join(FIXTURES_DIR, "lichess_blue.png"))
    gt["lichess_blue"] = {
        "pieces_count": len(pieces_blue),
        "fen": fen_lichess_blue,
        "theme": "lichess_blue",
        "is_legal": True,
        "pieces": pieces_blue
    }

    # 3. Chess.com Green Theme (Sicilian Defense)
    fen_chesscom_green = "r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w - - 0 1"
    pieces_green = fen_to_pieces(fen_chesscom_green.split()[0])
    img_green = draw_board(pieces_green, (238, 238, 210), (118, 150, 86))
    img_green.save(os.path.join(FIXTURES_DIR, "chesscom_green.png"))
    gt["chesscom_green"] = {
        "pieces_count": len(pieces_green),
        "fen": fen_chesscom_green,
        "theme": "chesscom_green",
        "is_legal": True,
        "pieces": pieces_green
    }

    # 4. Flipped Board (Black at bottom)
    fen_flipped = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1"
    pieces_flipped = fen_to_pieces(fen_flipped.split()[0])
    img_flipped = draw_board(pieces_flipped, (240, 240, 240), (160, 160, 160), is_flipped=True)
    img_flipped.save(os.path.join(FIXTURES_DIR, "board_flipped.png"))
    gt["board_flipped"] = {
        "pieces_count": len(pieces_flipped),
        "fen": fen_flipped,
        "theme": "flipped",
        "is_legal": True,
        "is_flipped": True,
        "pieces": pieces_flipped
    }

    # 5. Low-contrast Book Scan
    fen_low_contrast = "8/8/4k3/8/8/4K3/8/8 w - - 0 1"
    pieces_lc = fen_to_pieces(fen_low_contrast.split()[0])
    img_lc = draw_board(pieces_lc, (215, 215, 215), (195, 195, 195))
    img_lc.save(os.path.join(FIXTURES_DIR, "board_low_contrast.png"))
    gt["board_low_contrast"] = {
        "pieces_count": len(pieces_lc),
        "fen": fen_low_contrast,
        "theme": "low_contrast",
        "is_legal": True,
        "pieces": pieces_lc
    }

    # 6. Illegal Missing King (For Rejection Rate Verification)
    pieces_no_king = {
        "e8": "black_king",
        "e4": "white_pawn",
        "d5": "black_pawn"
    }
    img_no_king = draw_board(pieces_no_king, (240, 217, 181), (181, 136, 99))
    img_no_king.save(os.path.join(FIXTURES_DIR, "illegal_missing_king.png"))
    gt["illegal_missing_king"] = {
        "pieces_count": len(pieces_no_king),
        "fen": "4k3/8/8/3p4/4P3/8/8/8 w - - 0 1",
        "theme": "illegal_test",
        "is_legal": False,
        "expected_rejection_reason": "Missing White King",
        "pieces": pieces_no_king
    }

    # 7. Illegal Touching Kings
    pieces_touching = {
        "e4": "white_king",
        "e5": "black_king"
    }
    img_touching = draw_board(pieces_touching, (240, 217, 181), (181, 136, 99))
    img_touching.save(os.path.join(FIXTURES_DIR, "illegal_touching_kings.png"))
    gt["illegal_touching_kings"] = {
        "pieces_count": len(pieces_touching),
        "fen": "8/8/8/4k3/4K3/8/8/8 w - - 0 1",
        "theme": "illegal_test",
        "is_legal": False,
        "expected_rejection_reason": "Kings are adjacent",
        "pieces": pieces_touching
    }

    with open(GT_FILE, "w") as f:
        json.dump(gt, f, indent=2)

    print(f"Successfully generated 7 benchmark fixtures and updated {GT_FILE}")

if __name__ == "__main__":
    main()

