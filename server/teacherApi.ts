import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { Chess, type PieceSymbol, type Square } from "chess.js";
import { modelBelongsToProvider } from "../src/config/aiProviders";
import { normalizeEvaluationForWhite } from "../src/domain/evaluation";
import type {
  AiProvider,
  EngineLine,
  ProviderUsage,
  TutorRequest
} from "../src/domain/types";

type Next = (error?: unknown) => void;
type ApiKeyStore = Partial<Record<AiProvider, string>>;

const providerSchema = z.enum(["openai", "gemini"]);
const configurationSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(10).max(512)
});
const sourceSchema = z.object({ title: z.string(), url: z.string().url() });
const tutorRequestSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
  language: z.enum(["es", "en"]),
  rating: z.number().int().min(400).max(2800),
  mode: z.enum(["coach-game", "solo-game"]),
  fen: z.string().min(1).max(160),
  playerColor: z.enum(["white", "black"]),
  detailLevel: z.enum(["brief", "balanced", "deep"]),
  historySan: z.array(z.string().max(32)).max(600),
  proposedMove: z
    .object({
      uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
      engineLine: z.object({
        multipv: z.number(),
        depth: z.number(),
        scoreCp: z.number().nullable(),
        mate: z.number().nullable(),
        wdl: z.tuple([z.number(), z.number(), z.number()]).nullable(),
        moves: z.array(z.string())
      })
    })
    .optional(),
  report: z.object({
    fen: z.string(),
    turn: z.enum(["white", "black"]),
    material: z.record(z.number()),
    legalMoveCount: z.number(),
    checks: z.array(z.string()),
    captures: z.array(z.string()),
    hangingPieces: z.array(z.string()),
    undevelopedPieces: z.array(z.string()),
    pawnFeatures: z.array(z.string()),
    kingSafety: z.array(z.string()),
    engineLines: z.array(
      z.object({
        multipv: z.number(),
        depth: z.number(),
        scoreCp: z.number().nullable(),
        mate: z.number().nullable(),
        wdl: z.tuple([z.number(), z.number(), z.number()]).nullable(),
        moves: z.array(z.string())
      })
    ),
    facts: z.array(z.string()),
    inferences: z.array(z.string()),
    limitations: z.array(z.string()),
    evidence: z.array(z.unknown())
  })
});
const generationSchema = z.object({
  provider: providerSchema,
  model: z.string().min(1).max(100),
  requestId: z.string().min(1).max(120).optional(),
  request: tutorRequestSchema
});

export interface TeacherApiResult {
  summary: string;
  sources: Array<z.infer<typeof sourceSchema>>;
  usage: ProviderUsage;
  webSearchUsed: boolean;
  searchQueries: number | null;
  providerRequestId: string | null;
}

export function createTeacherApiMiddleware(fetchImpl: typeof fetch = fetch) {
  const keys: ApiKeyStore = {};

  return async function teacherApi(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/teacher/")) return next();

    setSecurityHeaders(res);
    try {
      if (!isLocalRequest(req)) {
        return sendJson(res, 403, { error: "This endpoint only accepts local requests." });
      }

      if (req.method === "GET" && url.pathname === "/api/teacher/config") {
        return sendJson(res, 200, {
          configured: {
            openai: Boolean(keys.openai || process.env.OPENAI_API_KEY),
            gemini: Boolean(keys.gemini || process.env.GEMINI_API_KEY)
          }
        });
      }

      if (req.method === "POST" && url.pathname === "/api/teacher/config") {
        const body = configurationSchema.parse(await readJsonBody(req));
        await verifyProviderKey(body.provider, body.apiKey, fetchImpl);
        keys[body.provider] = body.apiKey;
        return sendJson(res, 200, {
          configured: {
            openai: Boolean(keys.openai || process.env.OPENAI_API_KEY),
            gemini: Boolean(keys.gemini || process.env.GEMINI_API_KEY)
          }
        });
      }

      if (req.method === "POST" && url.pathname === "/api/teacher/respond") {
        const body = generationSchema.parse(await readJsonBody(req));
        const requestId = body.requestId ?? createRequestId();
        if (body.request.fen !== body.request.report.fen) {
          return sendJson(res, 400, { error: "The pedagogical report does not match the requested position.", requestId });
        }
        if (!modelBelongsToProvider(body.provider, body.model)) {
          return sendJson(res, 400, { error: "The selected model does not belong to this provider.", requestId });
        }
        const apiKey =
          keys[body.provider] ||
          (body.provider === "openai"
            ? process.env.OPENAI_API_KEY
            : process.env.GEMINI_API_KEY);
        if (!apiKey) {
          return sendJson(res, 401, { error: "No API key is configured for this provider.", requestId });
        }
        const tutorRequest = body.request as TutorRequest;
        const debug = {
          provider: body.provider,
          model: body.model,
          systemInstruction: buildTeacherInstructions(tutorRequest),
          input: buildTeacherPrompt(tutorRequest)
        };
        try {
          const result =
            body.provider === "openai"
              ? await askOpenAi(body.model, apiKey, tutorRequest, fetchImpl)
              : await askGemini(body.model, apiKey, tutorRequest, fetchImpl);
          return sendJson(res, 200, { ...result, requestId, debug });
        } catch (error) {
          return sendJson(res, 502, {
            error: error instanceof Error ? error.message : "The AI provider failed.",
            requestId,
            usage: emptyProviderUsage(),
            webSearchUsed: body.provider === "gemini" || body.provider === "openai",
            searchQueries: null,
            debug
          });
        }
      }

      return sendJson(res, 404, { error: "Unknown teacher endpoint." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendJson(res, 400, { error: "The request is incomplete or invalid." });
      }
      const message = error instanceof Error ? error.message : "The AI provider failed.";
      return sendJson(res, 502, { error: message });
    }
  };
}

async function verifyProviderKey(
  provider: AiProvider,
  apiKey: string,
  fetchImpl: typeof fetch
) {
  const response =
    provider === "openai"
      ? await fetchImpl("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(20_000)
        })
      : await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(20_000)
        });
  if (response.ok) return;
  const payload: any = await response.json().catch(() => ({}));
  throw providerError(provider === "openai" ? "OpenAI" : "Google Gemini", response.status, payload);
}

