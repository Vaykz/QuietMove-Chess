import { z } from "zod";
import {
  teacherAnswerSchema,
  type AiModel,
  type AiProvider,
  type ProviderUsage,
  type TeacherApiTelemetry,
  type TeacherPromptDebug,
  type TutorRequest
} from "../domain/types";

const configStatusSchema = z.object({
  configured: z.object({
    openai: z.boolean(),
    gemini: z.boolean()
  })
});

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  searchQueries: z.number().int().nonnegative().nullable()
});

const debugSchema = z.object({
  systemInstruction: z.string(),
  input: z.string()
});

const apiAnswerSchema = z.object({
  summary: z.string().min(1),
  sources: z
      .array(z.object({ title: z.string(), url: z.string().url() }))
      .default([]),
  requestId: z.string().optional(),
  usage: usageSchema.default({
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    searchQueries: null
  }),
  webSearchUsed: z.boolean().default(false),
  searchQueries: z.number().int().nonnegative().nullable().default(null),
  providerRequestId: z.string().nullable().default(null),
  debug: z
    .object({
      provider: z.enum(["openai", "gemini"]),
      model: z.string(),
      systemInstruction: z.string(),
      input: z.string()
    })
    .optional()
});

export type TeacherConfigStatus = z.infer<typeof configStatusSchema>["configured"];

export interface AskTeacherResult {
  answer: ReturnType<typeof teacherAnswerSchema.parse>;
  telemetry: TeacherApiTelemetry;
}

export class TeacherApiError extends Error {
  readonly requestId: string;
  readonly usage: ProviderUsage;
  readonly webSearchUsed: boolean;
  readonly searchQueries: number | null;
  readonly debug: TeacherPromptDebug | null;

  constructor(
    message: string,
    details: {
      requestId: string;
      usage: ProviderUsage;
      webSearchUsed: boolean;
      searchQueries: number | null;
      debug: TeacherPromptDebug | null;
    }
  ) {
    super(message);
    this.name = "TeacherApiError";
    this.requestId = details.requestId;
    this.usage = details.usage;
    this.webSearchUsed = details.webSearchUsed;
    this.searchQueries = details.searchQueries;
    this.debug = details.debug;
  }
}

export async function getTeacherConfig(): Promise<TeacherConfigStatus> {
  const response = await fetch("/api/teacher/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Teacher configuration is unavailable.");
  return configStatusSchema.parse(await response.json()).configured;
}

export async function configureTeacher(provider: AiProvider, apiKey: string) {
  const response = await fetch("/api/teacher/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey })
  });
  if (!response.ok) throw await apiError(response, `configure-${Date.now()}`);
  return configStatusSchema.parse(await response.json()).configured;
}

export async function askTeacherApi(
  provider: AiProvider,
  model: AiModel,
  request: TutorRequest,
  signal?: AbortSignal,
  requestId?: string
) : Promise<AskTeacherResult> {
  const effectiveRequestId = requestId ?? globalThis.crypto?.randomUUID?.() ?? `teacher-${Date.now()}`;
  try {
    const response = await fetch("/api/teacher/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, requestId: effectiveRequestId, request }),
      signal
    });
    if (!response.ok) throw await apiError(response, effectiveRequestId);
    const parsed = apiAnswerSchema.parse(await response.json());
    logTeacherDebug(parsed.debug);
    const debug = parsed.debug ?? { systemInstruction: "", input: "" };
    return {
      answer: teacherAnswerSchema.parse(parsed),
      telemetry: {
        requestId: parsed.requestId ?? effectiveRequestId,
        provider,
        model,
        usage: parsed.usage,
        webSearchUsed: parsed.webSearchUsed,
        searchQueries: parsed.searchQueries ?? parsed.usage.searchQueries,
        debug
      }
    };
  } catch (error) {
    if (error instanceof TeacherApiError) throw error;
    throw error;
  }
}

async function apiError(response: Response, fallbackRequestId: string) {
  try {
    const payload = await response.json();
    logTeacherDebug(payload?.debug);
    const debug = debugSchema.safeParse(payload?.debug);
    const usage = usageSchema.safeParse(payload?.usage);
    return new TeacherApiError(
      typeof payload?.error === "string" ? payload.error : `Teacher API failed (${response.status}).`,
      {
        requestId: typeof payload?.requestId === "string" ? payload.requestId : fallbackRequestId,
        usage: usage.success ? usage.data : emptyUsage(),
        webSearchUsed: payload?.webSearchUsed === true,
        searchQueries: typeof payload?.searchQueries === "number" ? payload.searchQueries : null,
        debug: debug.success ? debug.data : null
      }
    );
  } catch {
    return new TeacherApiError(`Teacher API failed (${response.status}).`, {
      requestId: fallbackRequestId,
      usage: emptyUsage(),
      webSearchUsed: false,
      searchQueries: null,
      debug: null
    });
  }
}

function emptyUsage(): ProviderUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    searchQueries: null
  };
}

function logTeacherDebug(debug: unknown) {
  if (!import.meta.env.DEV) return;
  const parsed = apiAnswerSchema.shape.debug.safeParse(debug);
  if (!parsed.success || !parsed.data) return;
  let input: unknown = parsed.data.input;
  try {
    input = JSON.parse(parsed.data.input);
  } catch {
    // Preserve the exact raw prompt when it is not JSON.
  }
  console.groupCollapsed(`[QuietMove prompt] ${parsed.data.provider} · ${parsed.data.model}`);
  console.log("System instruction:", parsed.data.systemInstruction);
  console.log("Input:", input);
  console.groupEnd();
}
