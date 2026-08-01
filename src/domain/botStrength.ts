import { Chess, type Square } from "chess.js";
import { expectedPoints } from "./moveClassification";
import type { EngineLine, EngineResult } from "./types";

export const STOCKFISH_LOWEST_NATIVE_ELO = 1320;
export const STOCKFISH_HIGHEST_NATIVE_ELO = 3190;

export interface BotStrengthProfile {
  rating: number;
  usesNativeElo: boolean;
  depth: number;
  candidateCount: number;
  bestMoveChance: number;
  targetExpectedLoss: number;
}

export function botStrengthProfile(rating: number): BotStrengthProfile {
  const normalized = Math.max(0, Math.min(3000, Math.round(rating)));
  if (normalized >= STOCKFISH_LOWEST_NATIVE_ELO) {
    return {
      rating: normalized,
      usesNativeElo: true,
      depth: 0,
      candidateCount: 1,
      bestMoveChance: 1,
      targetExpectedLoss: 0
    };
  }

  const progress = normalized / STOCKFISH_LOWEST_NATIVE_ELO;
  return {
    rating: normalized,
    usesNativeElo: false,
    depth: 2 + Math.round(progress * 7),
    candidateCount: 20 - Math.round(progress * 10),
    bestMoveChance: 0.14 + progress * 0.46,
    targetExpectedLoss: 0.012 + 0.25 * Math.pow(1 - progress, 1.35)
  };
}

export function selectEstimatedBotMove(
  result: EngineResult,
  fen: string,
  rating: number
): string | null {
  const profile = botStrengthProfile(rating);
  if (profile.usesNativeElo) return result.bestMove;

  const chess = new Chess(fen);
  const legal = new Set(
    chess.moves({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ""}`)
  );
  const candidates = uniqueLegalCandidates(result.lines, legal);
  if (!candidates.length) {
    return result.bestMove && legal.has(result.bestMove) ? result.bestMove : null;
  }

  const positionRoll = seededFraction(`${fen}|best`);
  if (positionRoll < profile.bestMoveChance) return candidates[0].moves[0];

  const best = candidates[0];
  const bestPoints = expectedPoints(best);
  const variableTarget = profile.targetExpectedLoss *
    (0.72 + seededFraction(`${fen}|loss`) * 0.56);
  const tacticallySafe = profile.rating >= 900
    ? candidates.filter((line) => line.mate === null || line.mate >= 0)
    : candidates;
  const pool = tacticallySafe.length > 1 ? tacticallySafe : candidates;

  return pool
    .map((line, index) => {
      const uci = line.moves[0];
      const loss = Math.max(0, bestPoints - expectedPoints(line));
      const plausibility = humanMovePlausibility(chess, uci, profile.rating);
      const stableTieBreak = seededFraction(`${fen}|${uci}`) * 0.001;
      return {
        uci,
        score: Math.abs(loss - variableTarget) - plausibility + stableTieBreak + index * 0.00001
      };
    })
    .sort((a, b) => a.score - b.score)[0]?.uci ?? candidates[0].moves[0];
}

function uniqueLegalCandidates(lines: EngineLine[], legal: Set<string>) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const move = line.moves[0];
    if (!move || !legal.has(move) || seen.has(move)) return false;
    seen.add(move);
    return true;
  });
}

function humanMovePlausibility(chess: Chess, uci: string, rating: number) {
  try {
    const before = chess.get(uci.slice(0, 2) as Square);
    const replay = new Chess(chess.fen());
    const move = replay.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.slice(4, 5) || undefined
    });
    if (!move || !before) return 0;
    const beginnerWeight = 1 - Math.min(1, rating / STOCKFISH_LOWEST_NATIVE_ELO);
    let bonus = 0;
    if (move.captured) bonus += 0.004 + beginnerWeight * 0.006;
    if (move.san.includes("+")) bonus += 0.003 + beginnerWeight * 0.004;
    if (move.san === "O-O" || move.san === "O-O-O") bonus += 0.006;
    if (
      (before.type === "n" || before.type === "b") &&
      ((before.color === "w" && uci[1] === "1") || (before.color === "b" && uci[1] === "8"))
    ) {
      bonus += 0.005;
    }
    return bonus;
  } catch {
    return 0;
  }
}

function seededFraction(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
