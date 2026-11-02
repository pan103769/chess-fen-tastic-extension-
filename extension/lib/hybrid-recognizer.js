/**
 * Hybrid Multimodal + Computer Vision Recognizer & Verifier
 * Orchestrates:
 * - Square extraction and local pixel analysis
 * - Multimodal vision model inference (Gemma 4 Cloud / Gemini / Local)
 * - Cross-validation of predictions against local square analysis
 * - FIDE chess rule legality validation
 * - Dynamic verification status determination: VERIFIED, NEEDS_REVIEW, INVALID
 */

import { parseBoard } from "./fen.js";
import { recognizeChessboard } from "./vision-api.js";
import { validateChessLegality, generateSafeFen } from "./chess-validator.js";
import { crossValidatePredictions, extractAndAnalyzeBoardSquares } from "./board-analyzer.js";
import { getBoardUrls, validateFen } from "./fen.js";
import { VERIFICATION_STATUS } from "./constants.js";

/**
 * Runs the complete hybrid recognition pipeline.
 * @param {string} croppedDataUrl
 * @param {Object} settings
 * @param {Object} [options]
 * @param {ImageData|Object} [options.pixelBuffer] Optional pre-extracted pixel buffer for square analysis
 * @returns {Promise<{
 *   fen: string,
 *   isValid: boolean,
 *   status: 'VERIFIED' | 'NEEDS_REVIEW' | 'INVALID',
 *   statusMessage: string,
 *   turn: string,
 *   board: Object.<string, string>,
 *   squareConfidences: Object.<string, number>,
 *   overallConfidence: number,
 *   flaggedSquares: string[],
 *   conflicts: Array<{ square: string, reason: string }>,
 *   legalityErrors: string[],
 *   checks: { whiteInCheck: boolean, blackInCheck: boolean },
 *   pieceCounts: Object.<string, number>,
 *   urls: { lichess: string, chessCom: string },
 *   timestamp: number
 * }>}
 */
export async function runHybridRecognition(croppedDataUrl, settings = {}, options = {}) {
  // 1. Run square-level CV feature extraction if pixel buffer provided
  let squareAnalysis = null;
  if (options.pixelBuffer) {
    try {
      squareAnalysis = extractAndAnalyzeBoardSquares(options.pixelBuffer);
    } catch (err) {
      console.warn("Square-level CV analysis skipped:", err);
    }
  }

  // 2. Multimodal AI Recognition (Gemma 4 Cloud default)
  const visionOutput = await recognizeChessboard(croppedDataUrl, settings);

  // 3. Parse 64 squares from model text output
  const { board, turn, error: parseError } = parseBoard(visionOutput);
  if (parseError || !board) {
    throw new Error(parseError || "Failed to extract 64 squares from vision output.");
  }

  // 4. Cross-validate model predictions against square CV analysis
  const crossValidation = crossValidatePredictions(board, squareAnalysis);

  // 5. Enforce chess legality constraints
  const legality = validateChessLegality(board, turn);

  // 6. Generate standard FEN
  const fen = generateSafeFen(board, turn);
  const isValidFenFormat = validateFen(fen);

  // 7. Determine final verification status
  let status = VERIFICATION_STATUS.VERIFIED;
  let statusMessage = "Position verified: 64 squares verified and legal.";

  if (!legality.isValid) {
    status = VERIFICATION_STATUS.INVALID;
    statusMessage = `Legality violation: ${legality.errors.join("; ")}`;
  } else if (!crossValidation.isVerified || crossValidation.flaggedSquares.length > 0) {
    status = VERIFICATION_STATUS.NEEDS_REVIEW;
    statusMessage = `Needs review on square(s): ${crossValidation.flaggedSquares.join(", ")}`;
  }

  const urls = getBoardUrls(fen);

  return {
    fen,
    isValid: legality.isValid && isValidFenFormat,
    status,
    statusMessage,
    turn,
    board,
    squareConfidences: crossValidation.squareConfidences,
    overallConfidence: crossValidation.overallConfidence,
    flaggedSquares: crossValidation.flaggedSquares,
    conflicts: crossValidation.conflicts,
    legalityErrors: legality.errors,
    checks: legality.checks,
    pieceCounts: legality.pieceCounts,
    urls,
    timestamp: Date.now(),
  };
}

