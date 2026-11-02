/**
 * Hybrid Computer Vision & Square Analysis Module (Stage 1, 2, 3, 4, 6)
 * Slices chessboard into 64 normalized squares, extracts local pixel statistics,
 * determines square occupancy and piece color, and cross-validates against multimodal AI.
 */

import { FILES, RANKS, EXPECTED_SQUARES } from "./constants.js";

/**
 * Calculates luminance from RGB values.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0-255 luminance
 */
export function getLuminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Extracts statistical features for a specific square region from raw RGBA pixel data.
 * @param {{ data: Uint8ClampedArray|number[], width: number, height: number }} imageBuffer
 * @param {number} startX X coordinate of top-left corner
 * @param {number} startY Y coordinate of top-left corner
 * @param {number} sqWidth Width of square
 * @param {number} sqHeight Height of square
 * @returns {{
 *   bgLuminance: number,
 *   centerLuminance: number,
 *   variance: number,
 *   stdDev: number,
 *   contrastDelta: number,
 *   occupancy: 'empty'|'occupied',
 *   detectedColor: 'white'|'black'|'unknown',
 *   baseConfidence: number
 * }}
 */
export function analyzeSquareRegion(imageBuffer, startX, startY, sqWidth, sqHeight) {
  const { data, width } = imageBuffer;

  const cornerLuminances = [];
  const centerLuminances = [];

  // Define inner center region (inner 60% of the square)
  const centerMarginX = Math.floor(sqWidth * 0.2);
  const centerMarginY = Math.floor(sqHeight * 0.2);

  for (let y = 0; y < sqHeight; y++) {
    const curY = startY + y;
    for (let x = 0; x < sqWidth; x++) {
      const curX = startX + x;
      const idx = (curY * width + curX) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = getLuminance(r, g, b);

      const isCorner =
        (x < centerMarginX || x >= sqWidth - centerMarginX) &&
        (y < centerMarginY || y >= sqHeight - centerMarginY);
      const isCenter =
        x >= centerMarginX &&
        x < sqWidth - centerMarginX &&
        y >= centerMarginY &&
        y < sqHeight - centerMarginY;

      if (isCorner) {
        cornerLuminances.push(lum);
      } else if (isCenter) {
        centerLuminances.push(lum);
      }
    }
  }

  // Calculate background (corner) mean luminance
  const bgSum = cornerLuminances.reduce((a, b) => a + b, 0);
  const bgLuminance = cornerLuminances.length ? bgSum / cornerLuminances.length : 128;

  // Calculate center mean and variance
  const centerSum = centerLuminances.reduce((a, b) => a + b, 0);
  const centerCount = centerLuminances.length || 1;
  const centerLuminance = centerSum / centerCount;

  let varianceSum = 0;
  for (let i = 0; i < centerCount; i++) {
    const diff = centerLuminances[i] - centerLuminance;
    varianceSum += diff * diff;
  }
  const variance = varianceSum / centerCount;
  const stdDev = Math.sqrt(variance);
  const contrastDelta = Math.abs(centerLuminance - bgLuminance);

  // Heuristic thresholds for piece occupancy:
  // Empty squares have very uniform center pixels with low stdDev and low contrast delta from corners.
  // Occupied squares have piece outlines, shading, and high contrast against background.
  const isOccupied = stdDev >= 13.0 || contrastDelta >= 16.0;
  const occupancy = isOccupied ? "occupied" : "empty";

  // Piece color estimation
  let detectedColor = "unknown";
  if (isOccupied) {
    // For white pieces: center luminance is high or lighter than background
    // For black pieces: center luminance is dark or darker than background
    if (centerLuminance > bgLuminance + 15 || centerLuminance > 165) {
      detectedColor = "white";
    } else if (centerLuminance < bgLuminance - 15 || centerLuminance < 115) {
      detectedColor = "black";
    } else {
      // Look at extreme values in the center:
      const minLum = Math.min(...centerLuminances);
      const maxLum = Math.max(...centerLuminances);
      if (minLum < 60) {
        detectedColor = "black";
      } else if (maxLum > 200) {
        detectedColor = "white";
      }
    }
  }

  // Confidence calculation
  let baseConfidence = 0.95;
  if (!isOccupied) {
    baseConfidence = stdDev < 8 ? 0.99 : 0.92;
  } else {
    baseConfidence = detectedColor !== "unknown" ? 0.95 : 0.82;
  }

  return {
    bgLuminance,
    centerLuminance,
    variance,
    stdDev,
    contrastDelta,
    occupancy,
    detectedColor,
    baseConfidence,
  };
}

/**
 * Slices a chessboard image buffer into 64 normalized squares and extracts features.
 * @param {{ data: Uint8ClampedArray|number[], width: number, height: number }} imageBuffer
 * @param {boolean} [isFlipped=false] true if black is at bottom
 * @returns {Object.<string, ReturnType<typeof analyzeSquareRegion>>}
 */
