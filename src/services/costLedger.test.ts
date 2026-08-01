import { describe, expect, it } from "vitest";
import { applyMove, createSession, sessionStatus } from "../domain/game";
import { summarizeGame } from "../domain/gameSummary";
import type { TeacherCallLog } from "../domain/types";
import {
  buildGameExport,
  createGameCostLedger,
  emptyProviderUsage,
  estimateCostUsd,
  summarizeCost
} from "./costLedger";

function call(overrides: Partial<TeacherCallLog> = {}): TeacherCallLog {
  return {
    id: "request-1",
    question: "¿Qué debería jugar?",
    fen: "start",
    ply: 1,
    provider: "gemini",
    model: "gemini-3.5-flash",
    detailLevel: "balanced",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1000).toISOString(),
    durationMs: 1000,
    status: "completed",
    prompt: { systemInstruction: "teacher", input: "{}" },
    response: { summary: "Juega e4.", sources: [] },
    usage: {
      ...emptyProviderUsage(),
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500
    },
    webSearchUsed: false,
    searchQueries: null,
    estimatedCostUsd: 0.006,
    ...overrides
  };
}

describe("cost ledger", () => {
  it("estimates known Gemini token cost without inventing missing usage", () => {
    expect(estimateCostUsd("gemini", "gemini-3.5-flash", {
      ...emptyProviderUsage(),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000
    }).value).toBe(10.5);
    expect(estimateCostUsd("openai", "gpt-5.6-sol", {
      ...emptyProviderUsage(),
      inputTokens: 1,
      outputTokens: 1
    }).value).toBeNull();
  });

  it("summarizes questions and token totals", () => {
    const totals = summarizeCost([
      call(),
      call({ id: "request-2", status: "error", estimatedCostUsd: null, response: null })
    ]);
    expect(totals.questions).toBe(2);
    expect(totals.completed).toBe(1);
    expect(totals.failed).toBe(1);
    expect(totals.inputTokens).toBe(2000);
    expect(totals.estimatedCostUsd).toBe(0.006);
  });

  it("exports a JSON-ready document without API keys", () => {
    let session = createSession("coach-game", "white");
    session = applyMove(session, "e2", "e4")!;
    const summary = summarizeGame(session, sessionStatus(session));
    const ledger = createGameCostLedger(session);
    ledger.calls.push(call());
    const document = buildGameExport(session, summary, ledger, new Date(2000).toISOString());
    expect(document.schemaVersion).toBe(1);
    expect(document.game.pgn).toContain("1. e4");
    expect(document.teacherCalls[0].prompt?.input).toBe("{}");
    expect(JSON.stringify(document)).not.toContain("apiKey");
  });
});

