import { z } from "zod";

export const appModes = [
  "coach-game",
  "solo-game"
] as const;

export type AppMode = (typeof appModes)[number];
export type Language = "es" | "en";
export type Theme = "light" | "dark";
export type PlayerColor = "white" | "black";
export type DetailLevel = "brief" | "balanced" | "deep";
export type MoveClassificationKind =
  | "book"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";
export type AiProvider = "openai" | "gemini";
export type AiModel =
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gemini-3.5-flash"
  | "gemini-3.6-flash";

export interface MoveRecord {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  uci: string;
  fen: string;
  classification?: MoveClassification;
}

export interface MoveClassification {
  kind: MoveClassificationKind;
  fenBefore: string;
  fenAfter: string;
  playedMove: string;
  bestMove: string;
  expectedPointLoss: number;
  depth: number;
  opening?: { eco: string; name: string };
}

export interface DemoLine {
  originFen: string;
  moves: MoveRecord[];
  index: number;
  label: string;
}

export interface GameSession {
  id: string;
  mode: AppMode;
  started: boolean;
  initialFen: string;
  moves: MoveRecord[];
  realFen: string;
  selectedPly: number;
  demo: DemoLine | null;
  playerColor: PlayerColor;
  estimatedRating: number;
  clocks: { enabled: boolean; whiteMs: number; blackMs: number; running: boolean };
  createdAt: string;
  updatedAt: string;
}

export const engineRequestSchema = z.object({
  requestId: z.string(),
  type: z.enum(["analyze", "bestmove", "stop"]),
  fen: z.string(),
  depth: z.number().int().min(1).max(30).optional(),
  moveTimeMs: z.number().int().min(50).max(30_000).optional(),
  multiPv: z.number().int().min(1).max(20).default(3),
  rootMoves: z.array(z.string()).optional(),
  estimatedElo: z.number().int().min(0).max(3200).optional()
});

export type EngineRequest = z.infer<typeof engineRequestSchema>;

export const engineLineSchema = z.object({
  multipv: z.number().int().positive(),
  depth: z.number().int().nonnegative(),
  scoreCp: z.number().nullable(),
  mate: z.number().nullable(),
  wdl: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  moves: z.array(z.string())
});

export type EngineLine = z.infer<typeof engineLineSchema>;

export interface PositionEvaluation {
  fen: string;
  status: "calculating" | "ready" | "unavailable";
  line: EngineLine | null;
}

export const engineResultSchema = z.object({
  requestId: z.string(),
  fen: z.string(),
  status: z.enum(["ready", "thinking", "complete", "cancelled", "error"]),
  bestMove: z.string().nullable(),
  lines: z.array(engineLineSchema),
  message: z.string().optional()
});

export type EngineResult = z.infer<typeof engineResultSchema>;

export interface Evidence {
  id: string;
  kind: "position" | "rule" | "engine" | "variation";
  fen: string;
  description: string;
  moves?: string[];
}

export interface PedagogicalReport {
  fen: string;
  turn: "white" | "black";
  material: Record<"white" | "black", number>;
  legalMoveCount: number;
  checks: string[];
  captures: string[];
  hangingPieces: string[];
  undevelopedPieces: string[];
  pawnFeatures: string[];
  kingSafety: string[];
  engineLines: EngineLine[];
  facts: string[];
  inferences: string[];
  limitations: string[];
  evidence: Evidence[];
}

export const visualStepSchema = z.object({
  id: z.string(),
  fen: z.string(),
  moves: z.array(z.string()),
  arrows: z.array(z.tuple([z.string(), z.string()])).default([]),
  squares: z.array(z.string()).default([]),
  text: z.string(),
  durationMs: z.number().int().min(0).max(60_000).default(1600)
});

export const tutorResponseSchema = z.object({
  summary: z.string(),
  userIdea: z.string(),
  problem: z.string(),
  recommendedPlan: z.string(),
  variations: z.array(
    z.object({
      label: z.string(),
      moves: z.array(z.string()),
      evaluation: z.string()
    })
  ),
  visualSteps: z.array(visualStepSchema),
  speechSegments: z.array(
    z.object({
      text: z.string(),
      visualStepId: z.string().nullable()
    })
  ),
  confidence: z.enum(["high", "medium", "limited"]),
  limitations: z.array(z.string()),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url()
      })
    )
    .default([])
});

export type TutorResponse = z.infer<typeof tutorResponseSchema>;
export type VisualStep = z.infer<typeof visualStepSchema>;

export const teacherAnswerSchema = z.object({
  summary: z.string().min(1),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url()
      })
    )
    .default([])
});

export type TeacherAnswer = z.infer<typeof teacherAnswerSchema>;

export type TeacherCallStatus = "pending" | "completed" | "error" | "cancelled";

/** Usage reported by an AI provider. Unknown counters remain null rather than being guessed. */
export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  searchQueries: number | null;
}

export interface TeacherPromptDebug {
  systemInstruction: string;
  input: string;
}

export interface TeacherApiTelemetry {
  requestId: string;
  provider: AiProvider;
  model: string;
  usage: ProviderUsage;
  webSearchUsed: boolean;
  searchQueries: number | null;
  debug: TeacherPromptDebug;
}

export interface TeacherCallLog {
  id: string;
  question: string;
  fen: string;
  ply: number;
  provider: AiProvider;
  model: string;
  detailLevel: DetailLevel;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: TeacherCallStatus;
  prompt: TeacherPromptDebug | null;
  response: TeacherAnswer | null;
  usage: ProviderUsage;
  webSearchUsed: boolean;
  searchQueries: number | null;
  estimatedCostUsd: number | null;
  costNote?: string;
  error?: string;
}

export interface TutorRequest {
  question: string;
  language: Language;
  rating: number;
  mode: AppMode;
  fen: string;
  playerColor: PlayerColor;
  detailLevel: DetailLevel;
  historySan: string[];
  proposedMove?: {
    uci: string;
    engineLine: EngineLine;
  };
  report: PedagogicalReport;
}

export interface AppPreferences {
  language: Language;
  theme: Theme;
  detailLevel: DetailLevel;
  aiProvider: AiProvider;
  aiModel: AiModel;
  playerColor: PlayerColor;
  estimatedRating: number;
  showEvaluation: boolean;
  showMoveClassifications: boolean;
  allowHistoricalBranching: boolean;
  speechRate: number;
}
