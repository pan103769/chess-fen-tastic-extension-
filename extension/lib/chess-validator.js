/**
 * Chess Legality and Rule Validation Engine (Manifest V3 Compliant)
 * Enforces FIDE standard chess constraints:
 * - Exactly one White King and one Black King
 * - Kings cannot be on adjacent squares
 * - Maximum 16 pieces and 8 pawns per side
 * - No pawns on the 1st or 8th rank
 * - Both kings cannot be in check simultaneously
 * - Non-moving player's king cannot be in check
 * - Distinguishes board-placement FEN from game-state FEN without inventing unobservable state
 */

import { FILES, RANKS, PIECE_TO_FEN, FEN_TO_PIECE } from "./constants.js";

/**
 * Converts algebraic square notation (e.g. 'e4') to 0-indexed file and rank coordinates.
 * file: 'a'=0 .. 'h'=7
 * rank: '1'=0 .. '8'=7
 * @param {string} square
 * @returns {{ fileIdx: number, rankIdx: number } | null}
 */
export function squareToCoords(square) {
  if (!square || square.length !== 2) return null;
  const f = square[0].toLowerCase();
  const r = square[1];
  const fileIdx = FILES.indexOf(f);
  const rankNum = parseInt(r, 10);
  if (fileIdx === -1 || isNaN(rankNum) || rankNum < 1 || rankNum > 8) return null;
  return { fileIdx, rankIdx: rankNum - 1 };
}

/**
 * Converts 0-indexed file and rank coordinates to algebraic square notation.
 * @param {number} fileIdx
 * @param {number} rankIdx
 * @returns {string | null}
 */
export function coordsToSquare(fileIdx, rankIdx) {
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return `${FILES[fileIdx]}${rankIdx + 1}`;
}

/**
 * Checks whether a given square is attacked by pieces of a specified color.
 * @param {string} square Target square (e.g. 'e4')
 * @param {'white'|'black'} attackerColor Color of attacking pieces
 * @param {Object.<string, string>} board 64-square map of pieces
 * @returns {boolean}
 */
export function isSquareAttacked(square, attackerColor, board) {
  const coords = squareToCoords(square);
  if (!coords) return false;
  const { fileIdx, rankIdx } = coords;

  const opponentPawn = `${attackerColor}_pawn`;
  const opponentKnight = `${attackerColor}_knight`;
  const opponentBishop = `${attackerColor}_bishop`;
  const opponentRook = `${attackerColor}_rook`;
  const opponentQueen = `${attackerColor}_queen`;
  const opponentKing = `${attackerColor}_king`;

  // 1. Pawn attacks
  // White pawns move upwards (+rankIdx), so they attack e4 from d3/f3 (rankIdx - 1)
  // Black pawns move downwards (-rankIdx), so they attack e4 from d5/f5 (rankIdx + 1)
  const pawnRankOffset = attackerColor === "white" ? -1 : 1;
  const pawnAttackRank = rankIdx + pawnRankOffset;
  if (pawnAttackRank >= 0 && pawnAttackRank <= 7) {
    for (const fileOffset of [-1, 1]) {
      const pawnFile = fileIdx + fileOffset;
      if (pawnFile >= 0 && pawnFile <= 7) {
        const sq = coordsToSquare(pawnFile, pawnAttackRank);
        if (board[sq] === opponentPawn) return true;
      }
    }
  }

  // 2. Knight attacks (8 L-shaped moves)
  const knightDeltas = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  for (const [df, dr] of knightDeltas) {
    const f = fileIdx + df;
    const r = rankIdx + dr;
    if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = coordsToSquare(f, r);
      if (board[sq] === opponentKnight) return true;
    }
  }

  // 3. King attacks (8 adjacent squares)
  const kingDeltas = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];
  for (const [df, dr] of kingDeltas) {
    const f = fileIdx + df;
    const r = rankIdx + dr;
    if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = coordsToSquare(f, r);
      if (board[sq] === opponentKing) return true;
    }
  }

  // 4. Orthogonal ray attacks (Rooks & Queens)
  const orthogonalDirs = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
  ];
  for (const [df, dr] of orthogonalDirs) {
    let f = fileIdx + df;
    let r = rankIdx + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = coordsToSquare(f, r);
      const piece = board[sq];
      if (piece && piece !== "empty") {
        if (piece === opponentRook || piece === opponentQueen) {
          return true;
        }
        break; // Blocked by another piece
      }
      f += df;
      r += dr;
    }
  }

  // 5. Diagonal ray attacks (Bishops & Queens)
  const diagonalDirs = [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (const [df, dr] of diagonalDirs) {
    let f = fileIdx + df;
    let r = rankIdx + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const sq = coordsToSquare(f, r);
      const piece = board[sq];
      if (piece && piece !== "empty") {
        if (piece === opponentBishop || piece === opponentQueen) {
          return true;
        }
        break; // Blocked by another piece
      }
      f += df;
      r += dr;
    }
  }

  return false;
}