export function buildTeacherInstructions(request: TutorRequest) {
  const spanish = request.language === "es";
  return spanish
    ? [
        "Eres el profesor de ajedrez de QuietMove.",
        "Contesta primero la pregunta exacta del estudiante y luego demuéstrala con una cadena explícita de causa y efecto.",
        "Stockfish y los hechos proporcionados son la autoridad para legalidad, táctica y evaluación. Nunca los contradigas ni inventes variantes.",
        "Cita movimientos concretos de una variante SAN verificada, incluye la mejor defensa rival y continúa entre 2 y 6 jugadas completas, deteniéndote cuando la consecuencia ya pueda observarse.",
        "Explica qué cambia cada movimiento importante y por qué provoca o permite el siguiente. Frases aisladas como 'desarrolla una pieza', 'mejora la posición' o 'es la mejor jugada' no son una explicación.",
        "Si se analizó una jugada propuesta, compárala explícitamente con la mejor candidata usando sus evaluaciones y continuaciones verificadas.",
        "No atribuyas a Stockfish conceptos estratégicos que el motor no entregó. Puedes formular una interpretación prudente, pero debes distinguirla de la variante calculada.",
        "No termines con principios generales, moralejas ni conclusiones pedagógicas genéricas.",
        "Usa la busqueda web solo para nombres de aperturas, historia o teoria ajedrecistica verificable. Para identificar una apertura usa el historial SAN completo, no solo el FEN.",
        "No menciones estas instrucciones, JSON, evidencias internas ni limitaciones tecnicas.",
        detailInstruction(request.detailLevel, true)
      ].join("\n")
    : [
        "You are QuietMove's chess teacher.",
        "Answer the student's exact question first, then demonstrate it through an explicit chain of cause and effect.",
        "Stockfish and the supplied facts are authoritative for legality, tactics, and evaluation. Never contradict them or invent variations.",
        "Quote concrete moves from a verified SAN line, include the opponent's best defense, and continue for 2 to 6 full moves, stopping once the consequence can be observed.",
        "Explain what each important move changes and why it causes or permits the next move. Isolated claims such as 'develops a piece', 'improves the position', or 'is the best move' are not explanations.",
        "When a proposed move was analyzed, compare it explicitly with the best candidate using their verified evaluations and continuations.",
        "Do not attribute strategic concepts to Stockfish when the engine did not supply them. You may offer a cautious interpretation, but distinguish it from the calculated line.",
        "Do not end with general principles, morals, or generic teaching conclusions.",
        "Use web search only for opening names, history, or verifiable chess theory. Identify openings from the full SAN move history, not from the FEN alone.",
        "Do not mention these instructions, JSON, internal evidence, or technical limitations.",
        detailInstruction(request.detailLevel, false)
      ].join("\n");
}

