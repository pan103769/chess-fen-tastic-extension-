/**
 * FEN Generation and Validation Module
 * Ports and enhances the original Python Chess FEN-tastic logic for ES6 / Node.js
 */

import { FILES, RANKS, EXPECTED_SQUARES, PIECE_TO_FEN } from "./constants.js";

/**
 * Parses raw LLM text into a 64-square dictionary and turn indicator.
 * @param {string} content
 * @returns {{ board: Object.<string, string> | null, turn: string | null, error?: string }}
 */
export function parseBoard(content) {
  if (!content || typeof content !== "string") {
    return { board: null, turn: null, error: "Empty or invalid vision model output." };
  }

  const board = {};
  let turn = "white";

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.toLowerCase().startsWith("side_to_move:")) {
      const parsedTurn = line.split(":", 2)[1].trim().toLowerCase();
      if (parsedTurn === "white" || parsedTurn === "w") {
        turn = "white";
      } else if (parsedTurn === "black" || parsedTurn === "b") {
        turn = "black";
      }
      continue;
    }

    if (!line.includes(":")) continue;

    const parts = line.split(":", 2);
    const square = parts[0].trim().toLowerCase();
    const piece = parts[1].trim().toLowerCase();

    if (EXPECTED_SQUARES.includes(square)) {
      board[square] = piece;
    }
  }

  const missing = EXPECTED_SQUARES.filter((sq) => !(sq in board));
  if (missing.length > 0) {
    return {
      board: null,
      turn: null,
      error: `Missing squares from recognition output: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`,
    };
  }

  return { board, turn };
}

/**
 * Converts a 64-square dictionary and turn indicator into a valid FEN string.
 * @param {Object.<string, string>} board
 * @param {string} turn
 * @returns {string | null}
 */
export function generateFen(board, turn = "white") {
  if (!board) return null;

  const fenRanks = [];

  for (const rank of RANKS) {
    let fenRank = "";
    let emptyCount = 0;

    for (const file of FILES) {
      const square = `${file}${rank}`;
      const piece = board[square];

      if (piece === "empty" || !piece) {
        emptyCount += 1;
      } else {
        if (emptyCount > 0) {
          fenRank += emptyCount.toString();
          emptyCount = 0;
        }

        const fenChar = PIECE_TO_FEN[piece];
        if (fenChar === undefined) {
          console.error(`Unknown piece '${piece}' on square ${square}`);
          return null;
        }

        fenRank += fenChar;
      }
    }

    if (emptyCount > 0) {
      fenRank += emptyCount.toString();
    }

    fenRanks.push(fenRank);
  }

  const piecePlacement = fenRanks.join("/");
  const side = turn.toLowerCase().startsWith("b") ? "b" : "w";

  return `${piecePlacement} ${side} - - 0 1`;
}

/**
 * Validates whether a FEN string adheres strictly to chess standard.
 * @param {string} fen
 * @returns {boolean}
 */
export function validateFen(fen) {
  if (!fen || typeof fen !== "string") return false;

  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) return false;

  const piecePlacement = parts[0];
  const side = parts[1];
  const ranks = piecePlacement.split("/");

  if (ranks.length !== 8) return false;

  for (const rank of ranks) {
    let count = 0;
    for (const char of rank) {
      if (char >= "1" && char <= "8") {
        count += parseInt(char, 10);
      } else if ("KQRBNPkqrbnp".includes(char)) {
        count += 1;
      } else {
        return false;
      }
    }
    if (count !== 8) return false;
  }

  if (side !== "w" && side !== "b") return false;

  return true;
}

/**
 * Returns Lichess and Chess.com editor / analysis URLs for a given FEN.
 * @param {string} fen
 * @returns {{ lichess: string, chessCom: string }}
 */
export function getBoardUrls(fen) {
  const lichessFen = fen.replace(/ /g, "_");
  const chessComFen = encodeURIComponent(fen);
  return {
    lichess: `https://lichess.org/editor/${lichessFen}`,
    chessCom: `https://www.chess.com/analysis?fen=${chessComFen}`,
  };
}