export function extractAndAnalyzeBoardSquares(imageBuffer, isFlipped = false) {
  const { width, height } = imageBuffer;
  const sqW = width / 8.0;
  const sqH = height / 8.0;

  const squareData = {};
  const ranks = isFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = isFlipped ? "hgfedcba" : "abcdefgh";

  for (let rIdx = 0; rIdx < 8; rIdx++) {
    const rankNum = ranks[rIdx];
    const startY = Math.round(rIdx * sqH);
    const actualSqH = Math.round((rIdx + 1) * sqH) - startY;

    for (let fIdx = 0; fIdx < 8; fIdx++) {
      const fileChar = files[fIdx];
      const square = `${fileChar}${rankNum}`;
      const startX = Math.round(fIdx * sqW);
      const actualSqW = Math.round((fIdx + 1) * sqW) - startX;

      squareData[square] = analyzeSquareRegion(
        imageBuffer,
        startX,
        startY,
        actualSqW,
        actualSqH
      );
    }
  }

  return squareData;
}

/**
 * Cross-validates Vision Model (Gemma 4 Cloud) square predictions against square-level computer vision analysis.
 * Identifies disagreements, flags ambiguous squares, and computes confidence scores.
 * @param {Object.<string, string>} modelBoard 64-square piece dictionary from vision model
 * @param {Object.<string, ReturnType<typeof analyzeSquareRegion>>} squareAnalysis 64-square pixel analysis
 * @returns {{
 *   overallConfidence: number,
 *   squareConfidences: Object.<string, number>,
 *   flaggedSquares: string[],
 *   conflicts: Array<{ square: string, modelPiece: string, detected: string, reason: string }>,
 *   isVerified: boolean
 * }}
 */
export function crossValidatePredictions(modelBoard, squareAnalysis) {
  const squareConfidences = {};
  const conflicts = [];
  const flaggedSquares = [];

  let totalConfidence = 0;

  for (const square of EXPECTED_SQUARES) {
    const modelPiece = modelBoard[square] || "empty";
    const analysis = squareAnalysis ? squareAnalysis[square] : null;

    let conf = 0.95;

    if (analysis) {
      const isModelEmpty = modelPiece === "empty";
      const isAnalysisEmpty = analysis.occupancy === "empty";

      if (isModelEmpty && isAnalysisEmpty) {
        // High agreement on empty square
        conf = 0.99;
      } else if (!isModelEmpty && !isAnalysisEmpty) {
        // Both agree square is occupied
        const modelColor = modelPiece.startsWith("white_") ? "white" : "black";
        if (analysis.detectedColor === "unknown" || analysis.detectedColor === modelColor) {
          conf = 0.98;
        } else {
          // Color conflict! Model predicted White piece, analysis detected Black piece (or vice-versa)
          conf = 0.55;
          conflicts.push({
            square,
            modelPiece,
            detected: analysis.detectedColor,
            reason: `Color mismatch: Model predicted ${modelPiece}, but visual analysis detected ${analysis.detectedColor} piece.`,
          });
          flaggedSquares.push(square);
        }
      } else if (isModelEmpty && !isAnalysisEmpty && analysis.stdDev > 24) {
        // Occupancy conflict: Model marked empty, but square has significant piece features
        conf = 0.45;
        conflicts.push({
          square,
          modelPiece: "empty",
          detected: "occupied",
          reason: `Occupancy conflict: Model reported empty square, but visual texture indicates a piece.`,
        });
        flaggedSquares.push(square);
      } else if (!isModelEmpty && isAnalysisEmpty && analysis.stdDev < 8) {
        // Ghost piece conflict: Model reported a piece, but square is completely uniform blank
        conf = 0.40;
        conflicts.push({
          square,
          modelPiece,
          detected: "empty",
          reason: `Ghost piece: Model predicted ${modelPiece}, but square is visually blank.`,
        });
        flaggedSquares.push(square);
      } else {
        conf = analysis.baseConfidence;
      }
    } else {
      // Fallback if no square analysis was available
      conf = modelPiece === "empty" ? 0.95 : 0.92;
    }

    squareConfidences[square] = Math.round(conf * 100) / 100;
    totalConfidence += conf;

    if (conf < 0.85 && !flaggedSquares.includes(square)) {
      flaggedSquares.push(square);
    }
  }

  const overallConfidence = Math.round((totalConfidence / 64) * 100) / 100;
  const isVerified = flaggedSquares.length === 0 && overallConfidence >= 0.90;

  return {
    overallConfidence,
    squareConfidences,
    flaggedSquares,
    conflicts,
    isVerified,
  };
}