/**
 * Validates chess legality for a board position.
 * @param {Object.<string, string>} board 64-square piece dictionary
 * @param {string} turn 'white' or 'black'
 * @returns {{
 *   isValid: boolean,
 *   status: 'VERIFIED' | 'NEEDS_REVIEW' | 'INVALID',
 *   errors: string[],
 *   warnings: string[],
 *   kingPositions: { white: string | null, black: string | null },
 *   checks: { whiteInCheck: boolean, blackInCheck: boolean },
 *   pieceCounts: Object.<string, number>
 * }}
 */
export function validateChessLegality(board, turn = "white") {
  const errors = [];
  const warnings = [];

  if (!board || typeof board !== "object") {
    return {
      isValid: false,
      status: "INVALID",
      errors: ["Invalid board state provided."],
      warnings: [],
      kingPositions: { white: null, black: null },
      checks: { whiteInCheck: false, blackInCheck: false },
      pieceCounts: {},
    };
  }

  let whiteKingCount = 0;
  let blackKingCount = 0;
  let whiteKingSq = null;
  let blackKingSq = null;

  let whitePieceCount = 0;
  let blackPieceCount = 0;
  let whitePawnCount = 0;
  let blackPawnCount = 0;

  const pawnsOnRank1Or8 = [];

  for (const [square, piece] of Object.entries(board)) {
    if (!piece || piece === "empty") continue;

    if (piece.startsWith("white_")) {
      whitePieceCount++;
      if (piece === "white_king") {
        whiteKingCount++;
        whiteKingSq = square;
      } else if (piece === "white_pawn") {
        whitePawnCount++;
        const rank = square[1];
        if (rank === "1" || rank === "8") {
          pawnsOnRank1Or8.push({ square, piece });
        }
      }
    } else if (piece.startsWith("black_")) {
      blackPieceCount++;
      if (piece === "black_king") {
        blackKingCount++;
        blackKingSq = square;
      } else if (piece === "black_pawn") {
        blackPawnCount++;
        const rank = square[1];
        if (rank === "1" || rank === "8") {
          pawnsOnRank1Or8.push({ square, piece });
        }
      }
    }
  }

  // 1. King Counts
  if (whiteKingCount !== 1) {
    errors.push(
      whiteKingCount === 0
        ? "Illegal position: Missing White King."
        : `Illegal position: Multiple White Kings detected (${whiteKingCount}).`
    );
  }

  if (blackKingCount !== 1) {
    errors.push(
      blackKingCount === 0
        ? "Illegal position: Missing Black King."
        : `Illegal position: Multiple Black Kings detected (${blackKingCount}).`
    );
  }

  // 2. King Proximity
  if (whiteKingSq && blackKingSq) {
    const wkCoords = squareToCoords(whiteKingSq);
    const bkCoords = squareToCoords(blackKingSq);
    if (wkCoords && bkCoords) {
      const fileDist = Math.abs(wkCoords.fileIdx - bkCoords.fileIdx);
      const rankDist = Math.abs(wkCoords.rankIdx - bkCoords.rankIdx);
      if (fileDist <= 1 && rankDist <= 1) {
        errors.push(
          `Illegal position: Kings are adjacent (${whiteKingSq} and ${blackKingSq}).`
        );
      }
    }
  }

  // 3. Pawn placement rules
  if (pawnsOnRank1Or8.length > 0) {
    const locations = pawnsOnRank1Or8.map((p) => `${p.piece} on ${p.square}`).join(", ");
    errors.push(`Illegal position: Pawns cannot exist on 1st or 8th rank (${locations}).`);
  }

  // 4. Piece limits
  if (whitePieceCount > 16) {
    errors.push(`Illegal position: White has ${whitePieceCount} pieces (maximum 16).`);
  }
  if (blackPieceCount > 16) {
    errors.push(`Illegal position: Black has ${blackPieceCount} pieces (maximum 16).`);
  }

  if (whitePawnCount > 8) {
    errors.push(`Illegal position: White has ${whitePawnCount} pawns (maximum 8).`);
  }
  if (blackPawnCount > 8) {
    errors.push(`Illegal position: Black has ${blackPawnCount} pawns (maximum 8).`);
  }

  // 5. Check calculations
  let whiteInCheck = false;
  let blackInCheck = false;

  if (whiteKingSq) {
    whiteInCheck = isSquareAttacked(whiteKingSq, "black", board);
  }
  if (blackKingSq) {
    blackInCheck = isSquareAttacked(blackKingSq, "white", board);
  }

  // Both kings cannot be in check simultaneously
  if (whiteInCheck && blackInCheck) {
    errors.push("Illegal position: Both White and Black kings are in check simultaneously.");
  }

  // Side to move legality: Opponent cannot be in check on player's turn
  const normalizedTurn = (turn || "white").toLowerCase().startsWith("b") ? "black" : "white";
  if (normalizedTurn === "white" && blackInCheck) {
    errors.push(
      "Illegal position: Black king is in check, but it is White's turn to move."
    );
  } else if (normalizedTurn === "black" && whiteInCheck) {
    errors.push(
      "Illegal position: White king is in check, but it is Black's turn to move."
    );
  }

  const isValid = errors.length === 0;
  const status = isValid ? "VERIFIED" : "INVALID";

  return {
    isValid,
    status,
    errors,
    warnings,
    kingPositions: { white: whiteKingSq, black: blackKingSq },
    checks: { whiteInCheck, blackInCheck },
    pieceCounts: {
      whiteTotal: whitePieceCount,
      blackTotal: blackPieceCount,
      whitePawns: whitePawnCount,
      blackPawns: blackPawnCount,
    },
  };
}

