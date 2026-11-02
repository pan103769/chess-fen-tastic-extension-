/**
 * Chess FEN-tastic Chrome Extension Constants
 */

export const FILES = "abcdefgh";
export const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

// All 64 squares in standard top-to-bottom, left-to-right rank order (a8 to h1)
export const EXPECTED_SQUARES = RANKS.flatMap((rank) =>
  FILES.split("").map((file) => `${file}${rank}`)
);

export const PIECE_TO_FEN = {
  white_king: "K",
  white_queen: "Q",
  white_rook: "R",
  white_bishop: "B",
  white_knight: "N",
  white_pawn: "P",
  black_king: "k",
  black_queen: "q",
  black_rook: "r",
  black_bishop: "b",
  black_knight: "n",
  black_pawn: "p",
  empty: "",
};

export const FEN_TO_PIECE = {
  K: "white_king",
  Q: "white_queen",
  R: "white_rook",
  B: "white_bishop",
  N: "white_knight",
  P: "white_pawn",
  k: "black_king",
  q: "black_queen",
  r: "black_rook",
  b: "black_bishop",
  n: "black_knight",
  p: "black_pawn",
};

export const PIECE_TO_UNICODE = {
  white_king: "♔",
  white_queen: "♕",
  white_rook: "♖",
  white_bishop: "♗",
  white_knight: "♘",
  white_pawn: "♙",
  black_king: "♚",
  black_queen: "♛",
  black_rook: "♜",
  black_bishop: "♝",
  black_knight: "♞",
  black_pawn: "♟",
  empty: "",
};

export const VERIFICATION_STATUS = {
  VERIFIED: "VERIFIED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  INVALID: "INVALID",
};

export const CHESS_VISION_PROMPT = `Analyze the chessboard image and reconstruct the exact chess position.
The image has coordinate labels along the board boundaries (files a-h on top/bottom, ranks 1-8 on left/right).

Identify EVERY ONE of the 64 squares.

Use these exact chess coordinates:
a8 b8 c8 d8 e8 f8 g8 h8
a7 b7 c7 d7 e7 f7 g7 h7
a6 b6 c6 d6 e6 f6 g6 h6
a5 b5 c5 d5 e5 f5 g5 h5
a4 b4 c4 d4 e4 f4 g4 h4
a3 b3 c3 d3 e3 f3 g3 h3
a2 b2 c2 d2 e2 f2 g2 h2
a1 b1 c1 d1 e1 f1 g1 h1

For every square, output exactly one of:
empty
white_king
white_queen
white_rook
white_bishop
white_knight
white_pawn
black_king
black_queen
black_rook
black_bishop
black_knight
black_pawn

Also determine the side to move.

IMPORTANT:
- Output EVERY square.
- Do not skip squares.
- Do not output FEN.
- Do not explain anything.
- Do not use Markdown.
- Do not use code blocks.

Output exactly this format:
a8: piece
b8: piece
c8: piece
...
h1: piece
side_to_move: white

Replace "piece" with the correct value.`;

export const PROVIDERS = {
  OLLAMA_CLOUD: "ollama_cloud",
  GEMINI: "gemini",
  OLLAMA_LOCAL: "ollama_local",
};

export const DEFAULT_SETTINGS = {
  provider: "ollama_cloud",
  ollamaCloudUrl: "https://ollama.com",
  ollamaCloudModel: "gemma4:31b",
  ollamaApiKey: "",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  ollamaLocalUrl: "http://localhost:11434",
  ollamaLocalModel: "llama3.2-vision",
  autoOpenLichess: false,
};

/**
 * Checks whether a tab URL is a restricted internal browser page that cannot be captured.
 * @param {string} url
 * @returns {boolean}
 */
export function isRestrictedUrl(url) {
  if (!url || typeof url !== "string") return true;
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith("chrome://") ||
    lower.startsWith("chrome-extension://") ||
    lower.startsWith("edge://") ||
    lower.startsWith("about:") ||
    lower.startsWith("view-source:") ||
    lower.startsWith("devtools://") ||
    lower.startsWith("https://chromewebstore.google.com") ||
    lower.startsWith("https://chrome.google.com/webstore")
  );
}

export const RESTRICTED_PAGE_MESSAGE =
  "Cannot capture internal browser pages (chrome://, extension settings, or Chrome Web Store). Please switch to an ordinary webpage (e.g. Lichess, Chess.com, YouTube, or any site showing a chessboard) and try again.";
