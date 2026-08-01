import { Chess, type Color, type Square } from "chess.js";
import type {
  EngineLine,
  MoveClassification,
  MoveClassificationKind
} from "./types";

export const moveClassificationSymbols: Record<MoveClassificationKind, string> = {
  book: "▤",
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓+",
  good: "✓",
  inaccuracy: "?!",
  mistake: "?",
  miss: "✕",
  blunder: "??"
};

export interface ClassificationInput {
  fenBefore: string;
  fenAfter: string;
  playedMove: string;
  candidateLines: EngineLine[];
  playedLine: EngineLine;
  previousExpectedPoints?: number;
  opening?: { eco: string; name: string };
}

export function expectedPoints(line: EngineLine): number {
  if (line.mate !== null) return line.mate > 0 ? 1 : 0;
  if (line.wdl) {
    const total = line.wdl[0] + line.wdl[1] + line.wdl[2];
    if (total > 0) return (line.wdl[0] + line.wdl[1] / 2) / total;
  }
  if (line.scoreCp !== null) return 1 / (1 + Math.exp(-line.scoreCp / 300));
  return 0.5;
}

export function baseClassification(
  loss: number,
  isTopMove: boolean
): MoveClassificationKind {
  if (isTopMove || loss <= 0.002) return "best";
  if (loss <= 0.02) return "excellent";
  if (loss <= 0.05) return "good";
  if (loss <= 0.1) return "inaccuracy";
  if (loss <= 0.2) return "mistake";
  return "blunder";
}

export function classifyMove(input: ClassificationInput): MoveClassification {
  const best = input.candidateLines[0] ?? input.playedLine;
  const bestMove = best.moves[0] ?? input.playedMove;
  const bestPoints = expectedPoints(best);
  const playedPoints = expectedPoints(input.playedLine);
  const loss = Math.max(0, Math.min(1, bestPoints - playedPoints));
  const second = input.candidateLines.find((line) => line.moves[0] !== bestMove);
  const secondPoints = second ? expectedPoints(second) : bestPoints;
  const secondLoss = Math.max(0, bestPoints - secondPoints);
  const isTopMove = input.playedMove === bestMove;
  const base = baseClassification(loss, isTopMove);

  const missedOpportunity =
    input.previousExpectedPoints !== undefined &&
    bestPoints - input.previousExpectedPoints >= 0.1 &&
    bestPoints >= 0.65 &&
    playedPoints < 0.65 &&
    loss >= 0.1;

  const allowsAvoidableMate =
    input.playedLine.mate !== null &&
    input.playedLine.mate < 0 &&
    (best.mate === null || best.mate >= 0);

  const nearBest = isTopMove || loss <= 0.02;
  const uniqueMateOrDefense =
    nearBest &&
    ((input.playedLine.mate !== null && input.playedLine.mate > 0 && second?.mate !== null && (second?.mate ?? 0) <= 0) ||
      (input.playedLine.mate === null && second?.mate !== null && (second?.mate ?? 0) < 0));
  const brilliant =
    nearBest &&
    playedPoints >= 0.5 &&
    secondPoints < 0.9 &&
    hasVerifiedSacrifice(input.fenBefore, input.playedLine.moves, 300, 8);
  const great = nearBest && (uniqueMateOrDefense || secondLoss >= 0.1);

  let kind: MoveClassificationKind;
  if (allowsAvoidableMate) kind = missedOpportunity ? "miss" : "blunder";
  else if (brilliant) kind = "brilliant";
  else if (great) kind = "great";
  else if (missedOpportunity) kind = "miss";
  else if (input.opening && loss <= 0.05) kind = "book";
  else kind = base;

  return {
    kind,
    fenBefore: input.fenBefore,
    fenAfter: input.fenAfter,
    playedMove: input.playedMove,
    bestMove,
    expectedPointLoss: loss,
    depth: Math.min(best.depth, input.playedLine.depth),
    opening: kind === "book" ? input.opening : undefined
  };
}

export function hasVerifiedSacrifice(
  fen: string,
  moves: string[],
  threshold = 300,
  maxPlies = 8
): boolean {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const initial = materialBalance(chess, mover);
  let lowest = initial;
  for (const uci of moves.slice(0, maxPlies)) {
    if (!playUci(chess, uci)) break;
    lowest = Math.min(lowest, materialBalance(chess, mover));
  }
  return initial - lowest >= threshold;
}

function materialBalance(chess: Chess, mover: Color) {
  const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 } as const;
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      total += (piece.color === mover ? 1 : -1) * values[piece.type];
    }
  }
  return total;
}

function playUci(chess: Chess, uci: string) {
  try {
    return chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.slice(4, 5) || undefined
    });
  } catch {
    return null;
  }
}