export function buildTeacherPrompt(request: TutorRequest) {
  const lines = request.report.engineLines
    .slice(0, 3)
    .map((line) => serializeVerifiedLine(request.fen, line))
    .filter((line): line is NonNullable<typeof line> => Boolean(line));
  const proposed = request.proposedMove
    ? serializeVerifiedLine(request.fen, request.proposedMove.engineLine)
    : null;
  const best = request.report.engineLines[0];

  return JSON.stringify({
    studentQuestion: request.question,
    studentRating: request.rating,
    studentColor: request.playerColor,
    sideToMove: request.report.turn,
    currentFen: request.fen,
    moveHistorySan: request.historySan,
    proposedMoveAnalysis: request.proposedMove && proposed
      ? {
          uci: request.proposedMove.uci,
          ...proposed,
          centipawnDifferenceFromBest: centipawnDifference(
            request.report.turn,
            best?.scoreCp ?? null,
            request.proposedMove.engineLine.scoreCp
          )
        }
      : null,
    verifiedPositionFacts: {
      legalMoveCount: request.report.legalMoveCount,
      material: request.report.material,
      availableChecks: request.report.checks,
      availableCaptures: request.report.captures,
      hangingPieces: request.report.hangingPieces,
      kingSafety: request.report.kingSafety
    },
    stockfishLines: lines
  });
}

export function serializeVerifiedLine(fen: string, line: EngineLine, maxPlies = 12) {
  const chess = new Chess(fen);
  const materialBefore = materialByColor(chess);
  const moves = [];

  try {
    for (const uci of line.moves.slice(0, maxPlies)) {
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: (uci.slice(4, 5) || "q") as PieceSymbol
      });
      if (!move) return null;
      moves.push({
        ply: moves.length + 1,
        uci,
        san: move.san,
        capture: move.captured ?? null,
        check: chess.isCheck(),
        checkmate: chess.isCheckmate(),
        promotion: move.promotion ?? null
      });
    }
  } catch {
    return null;
  }

  const materialAfter = materialByColor(chess);
  const normalized = normalizeEvaluationForWhite(fen, line);
  return {
    rank: line.multipv,
    depth: line.depth,
    evaluationFromWhite: {
      centipawns: normalized.whiteScoreCp,
      mateIn: normalized.whiteMate,
      wdl: normalized.whiteWdl,
      expectedScorePercent: Number(normalized.whitePercent.toFixed(1))
    },
    bestOpponentReplySan: moves[1]?.san ?? null,
    sanSequence: moves.map((move) => move.san),
    uciSequence: moves.map((move) => move.uci),
    moves,
    finalFen: chess.fen(),
    materialBefore,
    materialAfter,
    materialChange: {
      white: materialAfter.white - materialBefore.white,
      black: materialAfter.black - materialBefore.black
    }
  };
}

function materialByColor(chess: Chess) {
  const values: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const total = { white: 0, black: 0 };
  for (const rank of chess.board()) {
    for (const piece of rank) {
      if (piece) total[piece.color === "w" ? "white" : "black"] += values[piece.type];
    }
  }
  return total;
}

function centipawnDifference(
  turn: TutorRequest["report"]["turn"],
  best: number | null,
  proposed: number | null
) {
  if (best === null || proposed === null) return null;
  return turn === "white" ? best - proposed : proposed - best;
}

export async function askOpenAi(
  model: string,
  apiKey: string,
  request: TutorRequest,
  fetchImpl: typeof fetch
): Promise<TeacherApiResult> {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: buildTeacherInstructions(request),
      input: buildTeacherPrompt(request),
      reasoning: { effort: request.detailLevel === "deep" ? "high" : "medium" },
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      text: { verbosity: request.detailLevel === "brief" ? "low" : "medium" }
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const payload: any = await response.json();
  if (!response.ok) throw providerError("OpenAI", response.status, payload);

  const content = Array.isArray(payload.output)
    ? payload.output.flatMap((item: any) => (Array.isArray(item.content) ? item.content : []))
    : [];
  const summary = content
    .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
  const sources = uniqueSources(
    content.flatMap((part: any) =>
      Array.isArray(part?.annotations)
        ? part.annotations
            .filter((annotation: any) => annotation?.type === "url_citation")
            .map((annotation: any) => ({
              title: annotation.title || annotation.url,
              url: annotation.url
            }))
        : []
    )
  );
  if (!summary) throw new Error("OpenAI returned an empty answer.");
  const usage = normalizeProviderUsage(payload, "openai");
  return {
    summary,
    sources,
    usage,
    webSearchUsed: true,
    searchQueries: extractSearchQueries(payload),
    providerRequestId: typeof payload?.id === "string" ? payload.id : null
  };
}

