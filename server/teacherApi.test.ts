import { describe, expect, it, vi } from "vitest";
import {
  askGemini,
  askOpenAi,
  buildTeacherInstructions,
  buildTeacherPrompt,
  serializeVerifiedLine
} from "./teacherApi";
import type { TutorRequest } from "../src/domain/types";

const request: TutorRequest = {
  question: "¿Cómo se llama esta apertura y por qué se juega 3...d5?",
  language: "es",
  rating: 1200,
  mode: "coach-game",
  fen: "rnbqkbnr/pp2pppp/2p5/3p4/3P4/2P5/PP2PPPP/RNBQKBNR w KQkq - 0 3",
  playerColor: "white",
  detailLevel: "balanced",
  historySan: ["d4", "Nf6", "Bf4", "c6", "c3", "d5"],
  proposedMove: {
    uci: "c3c4",
    engineLine: {
      multipv: 1,
      depth: 14,
      scoreCp: -18,
      mate: null,
      wdl: null,
      moves: ["c3c4", "g8f6"]
    }
  },
  report: {
    fen: "rnbqkbnr/pp2pppp/2p5/3p4/3P4/2P5/PP2PPPP/RNBQKBNR w KQkq - 0 3",
    turn: "white",
    material: { white: 39, black: 39 },
    legalMoveCount: 25,
    checks: [],
    captures: [],
    hangingPieces: [],
    undevelopedPieces: [],
    pawnFeatures: [],
    kingSafety: [],
    engineLines: [
      {
        multipv: 1,
        depth: 15,
        scoreCp: 22,
        mate: null,
        wdl: null,
        moves: ["g1f3", "g8f6"]
      }
    ],
    facts: [],
    inferences: [],
    limitations: [],
    evidence: []
  }
};

describe("teacher provider gateway", () => {
  it("includes the SAN history and keeps Stockfish authoritative", () => {
    const prompt = buildTeacherPrompt(request);
    const instructions = buildTeacherInstructions(request);
    expect(prompt).toContain('"moveHistorySan":["d4","Nf6","Bf4","c6","c3","d5"]');
    expect(prompt).toContain('"proposedMoveAnalysis":{"uci":"c3c4"');
    expect(prompt).toContain('"sanSequence":["c4","Nf6"]');
    expect(prompt).toContain('"bestOpponentReplySan":"Nf6"');
    expect(prompt).toContain('"finalFen":');
    expect(instructions).toContain("Stockfish");
    expect(instructions).toContain("busqueda web");
    expect(instructions).toContain("causa y efecto");
    expect(instructions.toLocaleLowerCase()).not.toContain("idea transferible");
    expect(instructions.toLocaleLowerCase()).not.toContain("transferable idea");
  });

  it("rejects an illegal engine continuation instead of serializing it", () => {
    expect(
      serializeVerifiedLine(request.fen, {
        multipv: 1,
        depth: 18,
        scoreCp: 20,
        mate: null,
        wdl: null,
        moves: ["a1a8"]
      })
    ).toBeNull();
  });

  it("asks OpenAI with web search and extracts cited sources", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.store).toBe(false);
      expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toContain("test-key");
      return new Response(
        JSON.stringify({
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            total_tokens: 140,
            output_tokens_details: { reasoning_tokens: 12 }
          },
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: "Es un sistema Londres.",
                  annotations: [
                    {
                      type: "url_citation",
                      title: "Opening reference",
                      url: "https://example.com/opening"
                    }
                  ]
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(askOpenAi("gpt-5.6-sol", "test-key-123", request, fetchMock as typeof fetch))
      .resolves.toMatchObject({
        summary: "Es un sistema Londres.",
        sources: [{ title: "Opening reference", url: "https://example.com/opening" }],
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          reasoningTokens: 12
        },
        webSearchUsed: true
      });
  });

  it("enables Google Search grounding for Gemini", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemini-3.5-flash");
      expect(body.tools).toEqual([{ type: "google_search" }]);
      expect(body).not.toHaveProperty("tool_choice");
      expect(body.store).toBe(false);
      expect(body.generation_config).not.toHaveProperty("max_output_tokens");
      expect(body.input).toContain("moveHistorySan");
      expect(body.system_instruction).toContain("Stockfish");
      return new Response(
        JSON.stringify({
          status: "completed",
          usage_metadata: {
            prompt_token_count: 120,
            candidates_token_count: 50,
            total_token_count: 170,
            thoughts_token_count: 20
          },
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: "La idea central es sostener e4.",
                  annotations: [
                    {
                      type: "url_citation",
                      title: "Theory",
                      url: "https://example.com/theory"
                    }
                  ]
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(
      askGemini("gemini-3.5-flash", "test-key-123", request, fetchMock as typeof fetch)
    ).resolves.toMatchObject({
      summary: "La idea central es sostener e4.",
      sources: [{ title: "Theory", url: "https://example.com/theory" }],
      usage: {
        inputTokens: 120,
        outputTokens: 50,
        totalTokens: 170,
        reasoningTokens: 20
      },
      webSearchUsed: true
    });
  });

  it("surfaces the useful provider error instead of hiding it as a generic 502", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "Model is not available for this API key."
          }
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    });

    await expect(
      askGemini("gemini-3.5-flash", "test-key-123", request, fetchMock as typeof fetch)
    ).rejects.toThrow("Google Gemini (404): Model is not available for this API key.");
  });
});
