/**
 * Unit Tests for Board Analyzer and Cross-Validation Logic
 * Run with: node extension/tests/test_board_analyzer.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getLuminance,
  analyzeSquareRegion,
  extractAndAnalyzeBoardSquares,
  crossValidatePredictions,
} from "../lib/board-analyzer.js";

test("Luminance calculation matches standard RGB weights", () => {
  assert.equal(getLuminance(255, 255, 255), 255);
  assert.equal(getLuminance(0, 0, 0), 0);
  const greenLum = getLuminance(0, 255, 0);
  assert.ok(greenLum > 140, "Green contributes most to luminance");
});

test("Square region analysis detects empty square with high confidence", () => {
  // Create a 20x20 uniform gray square (empty square)
  const width = 20;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 180;     // R
    data[i + 1] = 180; // G
    data[i + 2] = 180; // B
    data[i + 3] = 255; // A
  }

  const analysis = analyzeSquareRegion({ data, width, height }, 0, 0, width, height);
  assert.equal(analysis.occupancy, "empty");
  assert.ok(analysis.stdDev < 1.0);
  assert.ok(analysis.baseConfidence >= 0.95);
});

test("Square region analysis detects occupied square with piece", () => {
  // Create a 20x20 square with dark background and bright white piece in center
  const width = 20;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isCenter = x >= 5 && x <= 15 && y >= 5 && y <= 15;
      const val = isCenter ? 250 : 80;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }

  const analysis = analyzeSquareRegion({ data, width, height }, 0, 0, width, height);
  assert.equal(analysis.occupancy, "occupied");
  assert.equal(analysis.detectedColor, "white");
  assert.ok(analysis.stdDev > 20);
});

test("Cross-validation flags ghost piece and color conflicts", () => {
  const modelBoard = {
    e4: "white_pawn", // Ghost piece: visual analysis sees empty square
    d4: "black_pawn", // Visual analysis sees white piece
    a8: "black_rook", // Both agree!
  };

  const squareAnalysis = {
    e4: {
      occupancy: "empty",
      stdDev: 2.0,
      detectedColor: "unknown",
      baseConfidence: 0.99,
    },
    d4: {
      occupancy: "occupied",
      stdDev: 35.0,
      detectedColor: "white", // Opposing color!
      baseConfidence: 0.95,
    },
    a8: {
      occupancy: "occupied",
      stdDev: 30.0,
      detectedColor: "black",
      baseConfidence: 0.98,
    },
  };

  const report = crossValidatePredictions(modelBoard, squareAnalysis);
  assert.equal(report.isVerified, false);
  assert.ok(report.flaggedSquares.includes("e4"));
  assert.ok(report.flaggedSquares.includes("d4"));
  assert.ok(!report.flaggedSquares.includes("a8"));
  assert.ok(report.conflicts.some((c) => c.square === "e4" && c.reason.includes("Ghost piece")));
  assert.ok(report.conflicts.some((c) => c.square === "d4" && c.reason.includes("Color mismatch")));
});

