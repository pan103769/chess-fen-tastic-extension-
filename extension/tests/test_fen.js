/**
 * Unit tests for FEN parsing, generation, and validation logic.
 * Run with: node extension/tests/test_fen.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseBoard, generateFen, validateFen, getBoardUrls } from "../lib/fen.js";
import { EXPECTED_SQUARES } from "../lib/constants.js";

test("Constants: Expected 64 squares in correct order", () => {
  assert.equal(EXPECTED_SQUARES.length, 64);
  assert.equal(EXPECTED_SQUARES[0], "a8");
  assert.equal(EXPECTED_SQUARES[7], "h8");
  assert.equal(EXPECTED_SQUARES[56], "a1");
  assert.equal(EXPECTED_SQUARES[63], "h1");
});

test("FEN Generation: Standard starting position", () => {
  const board = {};
  for (const sq of EXPECTED_SQUARES) {
    board[sq] = "empty";
  }

  // Ranks 8 & 7
  board["a8"] = "black_rook";
  board["b8"] = "black_knight";
  board["c8"] = "black_bishop";
  board["d8"] = "black_queen";
  board["e8"] = "black_king";
  board["f8"] = "black_bishop";
  board["g8"] = "black_knight";
  board["h8"] = "black_rook";
  for (const file of "abcdefgh") {
    board[`${file}7`] = "black_pawn";
  }

  // Ranks 2 & 1
  for (const file of "abcdefgh") {
    board[`${file}2`] = "white_pawn";
  }
  board["a1"] = "white_rook";
  board["b1"] = "white_knight";
  board["c1"] = "white_bishop";
  board["d1"] = "white_queen";
  board["e1"] = "white_king";
  board["f1"] = "white_bishop";
  board["g1"] = "white_knight";
  board["h1"] = "white_rook";

  const fen = generateFen(board, "white");
  assert.equal(fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");
  assert.equal(validateFen(fen), true);
});

test("FEN Generation: Empty board with side to move black", () => {
  const board = {};
  for (const sq of EXPECTED_SQUARES) {
    board[sq] = "empty";
  }

  const fen = generateFen(board, "black");
  assert.equal(fen, "8/8/8/8/8/8/8/8 b - - 0 1");
  assert.equal(validateFen(fen), true);
});

test("FEN Parsing: Raw LLM recognition string to board object", () => {
  let sampleOutput = "";
  for (const sq of EXPECTED_SQUARES) {
    if (sq === "e8") {
      sampleOutput += `${sq}: black_king\n`;
    } else if (sq === "e1") {
      sampleOutput += `${sq}: white_king\n`;
    } else {
      sampleOutput += `${sq}: empty\n`;
    }
  }
  sampleOutput += "side_to_move: black\n";

  const { board, turn, error } = parseBoard(sampleOutput);
  assert.equal(error, undefined);
  assert.equal(turn, "black");
  assert.equal(board["e8"], "black_king");
  assert.equal(board["e1"], "white_king");
  assert.equal(board["a8"], "empty");

  const fen = generateFen(board, turn);
  assert.equal(fen, "4k3/8/8/8/8/8/8/4K3 b - - 0 1");
  assert.equal(validateFen(fen), true);
});

test("FEN Validation: Valid and invalid strings", () => {
  assert.equal(validateFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"), true);
  assert.equal(validateFen("8/8/8/8/8/8/8/8 b - - 0 1"), true);

  // Invalid cases
  assert.equal(validateFen(""), false);
  assert.equal(validateFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"), false); // missing parts
  assert.equal(validateFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0"), false); // only 5 parts
  assert.equal(validateFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR/8 w - - 0 1"), false); // 9 ranks
  assert.equal(validateFen("rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"), false); // rank sum 9
  assert.equal(validateFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x - - 0 1"), false); // invalid turn
});

test("Board URLs: Generates valid Lichess and Chess.com URLs", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";
  const urls = getBoardUrls(fen);
  assert.ok(urls.lichess.includes("lichess.org/editor/rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_-_-_0_1"));
  assert.ok(urls.chessCom.includes("chess.com/analysis?fen="));
});

