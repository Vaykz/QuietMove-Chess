import { exportPgn } from "../domain/game";
import {
  classificationKinds,
  isPlayerMove,
  type GameSummary
} from "../domain/gameSummary";
import type {
  AiModel,
  AiProvider,
  GameSession,
  ProviderUsage,
  TeacherCallLog
} from "../domain/types";

export const COST_LEDGER_VERSION = 1;

export interface GameCostLedger {
  sessionId: string;
  startedAt: string;
  calls: TeacherCallLog[];
}

export interface CostTotals {
  questions: number;
  pending: number;
  completed: number;
  failed: number;
  cancelled: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface GameExportDocument {
  schemaVersion: number;
  exportedAt: string;
  game: {
    id: string;
    mode: GameSession["mode"];
    playerColor: GameSession["playerColor"];
    initialFen: string;
    finalFen: string;
    createdAt: string;
    updatedAt: string;
    pgn: string;
    result: GameSummary["result"];
  };
  moves: Array<{
    ply: number;
    actor: "player" | "bot";
    fenBefore: string;
    fenAfter: string;
    from: string;
    to: string;
    promotion?: string;
    san: string;
    uci: string;
    classification: GameSession["moves"][number]["classification"];
  }>;
  summary: GameSummary;
  teacherCalls: TeacherCallLog[];
  cost: CostTotals;
}

export const emptyProviderUsage = (): ProviderUsage => ({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  searchQueries: null
});

export function createGameCostLedger(session: GameSession): GameCostLedger {
  return { sessionId: session.id, startedAt: session.createdAt, calls: [] };
}

/**
 * Rates are deliberately centralized and versioned through the exported
 * result. Unknown model rates return null instead of inventing a provider bill.
 */
const knownRates: Partial<Record<AiProvider, Partial<Record<AiModel, {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
}>>>> = {
  gemini: {
    "gemini-3.5-flash": { inputPerMillion: 1.5, outputPerMillion: 9, cachedInputPerMillion: 0.15 },
    "gemini-3.6-flash": { inputPerMillion: 1.5, outputPerMillion: 7.5, cachedInputPerMillion: 0.15 }
  }
};

export function estimateCostUsd(
  provider: AiProvider,
  model: string,
  usage: ProviderUsage
): { value: number | null; note?: string } {
  const rates = knownRates[provider]?.[model as AiModel];
  if (!rates) {
    return { value: null, note: "No hay una tarifa configurada para este modelo." };
  }
  if (usage.inputTokens === null || usage.outputTokens === null) {
    return { value: null, note: "El proveedor no informó todos los tokens necesarios." };
  }
  const cached = Math.max(0, Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0));
  const billableInput = usage.inputTokens - cached;
  const value =
    (billableInput / 1_000_000) * rates.inputPerMillion +
    (cached / 1_000_000) * rates.cachedInputPerMillion +
    (usage.outputTokens / 1_000_000) * rates.outputPerMillion;
  return {
    value: Math.round(value * 1_000_000) / 1_000_000,
    note: usage.searchQueries === null
      ? "No incluye posibles cargos de búsqueda que el proveedor no desglosó."
      : undefined
  };
}

export function summarizeCost(calls: TeacherCallLog[]): CostTotals {
  const totals = {
    questions: calls.length,
    pending: calls.filter((call) => call.status === "pending").length,
    completed: calls.filter((call) => call.status === "completed").length,
    failed: calls.filter((call) => call.status === "error").length,
    cancelled: calls.filter((call) => call.status === "cancelled").length,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    hasCost: false
  };
  for (const call of calls) {
    totals.inputTokens += call.usage.inputTokens ?? 0;
    totals.outputTokens += call.usage.outputTokens ?? 0;
    totals.reasoningTokens += call.usage.reasoningTokens ?? 0;
    totals.cachedInputTokens += call.usage.cachedInputTokens ?? 0;
    totals.totalTokens += call.usage.totalTokens ?? 0;
    if (call.estimatedCostUsd !== null) {
      totals.estimatedCostUsd += call.estimatedCostUsd;
      totals.hasCost = true;
    }
  }
  return {
    questions: totals.questions,
    pending: totals.pending,
    completed: totals.completed,
    failed: totals.failed,
    cancelled: totals.cancelled,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    cachedInputTokens: totals.cachedInputTokens,
    totalTokens: totals.totalTokens,
    estimatedCostUsd: totals.hasCost
      ? Math.round(totals.estimatedCostUsd * 1_000_000) / 1_000_000
      : null
  };
}

export function buildGameExport(
  session: GameSession,
  summary: GameSummary,
  ledger: GameCostLedger,
  now = new Date().toISOString()
): GameExportDocument {
  return {
    schemaVersion: COST_LEDGER_VERSION,
    exportedAt: now,
    game: {
      id: session.id,
      mode: session.mode,
      playerColor: session.playerColor,
      initialFen: session.initialFen,
      finalFen: session.realFen,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      pgn: exportPgn(session),
      result: summary.result
    },
    moves: session.moves.map((move, index) => ({
      ply: index + 1,
      actor: isPlayerMove(session, move, index) ? "player" : "bot",
      fenBefore: index <= 0 ? session.initialFen : session.moves[index - 1]?.fen ?? session.initialFen,
      fenAfter: move.fen,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      san: move.san,
      uci: move.uci,
      classification: move.classification
    })),
    summary,
    teacherCalls: ledger.calls.map((call) => ({ ...call })),
    cost: summarizeCost(ledger.calls)
  };
}

export function allClassificationKinds() {
  return [...classificationKinds];
}
