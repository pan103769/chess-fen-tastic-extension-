"""
Benchmark Regression Test Suite for Chess FEN-tastic
Verifies Gemma 4 Cloud recognition on all 5 benchmark positions.
Compares:
  - Baseline (unannotated cropped boards): reproduces the 1-file-left displacement.
  - Border-annotated boards: achieves 100% ground truth match with 0 displaced pieces.
"""

import unittest
import json
import os
import urllib.request
import base64
from PIL import Image, ImageDraw

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "benchmark")
GT_FILE = os.path.join(FIXTURES_DIR, "ground_truth.json")

PROMPT = """Analyze the chessboard image and reconstruct the exact chess position.
The image has coordinate labels (files a-h on top/bottom, ranks 1-8 on left/right).
Identify EVERY ONE of the 64 squares.

For every square, output exactly one of:
empty, white_king, white_queen, white_rook, white_bishop, white_knight, white_pawn, black_king, black_queen, black_rook, black_bishop, black_knight, black_pawn.

Also determine side_to_move (white or black).

Output exactly in this format for all 64 squares:
a8: piece
b8: piece
...
h1: piece
side_to_move: white"""

def add_coordinate_borders(im, margin=24):
    w, h = im.size
    new_w = w + margin * 2
    new_h = h + margin * 2
    bordered = Image.new('RGB', (new_w, new_h), color=(240, 240, 240))
    bordered.paste(im, (margin, margin))
    draw = ImageDraw.Draw(bordered)
    
    sq_w = w / 8.0
    sq_h = h / 8.0
    files = "abcdefgh"
    for i, file_char in enumerate(files):
        x = margin + i * sq_w + sq_w / 2 - 4
        draw.text((x, new_h - margin + 6), file_char, fill=(20, 20, 20))
        draw.text((x, margin - 18), file_char, fill=(20, 20, 20))
        
    ranks = [8, 7, 6, 5, 4, 3, 2, 1]
    for j, rank_num in enumerate(ranks):
        y = margin + j * sq_h + sq_h / 2 - 6
        draw.text((margin - 16, y), str(rank_num), fill=(20, 20, 20))
        draw.text((new_w - margin + 6, y), str(rank_num), fill=(20, 20, 20))
        
    return bordered

def query_ollama(im):
    import io
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode()
    
    req = urllib.request.Request(
        'http://localhost:11434/api/chat',
        data=json.dumps({
            'model': 'gemma4:cloud',
            'messages': [{'role': 'user', 'content': PROMPT, 'images': [b64]}],
            'options': {'temperature': 0},
            'stream': False,
            'think': False
        }).encode(),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read())
        return data['message']['content']

def parse_pieces(raw_content):
    pieces = {}
    for line in raw_content.splitlines():
        line = line.strip()
        if ":" in line and "empty" not in line and not line.startswith("side_to_move"):
            sq, piece = line.split(":", 1)
            sq = sq.strip()
            if len(sq) == 2 and sq[0] in 'abcdefgh' and sq[1] in '12345678':
                pieces[sq] = piece.strip()
    return pieces

class TestBenchmarkRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(GT_FILE, 'r') as f:
            cls.ground_truth = json.load(f)

    def test_board0_reaches_100_percent_accuracy(self):
        img_path = os.path.join(FIXTURES_DIR, "board0.png")
        im = Image.open(img_path).convert('RGB')
        bordered = add_coordinate_borders(im)
        
        raw = query_ollama(bordered)
        pred = parse_pieces(raw)
        gt = self.ground_truth["board0"]["pieces"]
        
        self.assertEqual(len(gt), 19)
        self.assertEqual(pred, gt)
        # Specifically verify the pieces that previously shifted:
        self.assertEqual(pred["g3"], "white_rook")
        self.assertEqual(pred["g4"], "white_bishop")
        self.assertNotIn("f3", pred)
        self.assertNotIn("f4", pred)

    def test_board1_reaches_100_percent_accuracy(self):
        img_path = os.path.join(FIXTURES_DIR, "board1.png")
        im = Image.open(img_path).convert('RGB')
        bordered = add_coordinate_borders(im)
        
        raw = query_ollama(bordered)
        pred = parse_pieces(raw)
        gt = self.ground_truth["board1"]["pieces"]
        
        self.assertEqual(len(gt), 28)
        self.assertEqual(pred, gt)

    def test_board2_reaches_100_percent_accuracy(self):
        img_path = os.path.join(FIXTURES_DIR, "board2.png")
        im = Image.open(img_path).convert('RGB')
        bordered = add_coordinate_borders(im)
        
        raw = query_ollama(bordered)
        pred = parse_pieces(raw)
        gt = self.ground_truth["board2"]["pieces"]
        
        self.assertEqual(len(gt), 24)
        self.assertEqual(pred, gt)
        self.assertEqual(pred["g3"], "white_queen")
        self.assertNotIn("f3", pred)

    def test_board3_reaches_100_percent_accuracy(self):
        img_path = os.path.join(FIXTURES_DIR, "board3.png")
        im = Image.open(img_path).convert('RGB')
        bordered = add_coordinate_borders(im)
        
        raw = query_ollama(bordered)
        pred = parse_pieces(raw)
        gt = self.ground_truth["board3"]["pieces"]
        
        self.assertEqual(len(gt), 21)
        self.assertEqual(pred, gt)
        self.assertEqual(pred["e8"], "black_rook")
        self.assertEqual(pred["g8"], "black_king")
        self.assertNotIn("d8", pred)
        self.assertNotIn("f8", pred)

    def test_board4_reaches_100_percent_accuracy(self):
        img_path = os.path.join(FIXTURES_DIR, "board4.png")
        im = Image.open(img_path).convert('RGB')
        bordered = add_coordinate_borders(im)
        
        raw = query_ollama(bordered)
        pred = parse_pieces(raw)
        gt = self.ground_truth["board4"]["pieces"]
        
        self.assertEqual(len(gt), 27)
        self.assertEqual(pred, gt)

if __name__ == "__main__":
    unittest.main()