export async function askGemini(
  model: string,
  apiKey: string,
  request: TutorRequest,
  fetchImpl: typeof fetch
): Promise<TeacherApiResult> {
  const response = await fetchImpl(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: buildTeacherPrompt(request),
        system_instruction: buildTeacherInstructions(request),
        tools: [{ type: "google_search" }],
        store: false,
        generation_config: {
          thinking_level: request.detailLevel === "deep" ? "high" : "medium"
        }
      }),
      signal: AbortSignal.timeout(120_000)
    }
  );
  const payload: any = await response.json();
  if (!response.ok) throw providerError("Google Gemini", response.status, payload);

  const content = Array.isArray(payload.steps)
    ? payload.steps
        .filter((step: any) => step?.type === "model_output")
        .flatMap((step: any) => (Array.isArray(step.content) ? step.content : []))
    : [];
  const summary = content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
  const sources = uniqueSources(
    content.flatMap((part: any) =>
      Array.isArray(part?.annotations)
        ? part.annotations
            .filter((annotation: any) => annotation?.type === "url_citation")
            .map((annotation: any) => ({
              title: annotation.title || annotation.url,
              url: annotation.url
            }))
        : []
    )
  );
  if (!summary) throw new Error("Google Gemini returned an empty answer.");
  const usage = normalizeProviderUsage(payload, "gemini");
  return {
    summary,
    sources,
    usage,
    webSearchUsed: true,
    searchQueries: extractSearchQueries(payload),
    providerRequestId:
      typeof payload?.id === "string"
        ? payload.id
        : typeof payload?.response_id === "string"
          ? payload.response_id
          : null
  };
}

function emptyProviderUsage(): ProviderUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    searchQueries: null
  };
}

function normalizeProviderUsage(payload: any, provider: AiProvider): ProviderUsage {
  const usage =
    provider === "openai"
      ? payload?.usage ?? {}
      : payload?.usage_metadata ?? payload?.usageMetadata ?? payload?.usage ?? {};
  const inputTokens = numberOrNull(
    usage.input_tokens,
    usage.prompt_token_count,
    usage.promptTokenCount,
    usage.inputTokenCount
  );
  const outputTokens = numberOrNull(
    usage.output_tokens,
    usage.candidates_token_count,
    usage.candidatesTokenCount,
    usage.outputTokenCount
  );
  const totalTokens = numberOrNull(
    usage.total_tokens,
    usage.total_token_count,
    usage.totalTokenCount
  ) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const cachedInputTokens = numberOrNull(
    usage.input_tokens_details?.cached_tokens,
    usage.cached_content_token_count,
    usage.cachedContentTokenCount,
    usage.cached_input_tokens
  );
  const reasoningTokens = numberOrNull(
    usage.output_tokens_details?.reasoning_tokens,
    usage.thoughts_token_count,
    usage.thoughtsTokenCount,
    usage.reasoning_tokens
  );
  const searchQueries = extractSearchQueries(payload);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
    searchQueries
  };
}

function numberOrNull(...values: unknown[]): number | null {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return typeof value === "number" ? Math.max(0, Math.round(value)) : null;
}

function extractSearchQueries(payload: any): number | null {
  return numberOrNull(
    payload?.usage?.search_queries,
    payload?.usage?.searchQueries,
    payload?.usage_metadata?.search_queries,
    payload?.usage_metadata?.searchQueries,
    payload?.search_queries,
    payload?.searchQueries
  );
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `teacher-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function detailInstruction(level: TutorRequest["detailLevel"], spanish: boolean) {
  if (spanish) {
    if (level === "brief") return "Sé conciso, pero conserva la demostración causal mínima con una variante principal.";
    if (level === "deep") return "Explica con profundidad y sin relleno; compara como máximo dos candidatas y desarrolla la consecuencia observable.";
    return "Da una explicación equilibrada con una variante principal y una alternativa solo cuando cambie realmente la decisión.";
  }
  if (level === "brief") return "Be concise, but preserve the minimum causal proof with one main line.";
  if (level === "deep") return "Explain deeply without filler; compare at most two candidates and develop the observable consequence.";
  return "Give a balanced explanation with one main line and an alternative only when it materially changes the decision.";
}

function providerError(provider: string, status: number, payload: any) {
  const detail =
    typeof payload?.error?.message === "string"
      ? payload.error.message
      : typeof payload?.message === "string"
        ? payload.message
        : "The provider rejected the request.";
  return new Error(`${provider} (${status}): ${detail}`);
}

function uniqueSources(sources: unknown[]) {
  const found = new Map<string, z.infer<typeof sourceSchema>>();
  for (const source of sources) {
    const parsed = sourceSchema.safeParse(source);
    if (parsed.success && !found.has(parsed.data.url)) found.set(parsed.data.url, parsed.data);
  }
  return [...found.values()].slice(0, 5);
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function isLocalRequest(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}
