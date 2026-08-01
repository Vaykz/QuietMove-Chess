import type { EngineLine, PositionEvaluation } from "./types";

export interface NormalizedEvaluation {
  whiteScoreCp: number | null;
  whiteMate: number | null;
  whiteWdl: [number, number, number] | null;
  whitePercent: number;
}

export function normalizeEvaluationForWhite(
  fen: string,
  line: EngineLine
): NormalizedEvaluation {
  const whiteToMove = fen.split(/\s+/)[1] === "w";
  const whiteScoreCp =
    line.scoreCp === null ? null : whiteToMove ? line.scoreCp : -line.scoreCp;
  const whiteMate =
    line.mate === null ? null : whiteToMove ? line.mate : -line.mate;
  const whiteWdl =
    line.wdl === null
      ? null
      : whiteToMove
        ? line.wdl
        : [line.wdl[2], line.wdl[1], line.wdl[0]] as [number, number, number];

  let whitePercent = 50;
  if (whiteMate !== null) {
    whitePercent = whiteMate > 0 ? 100 : 0;
  } else if (whiteWdl) {
    const total = whiteWdl[0] + whiteWdl[1] + whiteWdl[2];
    whitePercent = total
      ? ((whiteWdl[0] + whiteWdl[1] / 2) / total) * 100
      : 50;
  } else if (whiteScoreCp !== null) {
    whitePercent = 100 / (1 + Math.exp(-whiteScoreCp / 300));
  }

  return {
    whiteScoreCp,
    whiteMate,
    whiteWdl,
    whitePercent: Math.max(0, Math.min(100, whitePercent))
  };
}

export function readyEvaluation(
  fen: string,
  line: EngineLine | null
): PositionEvaluation {
  return { fen, status: "ready", line };
}

export function acceptsEvaluationResult({
  visibleFen,
  requestedFen,
  resultFen,
  requestToken,
  activeToken,
  status
}: {
  visibleFen: string;
  requestedFen: string;
  resultFen: string;
  requestToken: number;
  activeToken: number;
  status: string;
}) {
  return (
    status === "complete" &&
    requestToken === activeToken &&
    requestedFen === resultFen &&
    visibleFen === resultFen
  );
}
