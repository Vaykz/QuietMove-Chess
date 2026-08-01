import type {
  GameSession,
  MoveClassificationKind,
  MoveRecord,
  PlayerColor
} from "./types";

export const classificationKinds: readonly MoveClassificationKind[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
  "book"
] as const;

export type GameResult = "1-0" | "0-1" | "1/2-1/2";
export type RatingConfidence = "insufficient" | "very-provisional" | "provisional" | "unavailable";

export interface ClassificationCounts {
  [kind: string]: number;
}

export interface ClassificationSummary {
  counts: ClassificationCounts;
  playerMoves: number;
  classifiedMoves: number;
  pendingMoves: number;
  averageExpectedPointLoss: number | null;
  accuracyPercent: number | null;
}

export interface ProvisionalRating {
  range: string | null;
  accuracyPercent: number | null;
  sampleSize: number;
  confidence: RatingConfidence;
}

export interface GameSummary {
  result: GameResult | null;
  classification: ClassificationSummary;
  provisionalRating: ProvisionalRating;
}

export function summarizeGame(
  session: GameSession,
  status: { isGameOver: boolean; isCheckmate: boolean; turn: PlayerColor },
  classificationsEnabled = true
): GameSummary {
  const counts = Object.fromEntries(classificationKinds.map((kind) => [kind, 0]));
  const playerMoves = session.moves.filter((move, index) => isPlayerMove(session, move, index)).length;
  const playerClassifications = classificationsEnabled
    ? session.moves.flatMap((move, index) =>
        isPlayerMove(session, move, index) && move.classification ? [move.classification] : []
      )
    : [];
  for (const classification of playerClassifications) {
    counts[classification.kind] += 1;
  }
  const losses = playerClassifications.map((classification) => classification.expectedPointLoss);
  const averageExpectedPointLoss = losses.length
    ? losses.reduce((sum, loss) => sum + loss, 0) / losses.length
    : null;
  const accuracyPercent = averageExpectedPointLoss === null
    ? null
    : Math.round(Math.max(0, Math.min(1, 1 - averageExpectedPointLoss)) * 1000) / 10;
  const pendingMoves = classificationsEnabled ? playerMoves - playerClassifications.length : 0;

  return {
    result: status.isGameOver ? resultForStatus(status) : null,
    classification: {
      counts,
      playerMoves,
      classifiedMoves: playerClassifications.length,
      pendingMoves,
      averageExpectedPointLoss,
      accuracyPercent
    },
    provisionalRating: provisionalRating(accuracyPercent, playerClassifications.length)
  };
}

export function resultForStatus(status: {
  isGameOver: boolean;
  isCheckmate: boolean;
  turn: PlayerColor;
}): GameResult | null {
  if (!status.isGameOver) return null;
  if (!status.isCheckmate) return "1/2-1/2";
  return status.turn === "white" ? "0-1" : "1-0";
}

/**
 * This is intentionally a range, not a platform rating. It is a stable v1
 * interpretation of Stockfish expected-point loss for a single game.
 */
export function provisionalRating(
  accuracyPercent: number | null,
  sampleSize: number
): ProvisionalRating {
  if (accuracyPercent === null || sampleSize === 0) {
    return { range: null, accuracyPercent, sampleSize, confidence: "unavailable" };
  }
  if (sampleSize < 10) {
    return { range: null, accuracyPercent, sampleSize, confidence: "insufficient" };
  }
  const range =
    accuracyPercent < 55
      ? "400–699"
      : accuracyPercent < 70
        ? "700–999"
        : accuracyPercent < 80
          ? "1000–1299"
          : accuracyPercent < 88
            ? "1300–1599"
            : accuracyPercent < 94
              ? "1600–1899"
              : accuracyPercent < 98
                ? "1900–2199"
                : "2200–2499";
  return {
    range,
    accuracyPercent,
    sampleSize,
    confidence: sampleSize < 25 ? "very-provisional" : "provisional"
  };
}

export function isPlayerMove(session: GameSession, move: MoveRecord, index: number): boolean {
  const fenBefore = index <= 0 ? session.initialFen : session.moves[index - 1]?.fen;
  if (!fenBefore) return false;
  const turn = fenBefore.split(/\s+/)[1];
  return (turn === "w" ? "white" : "black") === session.playerColor && Boolean(move);
}