/**
 * Extracts pure piece placement FEN (ranks 8 to 1) from board dictionary.
 * Does not append turn, castling, or move clocks.
 * @param {Object.<string, string>} board
 * @returns {string}
 */
export function generatePiecePlacementFen(board) {
  const fenRanks = [];
  for (const rank of RANKS) {
    let rankStr = "";
    let emptyCount = 0;

    for (const file of FILES) {
      const square = `${file}${rank}`;
      const piece = board[square];
      if (!piece || piece === "empty") {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rankStr += emptyCount;
          emptyCount = 0;
        }
        const char = PIECE_TO_FEN[piece] || "";
        rankStr += char;
      }
    }

    if (emptyCount > 0) {
      rankStr += emptyCount;
    }
    fenRanks.push(rankStr);
  }
  return fenRanks.join("/");
}

/**
 * Generates valid FEN string without inventing unobservable game state.
 * Static images cannot establish castling rights or en passant history, so uses '-' safely.
 * @param {Object.<string, string>} board
 * @param {string} turn
 * @returns {string}
 */
export function generateSafeFen(board, turn = "white") {
  const placement = generatePiecePlacementFen(board);
  const side = (turn || "white").toLowerCase().startsWith("b") ? "b" : "w";
  return `${placement} ${side} - - 0 1`;
}

