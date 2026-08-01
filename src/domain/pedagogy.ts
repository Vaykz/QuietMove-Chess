import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { EngineLine, Evidence, PedagogicalReport } from "./types";

const pieceValue: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0
};

const homeMinorSquares = new Set(["b1", "c1", "f1", "g1", "b8", "c8", "f8", "g8"]);

export function buildPedagogicalReport(
  fen: string,
  engineLines: EngineLine[] = []
): PedagogicalReport {
  const chess = new Chess(fen);
  const board = chess.board();
  const material = { white: 0, black: 0 };
  const hangingPieces: string[] = [];
  const undevelopedPieces: string[] = [];
  const pawnFiles: Record<Color, Record<string, number>> = {
    w: {},
    b: {}
  };
  const evidence: Evidence[] = [];

  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const side = piece.color === "w" ? "white" : "black";
      material[side] += pieceValue[piece.type];
      if (piece.type === "p") {
        const file = piece.square[0];
        pawnFiles[piece.color][file] = (pawnFiles[piece.color][file] ?? 0) + 1;
      }
      if ((piece.type === "n" || piece.type === "b") && homeMinorSquares.has(piece.square)) {
        undevelopedPieces.push(piece.square);
      }
      const opponent: Color = piece.color === "w" ? "b" : "w";
      const attacked = chess.isAttacked(piece.square as Square, opponent);
      const defended = chess.isAttacked(piece.square as Square, piece.color);
      if (attacked && !defended && piece.type !== "k") hangingPieces.push(piece.square);
    }
  }

  const verboseMoves = chess.moves({ verbose: true });
  const checks = verboseMoves.filter((move) => move.san.includes("+") || move.san.includes("#")).map(toUci);
  const captures = verboseMoves.filter((move) => Boolean(move.captured)).map(toUci);
  const pawnFeatures: string[] = [];
  for (const color of ["w", "b"] as const) {
    for (const [file, count] of Object.entries(pawnFiles[color])) {
      if (count > 1) pawnFeatures.push(`${color === "w" ? "white" : "black"} doubled pawns on ${file}-file`);
    }
  }

  evidence.push({
    id: "position",
    kind: "position",
    fen,
    description: "Exact position used for every rule and variation."
  });
  if (engineLines.length) {
    engineLines.forEach((line, index) =>
      evidence.push({
        id: `engine-${index + 1}`,
        kind: "engine",
        fen,
        description: `Stockfish candidate ${index + 1} at depth ${line.depth}.`,
        moves: line.moves
      })
    );
  }

  const facts = [
    `${chess.turn() === "w" ? "White" : "Black"} to move.`,
    `Material: White ${material.white}, Black ${material.black}.`,
    `${verboseMoves.length} legal moves in the position.`
  ];
  if (chess.isCheck()) facts.push("The side to move is in check.");
  if (hangingPieces.length) facts.push(`Potentially undefended attacked pieces: ${hangingPieces.join(", ")}.`);

  return {
    fen,
    turn: chess.turn() === "w" ? "white" : "black",
    material,
    legalMoveCount: verboseMoves.length,
    checks,
    captures,
    hangingPieces,
    undevelopedPieces,
    pawnFeatures,
    kingSafety: deriveKingSafety(chess),
    engineLines,
    facts,
    inferences: deriveInferences(chess, undevelopedPieces, hangingPieces),
    limitations: [
      "Strategic labels are heuristic and are not direct Stockfish statements.",
      ...(engineLines.length ? [] : ["No engine evaluation is attached to this report yet."])
    ],
    evidence
  };
}

function toUci(move: { from: string; to: string; promotion?: string }) {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function deriveKingSafety(chess: Chess): string[] {
  const output: string[] = [];
  for (const [color, label] of [
    ["w", "White"],
    ["b", "Black"]
  ] as const) {
    const king = chess
      .board()
      .flat()
      .find((piece) => piece?.type === "k" && piece.color === color);
    if (!king) continue;
    const central = ["d1", "e1", "d8", "e8"].includes(king.square);
    output.push(`${label} king is ${central ? "still central" : "away from its central starting files"}.`);
  }
  return output;
}

function deriveInferences(chess: Chess, undeveloped: string[], hanging: string[]): string[] {
  const output: string[] = [];
  if (hanging.length) output.push("Checking immediate tactical safety should come before a long-term plan.");
  if (undeveloped.length >= 2) output.push("Completing development may improve coordination, if tactics permit.");
  if (chess.moves().length < 12) output.push("Limited mobility may make forcing moves especially important.");
  if (!output.length) output.push("Several plans may be reasonable; engine candidates should be compared before choosing.");
  return output;
}

export function classifyWdlLoss(loss: number, mateSwing = false) {
  if (mateSwing) return "severe";
  if (loss < 3) return "reasonable";
  if (loss < 8) return "slight";
  if (loss < 18) return "inaccuracy";
  if (loss < 35) return "mistake";
  return "severe";
}
