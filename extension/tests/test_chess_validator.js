/**
 * Comprehensive Unit Tests for Chess Legality Validator
 * Run with: node extension/tests/test_chess_validator.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  squareToCoords,
  coordsToSquare,
  isSquareAttacked,
  validateChessLegality,
  generatePiecePlacementFen,
  generateSafeFen,
} from "../lib/chess-validator.js";

test("Coordinates conversion: algebraic to 0-indexed and back", () => {
  assert.deepEqual(squareToCoords("a1"), { fileIdx: 0, rankIdx: 0 });
  assert.deepEqual(squareToCoords("h8"), { fileIdx: 7, rankIdx: 7 });
  assert.deepEqual(squareToCoords("e4"), { fileIdx: 4, rankIdx: 3 });
  assert.equal(squareToCoords("z9"), null);
  assert.equal(squareToCoords(""), null);

  assert.equal(coordsToSquare(0, 0), "a1");
  assert.equal(coordsToSquare(7, 7), "h8");
  assert.equal(coordsToSquare(4, 3), "e4");
  assert.equal(coordsToSquare(8, 0), null);
});

test("Legality: Standard starting position passes validation", () => {
  const board = {
    a8: "black_rook", b8: "black_knight", c8: "black_bishop", d8: "black_queen",
    e8: "black_king", f8: "black_bishop", g8: "black_knight", h8: "black_rook",
    a7: "black_pawn", b7: "black_pawn", c7: "black_pawn", d7: "black_pawn",
    e7: "black_pawn", f7: "black_pawn", g7: "black_pawn", h7: "black_pawn",
    a2: "white_pawn", b2: "white_pawn", c2: "white_pawn", d2: "white_pawn",
    e2: "white_pawn", f2: "white_pawn", g2: "white_pawn", h2: "white_pawn",
    a1: "white_rook", b1: "white_knight", c1: "white_bishop", d1: "white_queen",
    e1: "white_king", f1: "white_bishop", g1: "white_knight", h1: "white_rook",
  };

  const report = validateChessLegality(board, "white");
  assert.equal(report.isValid, true);
  assert.equal(report.status, "VERIFIED");
  assert.equal(report.errors.length, 0);
  assert.equal(report.checks.whiteInCheck, false);
  assert.equal(report.checks.blackInCheck, false);
  assert.equal(report.pieceCounts.whiteTotal, 16);
  assert.equal(report.pieceCounts.blackTotal, 16);

  const placement = generatePiecePlacementFen(board);
  assert.equal(placement, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
  const fullFen = generateSafeFen(board, "white");
  assert.equal(fullFen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");
});

test("Legality: Missing white or black king flags illegal", () => {
  // Missing white king
  const noWhiteKing = {
    e8: "black_king",
    e4: "white_pawn",
  };
  const rep1 = validateChessLegality(noWhiteKing, "white");
  assert.equal(rep1.isValid, false);
  assert.equal(rep1.status, "INVALID");
  assert.ok(rep1.errors.some((e) => e.includes("Missing White King")));

  // Missing black king
  const noBlackKing = {
    e1: "white_king",
    e4: "white_pawn",
  };
  const rep2 = validateChessLegality(noBlackKing, "white");
  assert.equal(rep2.isValid, false);
  assert.ok(rep2.errors.some((e) => e.includes("Missing Black King")));
});

test("Legality: Multiple kings of same color flags illegal", () => {
  const multiKing = {
    e1: "white_king",
    d1: "white_king",
    e8: "black_king",
  };
  const report = validateChessLegality(multiKing, "white");
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("Multiple White Kings")));
});

test("Legality: Adjacent kings cannot touch", () => {
  const touchingKings = {
    e4: "white_king",
    e5: "black_king",
  };
  const report = validateChessLegality(touchingKings, "white");
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("Kings are adjacent")));
});

test("Legality: Pawns on 1st or 8th rank flag illegal", () => {
  const illegalPawn = {
    e1: "white_king",
    e8: "black_king",
    a1: "white_pawn",
    h8: "black_pawn",
  };
  const report = validateChessLegality(illegalPawn, "white");
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("Pawns cannot exist on 1st or 8th rank")));
});

test("Legality: Maximum piece limits per side", () => {
  const tooManyPawns = {
    e1: "white_king",
    e8: "black_king",
    a2: "white_pawn", b2: "white_pawn", c2: "white_pawn", d2: "white_pawn",
    e2: "white_pawn", f2: "white_pawn", g2: "white_pawn", h2: "white_pawn",
    a3: "white_pawn", // 9th white pawn!
  };
  const report = validateChessLegality(tooManyPawns, "white");
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("White has 9 pawns (maximum 8)")));
});

test("Legality: Both kings in check simultaneously flags illegal", () => {
  const dualCheck = {
    e1: "white_king",
    e8: "black_king",
    e2: "black_rook", // attacks white king on e1
    e7: "white_rook", // attacks black king on e8
  };
  const report = validateChessLegality(dualCheck, "white");
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((e) => e.includes("Both White and Black kings are in check")));
});

test("Legality: Opponent cannot be in check on current player's turn", () => {
  const illegalTurnCheck = {
    e1: "white_king",
    e8: "black_king",
    e2: "white_rook", // attacks e8; black is in check!
  };
  // If it is White's turn, Black cannot already be in check
  const reportWhiteTurn = validateChessLegality(illegalTurnCheck, "white");
  assert.equal(reportWhiteTurn.isValid, false);
  assert.ok(reportWhiteTurn.errors.some((e) => e.includes("Black king is in check, but it is White's turn")));

  // But if it is Black's turn to move out of check, it is legal!
  const reportBlackTurn = validateChessLegality(illegalTurnCheck, "black");
  assert.equal(reportBlackTurn.isValid, true);
  assert.equal(reportBlackTurn.checks.blackInCheck, true);
});

test("Attacks: Knight and ray attacks calculation", () => {
  const board = {
    e4: "empty",
    c3: "white_knight", // attacks e4 (df=+2, dr=+1)
    e1: "black_rook",   // attacks e4 along file e
    b1: "white_bishop", // attacks e4 along diagonal (c2, d3, e4)
    h4: "black_queen",  // attacks e4 along rank 4
  };

  assert.equal(isSquareAttacked("e4", "white", board), true);
  assert.equal(isSquareAttacked("e4", "black", board), true);
  assert.equal(isSquareAttacked("a8", "white", board), false);
});

