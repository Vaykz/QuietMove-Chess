import {
  BrainCircuit,
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  ArrowUpDown,
  BadgeCheck,
  Eye,
  GitBranch,
  Languages,
  LoaderCircle,
  KeyRound,
  Menu,
  MessageSquareText,
  Moon,
  Play,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chess } from "chess.js";
import { ChessBoard } from "./components/ChessBoard";
import {
  applyMove,
  createSession,
  exportPgn,
  gameStatus,
  pickFallbackBotMove,
  selectPly,
  sessionStatus,
  setDemo,
  stepDemo,
  viewFen
} from "./domain/game";
import { buildPedagogicalReport } from "./domain/pedagogy";
import { acceptsEvaluationResult, normalizeEvaluationForWhite } from "./domain/evaluation";
import { engineVariationToSan } from "./domain/engineVariation";
import { moveClassificationSymbols } from "./domain/moveClassification";
import { extractLegalMoveFromQuestion } from "./domain/moveReference";
import { isTeacherLocked } from "./domain/modePolicy";
import { classificationKinds, summarizeGame, type GameSummary } from "./domain/gameSummary";
import type {
  AppMode,
  AppPreferences,
  EngineLine,
  GameSession,
  MoveClassification,
  TeacherCallLog,
  PositionEvaluation,
  TeacherAnswer
} from "./domain/types";
import { appModes } from "./domain/types";
import { defaultModelByProvider, modelsForProvider } from "./config/aiProviders";
import { stockfish } from "./services/engine";
import { moveClassifier } from "./services/moveClassifier";
import { loadPreferences, savePreferences } from "./services/storage";
import { playChessSound, soundCueAfterMove } from "./services/sounds";
import {
  buildGameExport,
  createGameCostLedger,
  emptyProviderUsage,
  estimateCostUsd,
  type GameCostLedger
} from "./services/costLedger";
import {
  askTeacherApi,
  configureTeacher,
  getTeacherConfig,
  TeacherApiError,
  type TeacherConfigStatus
} from "./services/teacherApi";

type ServiceStatus = "loading" | "ready" | "unavailable";
const MarkdownAnswer = lazy(() => import("./components/MarkdownAnswer"));
type TeacherExchangeStatus = "analyzing" | "ready" | "error" | "cancelled";

interface TeacherExchange {
  id: string;
  question: string;
  fen: string;
  ply: number;
  providerName: string;
  status: TeacherExchangeStatus;
  answer: TeacherAnswer | null;
  error: string;
}

interface PositionCandidates {
  fen: string;
  status: "calculating" | "ready" | "unavailable";
  lines: EngineLine[];
}

const modeIcons: Record<AppMode, typeof BrainCircuit> = {
  "coach-game": MessageSquareText,
  "solo-game": ShieldCheck
};

export function App() {
  const { t, i18n } = useTranslation();
  const [preferences, setPreferencesState] = useState<AppPreferences>(() => loadPreferences());
  const [session, setSession] = useState<GameSession>(() =>
    createSession("coach-game", loadPreferences().playerColor, loadPreferences().estimatedRating)
  );
  const [engineStatus, setEngineStatus] = useState<ServiceStatus>("loading");
  const [isThinking, setIsThinking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [positionEvaluation, setPositionEvaluation] = useState<PositionEvaluation>({
    fen: session.realFen,
    status: "calculating",
    line: null
  });
  const [positionCandidates, setPositionCandidates] = useState<PositionCandidates>({
    fen: session.realFen,
    status: "calculating",
    lines: []
  });
  const [question, setQuestion] = useState("");
  const [teacherExchanges, setTeacherExchanges] = useState<TeacherExchange[]>([]);
  const [costLedger, setCostLedger] = useState<GameCostLedger>(() => createGameCostLedger(session));
  const [gameSummaryOpen, setGameSummaryOpen] = useState(false);
  const [completedGameSummary, setCompletedGameSummary] = useState<GameSummary | null>(null);
  const [classificationProgress, setClassificationProgress] = useState(0);
  const [activeTeacherIndex, setActiveTeacherIndex] = useState(-1);
  const [tutorError, setTutorError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [teacherConfig, setTeacherConfig] = useState<TeacherConfigStatus>({
    openai: false,
    gemini: false
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [boardOrientation, setBoardOrientation] = useState(preferences.playerColor);
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: "white" | "black" } | null>(null);
  const [boardRevision, setBoardRevision] = useState(0);
  const staleBot = useRef(0);
  const evaluationToken = useRef(0);
  const evaluationCache = useRef(new Map<string, EngineLine>());
  const candidateCache = useRef(new Map<string, EngineLine[]>());
  const teacherRequestToken = useRef(0);
  const teacherAbortController = useRef<AbortController | null>(null);
  const pendingTeacherExchangeId = useRef<string | null>(null);
  const teacherRequestInFlight = useRef(false);
  const soundedMoveCount = useRef(session.moves.length);
  const previousVisibleFen = useRef(session.realFen);
  const classificationToken = useRef(0);
  const classificationQueue = useRef<Promise<void>>(Promise.resolve());
  const classificationProcessing = useRef(new Set<string>());
  const classificationResolved = useRef(new Set<string>());
  const previousRealGameOver = useRef(false);

  const currentFen = viewFen(session);
  const status = useMemo(() => gameStatus(currentFen), [currentFen]);
  const realStatus = useMemo(() => sessionStatus(session), [session]);
  const atLivePosition = !session.demo && session.selectedPly === session.moves.length;
  const isPlayersTurn = status.turn === session.playerColor;
  const canBranchFromHistory =
    preferences.allowHistoricalBranching &&
    !session.demo &&
    session.selectedPly < session.moves.length &&
    session.started &&
    !status.isGameOver &&
    isPlayersTurn;
  const allowsMoves =
    (atLivePosition || canBranchFromHistory) &&
    !status.isGameOver &&
    session.started &&
    isPlayersTurn;
  const helpLocked = isTeacherLocked(session.mode, realStatus.isGameOver);
  const candidatePanelAvailable = !helpLocked && teacherConfig[preferences.aiProvider];
  const botTurnPending =
    session.started &&
    atLivePosition &&
    !realStatus.isGameOver &&
    realStatus.turn !== session.playerColor;
  const visibleClassification = useMemo(
    () => visiblePlayerClassification(session, preferences.showMoveClassifications),
    [session, preferences.showMoveClassifications]
  );

  useEffect(() => {
    const nextMoveCount = session.moves.length;
    const cue = soundCueAfterMove(
      soundedMoveCount.current,
      nextMoveCount,
      realStatus.isGameOver
    );
    if (nextMoveCount > soundedMoveCount.current) {
      teacherRequestToken.current += 1;
      teacherAbortController.current?.abort();
      teacherAbortController.current = null;
      teacherRequestInFlight.current = false;
      const pendingId = pendingTeacherExchangeId.current;
      if (pendingId) {
        setTeacherExchanges((current) =>
          current.map((exchange) =>
            exchange.id === pendingId ? { ...exchange, status: "cancelled" } : exchange
          )
        );
      }
      pendingTeacherExchangeId.current = null;
      setQuestion("");
      setTutorError("");
      setIsAnalyzing(false);
    }
    soundedMoveCount.current = nextMoveCount;
    if (cue) playChessSound(cue);
  }, [session.moves.length, realStatus.isGameOver]);

  useEffect(() => {
    if (previousVisibleFen.current === currentFen) return;
    previousVisibleFen.current = currentFen;
    teacherRequestToken.current += 1;
    teacherAbortController.current?.abort();
    teacherAbortController.current = null;
    teacherRequestInFlight.current = false;
    const pendingId = pendingTeacherExchangeId.current;
    if (pendingId) {
      setTeacherExchanges((current) =>
        current.map((exchange) =>
          exchange.id === pendingId ? { ...exchange, status: "cancelled" } : exchange
        )
      );
    }
    pendingTeacherExchangeId.current = null;
    setTutorError("");
    setIsAnalyzing(false);
  }, [currentFen]);

  useEffect(() => {
    if (realStatus.isGameOver) {
      const nextSummary = summarizeGame(session, realStatus, preferences.showMoveClassifications);
      if (preferences.showMoveClassifications) {
        nextSummary.classification.pendingMoves = unclassifiedPlayerMoves(session)
          .filter((job) => !classificationResolved.current.has(job.key)).length;
      }
      setCompletedGameSummary(nextSummary);
      if (!previousRealGameOver.current) setGameSummaryOpen(true);
    } else {
      setCompletedGameSummary(null);
      setGameSummaryOpen(false);
    }
    previousRealGameOver.current = realStatus.isGameOver;
  }, [session, realStatus, preferences.showMoveClassifications, classificationProgress]);

  useEffect(() => {
    stockfish
      .initialize()
      .then(() => setEngineStatus("ready"))
      .catch(() => setEngineStatus("unavailable"));
    return () => {
      stockfish.dispose();
      moveClassifier.dispose();
    };
  }, []);

  useEffect(() => {
    void getTeacherConfig()
      .then(setTeacherConfig)
      .catch(() => setTutorError(t("teacherConfigUnavailable")));
  }, [t]);

  useEffect(() => {
    savePreferences(preferences);
    void i18n.changeLanguage(preferences.language);
  }, [preferences, i18n]);

  useEffect(() => {
    function navigateWithKeyboard(event: KeyboardEvent) {
      if (
        settingsOpen ||
        promotion ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      setSession((current) =>
        current.demo ? stepDemo(current, delta) : selectPly(current, current.selectedPly + delta)
      );
    }
    window.addEventListener("keydown", navigateWithKeyboard);
    return () => window.removeEventListener("keydown", navigateWithKeyboard);
  }, [settingsOpen, promotion]);

  useEffect(() => {
    if (!preferences.showMoveClassifications) {
      classificationToken.current += 1;
      classificationProcessing.current.clear();
      classificationResolved.current.clear();
      classificationQueue.current = Promise.resolve();
      moveClassifier.cancel();
      return;
    }

    const token = classificationToken.current;
    const sessionId = session.id;
    for (const job of unclassifiedPlayerMoves(session)) {
      if (
        classificationProcessing.current.has(job.key) ||
        classificationResolved.current.has(job.key)
      ) continue;
      classificationProcessing.current.add(job.key);
      classificationQueue.current = classificationQueue.current
        .then(async () => {
          if (token !== classificationToken.current) return;
          const classification = await moveClassifier.classify(job);
          if (!classification || token !== classificationToken.current) return;
          setSession((current) => {
            if (current.id !== sessionId) return current;
            const move = current.moves[job.index];
            if (
              !move ||
              move.classification ||
              move.uci !== job.playedMove ||
              move.fen !== job.fenAfter ||
              fenBeforeMove(current, job.index) !== job.fenBefore
            ) {
              return current;
            }
            const moves = [...current.moves];
            moves[job.index] = { ...move, classification };
            return { ...current, moves };
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (token !== classificationToken.current) return;
          classificationProcessing.current.delete(job.key);
          classificationResolved.current.add(job.key);
          setClassificationProgress((value) => value + 1);
        });
    }
  }, [session.id, session.moves.length, preferences.showMoveClassifications]);

  useEffect(() => {
    if (
      !session.started ||
      realStatus.isGameOver ||
      realStatus.turn === session.playerColor ||
      session.demo ||
      session.selectedPly !== session.moves.length
    ) {
      return;
    }
    const botToken = ++staleBot.current;
    const fen = session.realFen;
    setIsThinking(true);
    const movePromise =
      engineStatus === "ready"
        ? stockfish.bestMove(fen, preferences.estimatedRating)
        : Promise.resolve(pickFallbackBotMove(fen, preferences.estimatedRating));
    void movePromise
      .catch(() => pickFallbackBotMove(fen, preferences.estimatedRating))
      .then((uci) => {
        if (!uci || botToken !== staleBot.current) return;
        setSession((current) => {
          if (current.realFen !== fen) return current;
          return applyMove(current, uci.slice(0, 2), uci.slice(2, 4), uci.slice(4, 5) || "q") ?? current;
        });
      })
      .finally(() => {
        if (botToken === staleBot.current) setIsThinking(false);
      });
  }, [
    session.realFen,
    session.mode,
    session.started,
    session.demo,
    session.selectedPly,
    session.moves.length,
    session.playerColor,
    preferences.estimatedRating,
    engineStatus,
    realStatus.isGameOver,
    realStatus.turn
  ]);

  useEffect(() => {
    const token = ++evaluationToken.current;
    const fen = currentFen;
    const needsEvaluation = preferences.showEvaluation;
    const needsCandidates = Boolean(candidatePanelAvailable);

    if (!needsEvaluation) {
      setPositionEvaluation({ fen, status: "unavailable", line: null });
    }
    if (!needsCandidates) {
      setPositionCandidates({ fen, status: "unavailable", lines: [] });
    }
    if (!needsEvaluation && !needsCandidates) return;
    if (status.isGameOver) {
      if (needsEvaluation) setPositionEvaluation({ fen, status: "ready", line: null });
      if (needsCandidates) setPositionCandidates({ fen, status: "ready", lines: [] });
      return;
    }
    if (engineStatus === "unavailable") {
      if (needsEvaluation) setPositionEvaluation({ fen, status: "unavailable", line: null });
      if (needsCandidates) setPositionCandidates({ fen, status: "unavailable", lines: [] });
      return;
    }
    if (engineStatus !== "ready" || botTurnPending || isAnalyzing) {
      if (needsEvaluation) setPositionEvaluation({ fen, status: "calculating", line: null });
      if (needsCandidates) setPositionCandidates({ fen, status: "calculating", lines: [] });
      return;
    }

    const cachedCandidates = candidateCache.current.get(fen);
    if (cachedCandidates?.length && (!needsCandidates || cachedCandidates.length >= 3)) {
      if (needsEvaluation) {
        setPositionEvaluation({ fen, status: "ready", line: cachedCandidates[0] });
      }
      if (needsCandidates) {
        setPositionCandidates({ fen, status: "ready", lines: cachedCandidates });
      }
      return;
    }
    const cachedEvaluation = evaluationCache.current.get(fen);
    if (cachedEvaluation && !needsCandidates) {
      setPositionEvaluation({ fen, status: "ready", line: cachedEvaluation });
      return;
    }

    if (needsEvaluation) setPositionEvaluation({ fen, status: "calculating", line: null });
    if (needsCandidates) setPositionCandidates({ fen, status: "calculating", lines: [] });
    void stockfish
      .analyze(fen, { depth: needsCandidates ? 16 : 14, multiPv: needsCandidates ? 3 : 1 })
      .then((result) => {
        if (!acceptsEvaluationResult({
          visibleFen: currentFen,
          requestedFen: fen,
          resultFen: result.fen,
          requestToken: token,
          activeToken: evaluationToken.current,
          status: result.status
        })) {
          return;
        }
        const lines = result.lines.slice(0, 3).filter((line) => line.moves.length > 0);
        const line = lines[0];
        if (!line) {
          if (needsEvaluation) setPositionEvaluation({ fen, status: "unavailable", line: null });
          if (needsCandidates) setPositionCandidates({ fen, status: "unavailable", lines: [] });
          return;
        }
        evaluationCache.current.set(fen, line);
        candidateCache.current.set(fen, lines);
        if (needsEvaluation) setPositionEvaluation({ fen, status: "ready", line });
        if (needsCandidates) setPositionCandidates({ fen, status: "ready", lines });
      })
      .catch(() => {
        if (token === evaluationToken.current) {
          if (needsEvaluation) setPositionEvaluation({ fen, status: "unavailable", line: null });
          if (needsCandidates) setPositionCandidates({ fen, status: "unavailable", lines: [] });
        }
      });
  }, [
    currentFen,
    engineStatus,
    botTurnPending,
    candidatePanelAvailable,
    isAnalyzing,
    preferences.showEvaluation,
    status.isGameOver
  ]);

  function updatePreferences(patch: Partial<AppPreferences>) {
    if (patch.aiProvider && patch.aiProvider !== preferences.aiProvider && !patch.aiModel) {
      patch = { ...patch, aiModel: defaultModelByProvider[patch.aiProvider] };
    }
    setPreferencesState((current) => ({ ...current, ...patch }));
  }

  function newMode(mode: AppMode) {
    staleBot.current += 1;
    evaluationToken.current += 1;
    teacherRequestToken.current += 1;
    teacherAbortController.current?.abort();
    teacherAbortController.current = null;
    teacherRequestInFlight.current = false;
    pendingTeacherExchangeId.current = null;
    classificationToken.current += 1;
    classificationProcessing.current.clear();
    classificationResolved.current.clear();
    classificationQueue.current = Promise.resolve();
    moveClassifier.cancel();
    const next = createSession(mode, preferences.playerColor, preferences.estimatedRating);
    setSession(next);
    setCostLedger(createGameCostLedger(next));
    setGameSummaryOpen(false);
    setCompletedGameSummary(null);
    setClassificationProgress((value) => value + 1);
    previousRealGameOver.current = false;
    setTeacherExchanges([]);
    setActiveTeacherIndex(-1);
    setTutorError("");
    setPositionEvaluation({ fen: next.realFen, status: "calculating", line: null });
    setPositionCandidates({ fen: next.realFen, status: "calculating", lines: [] });
    setQuestion("");
    setBoardOrientation(preferences.playerColor);
    setMobileNavOpen(false);
  }

  function startGame() {
    if (session.started) return;
    staleBot.current += 1;
    updatePreferences({ playerColor: boardOrientation });
    setSession((current) => ({
      ...current,
      playerColor: boardOrientation,
      started: true,
      updatedAt: new Date().toISOString()
    }));
  }

  function invalidateHistoricalFuture() {
    staleBot.current += 1;
    evaluationToken.current += 1;
    teacherRequestToken.current += 1;
    teacherAbortController.current?.abort();
    teacherAbortController.current = null;
    teacherRequestInFlight.current = false;
    const pendingId = pendingTeacherExchangeId.current;
    if (pendingId) {
      setTeacherExchanges((current) =>
        current.map((exchange) =>
          exchange.id === pendingId ? { ...exchange, status: "cancelled" } : exchange
        )
      );
    }
    pendingTeacherExchangeId.current = null;
    classificationToken.current += 1;
    classificationProcessing.current.clear();
    classificationQueue.current = Promise.resolve();
    moveClassifier.cancel();
    setIsThinking(false);
    setIsAnalyzing(false);
    setQuestion("");
    setTutorError("");
  }

  function commitPlayerMove(from: string, to: string, promotionPiece = "q") {
    const branching = session.selectedPly < session.moves.length;
    const next = applyMove(
      session,
      from,
      to,
      promotionPiece,
      preferences.allowHistoricalBranching
    );
    if (!next) return false;
    if (branching) {
      invalidateHistoricalFuture();
      soundedMoveCount.current = next.moves.length;
      playChessSound("move");
    }
    setSession(next);
    return true;
  }

  function makeMove(from: string, to: string) {
    const chess = new Chess(currentFen);
    const piece = chess.get(from as Parameters<Chess["get"]>[0]);
    if (piece?.type === "p" && (to.endsWith("8") || to.endsWith("1"))) {
      setPromotion({ from, to, color: piece.color === "w" ? "white" : "black" });
      return;
    }
    commitPlayerMove(from, to);
  }

  async function askTeacher(nextQuestion = question) {
    const cleanQuestion = nextQuestion.trim();
    if (
      teacherRequestInFlight.current ||
      !cleanQuestion ||
      helpLocked ||
      !teacherConfig[preferences.aiProvider]
    ) {
      return;
    }
    teacherRequestInFlight.current = true;
    const token = ++teacherRequestToken.current;
    const controller = new AbortController();
    teacherAbortController.current?.abort();
    teacherAbortController.current = controller;
    const fenAtRequest = currentFen;
    const exchangeId = globalThis.crypto?.randomUUID?.() ?? `teacher-${Date.now()}`;
    const requestId = globalThis.crypto?.randomUUID?.() ?? `teacher-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const requestStartedAt = new Date().toISOString();
    const requestStartedClock = typeof performance !== "undefined" ? performance.now() : Date.now();
    const sessionIdAtRequest = session.id;
    let requestFinalized = false;
    const exchangeIndex = teacherExchanges.length;
    pendingTeacherExchangeId.current = exchangeId;
    setTeacherExchanges((current) => [
      ...current,
      {
        id: exchangeId,
        question: cleanQuestion,
        fen: fenAtRequest,
        ply: session.selectedPly,
        providerName: preferences.aiProvider === "gemini" ? "Google Gemini" : "OpenAI",
        status: "analyzing",
        answer: null,
        error: ""
      }
    ]);
    setActiveTeacherIndex(exchangeIndex);
    setQuestion("");
    setTutorError("");
    setIsAnalyzing(true);
    setCostLedger((current) => current.sessionId !== sessionIdAtRequest
      ? current
      : {
          ...current,
          calls: [
            ...current.calls,
            {
              id: requestId,
              question: cleanQuestion,
              fen: fenAtRequest,
              ply: session.selectedPly,
              provider: preferences.aiProvider,
              model: preferences.aiModel,
              detailLevel: preferences.detailLevel,
              startedAt: requestStartedAt,
              completedAt: null,
              durationMs: null,
              status: "pending",
              prompt: null,
              response: null,
              usage: emptyProviderUsage(),
              webSearchUsed: false,
              searchQueries: null,
              estimatedCostUsd: null
            } satisfies TeacherCallLog
          ]
        });
    let lines: EngineLine[] = [];
    try {
      if (engineStatus === "ready") {
        const depth = { brief: 16, balanced: 18, deep: 22 }[preferences.detailLevel];
        const result = await stockfish.analyze(fenAtRequest, {
          depth,
          multiPv: 3
        });
        if (
          token !== teacherRequestToken.current ||
          controller.signal.aborted ||
          result.fen !== fenAtRequest
        ) {
          return;
        }
        if (result.status === "complete") {
          lines = result.lines;
          const best = lines[0];
          if (best) {
            evaluationCache.current.set(fenAtRequest, best);
            candidateCache.current.set(fenAtRequest, lines.slice(0, 3));
            if (currentFen === fenAtRequest) {
              setPositionEvaluation({ fen: fenAtRequest, status: "ready", line: best });
              setPositionCandidates({
                fen: fenAtRequest,
                status: "ready",
                lines: lines.slice(0, 3)
              });
            }
          }
        }
      }
      const proposedMoveUci = extractLegalMoveFromQuestion(cleanQuestion, fenAtRequest);
      let proposedMove:
        | { uci: string; engineLine: EngineLine }
        | undefined;
      if (proposedMoveUci && engineStatus === "ready") {
        const existing = lines.find((line) => line.moves[0] === proposedMoveUci);
        if (existing) {
          proposedMove = { uci: proposedMoveUci, engineLine: existing };
        } else {
          const depth = { brief: 16, balanced: 18, deep: 22 }[preferences.detailLevel];
          const proposedResult = await stockfish.analyze(fenAtRequest, {
            depth,
            multiPv: 1,
            rootMoves: [proposedMoveUci]
          });
          if (
            token !== teacherRequestToken.current ||
            controller.signal.aborted ||
            proposedResult.fen !== fenAtRequest
          ) {
            return;
          }
          const proposedLine = proposedResult.lines[0];
          if (proposedResult.status === "complete" && proposedLine) {
            proposedMove = { uci: proposedMoveUci, engineLine: proposedLine };
          }
        }
      }
      const report = buildPedagogicalReport(fenAtRequest, lines);
      const request = {
        question: cleanQuestion,
        language: preferences.language,
        rating: preferences.estimatedRating,
        mode: session.mode,
        fen: fenAtRequest,
        playerColor: preferences.playerColor,
        detailLevel: preferences.detailLevel,
        historySan: session.moves.slice(0, session.selectedPly).map((move) => move.san),
        proposedMove,
        report
      } as const;
      const generated = await askTeacherApi(
        preferences.aiProvider,
        preferences.aiModel,
        request,
        controller.signal,
        requestId
      );
      requestFinalized = true;
      const cost = estimateCostUsd(
        preferences.aiProvider,
        preferences.aiModel,
        generated.telemetry.usage
      );
      setCostLedger((current) => updateTeacherCallLog(current, requestId, {
        completedAt: new Date().toISOString(),
        durationMs: elapsedMs(requestStartedClock),
        status: "completed",
        prompt: generated.telemetry.debug,
        response: generated.answer,
        usage: generated.telemetry.usage,
        webSearchUsed: generated.telemetry.webSearchUsed,
        searchQueries: generated.telemetry.searchQueries,
        estimatedCostUsd: cost.value,
        costNote: cost.note
      }));
      if (
        token === teacherRequestToken.current &&
        !controller.signal.aborted &&
        currentFen === fenAtRequest
      ) {
        setTeacherExchanges((current) =>
          current.map((exchange) =>
            exchange.id === exchangeId
              ? { ...exchange, status: "ready", answer: generated.answer, error: "" }
              : exchange
          )
        );
        setActiveTeacherIndex(exchangeIndex);
      }
    } catch (error) {
      requestFinalized = true;
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      const telemetry = error instanceof TeacherApiError ? error : null;
      const usage = telemetry?.usage ?? emptyProviderUsage();
      const cost = estimateCostUsd(preferences.aiProvider, preferences.aiModel, usage);
      setCostLedger((current) => updateTeacherCallLog(current, requestId, {
        completedAt: new Date().toISOString(),
        durationMs: elapsedMs(requestStartedClock),
        status: cancelled ? "cancelled" : "error",
        prompt: telemetry?.debug ?? null,
        response: null,
        usage,
        webSearchUsed: telemetry?.webSearchUsed ?? false,
        searchQueries: telemetry?.searchQueries ?? null,
        estimatedCostUsd: cost.value,
        costNote: cost.note,
        error: cancelled ? "La solicitud fue cancelada." : error instanceof Error ? error.message : t("tutorFailed")
      }));
      if (
        token === teacherRequestToken.current &&
        !controller.signal.aborted &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setTeacherExchanges((current) =>
          current.map((exchange) =>
            exchange.id === exchangeId
              ? {
                  ...exchange,
                  status: "error",
                  answer: null,
                  error: error instanceof Error ? error.message : t("tutorFailed")
                }
              : exchange
          )
        );
        setActiveTeacherIndex(exchangeIndex);
      }
    } finally {
      if (!requestFinalized) {
        setCostLedger((current) => updateTeacherCallLog(current, requestId, {
          completedAt: new Date().toISOString(),
          durationMs: elapsedMs(requestStartedClock),
          status: "cancelled",
          error: "La solicitud fue cancelada antes de completarse."
        }));
      }
      if (token === teacherRequestToken.current) {
        teacherAbortController.current = null;
        pendingTeacherExchangeId.current = null;
        teacherRequestInFlight.current = false;
        setIsAnalyzing(false);
      }
    }
  }

  async function saveTeacherConfiguration(provider: AppPreferences["aiProvider"], apiKey: string) {
    const status = await configureTeacher(provider, apiKey);
    setTeacherConfig(status);
    setTutorError("");
  }

  function downloadText(filename: string, content: string, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportGameJson() {
    if (!completedGameSummary) return;
    const document = buildGameExport(session, completedGameSummary, costLedger);
    const date = new Date(session.createdAt).toISOString().slice(0, 10);
    downloadText(
      `quietmove-partida-${date}.json`,
      JSON.stringify(document, null, 2),
      "application/json"
    );
  }

  const arrows: Array<[string, string]> = [];
  const highlightedSquares: string[] = [];
  const activeExchange = teacherExchanges[activeTeacherIndex] ?? null;
  const candidateRows = positionCandidates.fen === currentFen
    ? positionCandidates.lines.slice(0, 3).map((line) =>
        engineVariationToSan(currentFen, line.moves, 10).join(" ")
      )
    : [];

  return (
    <div className="app-shell" data-theme={preferences.theme}>
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen((value) => !value)} aria-label="Menu">
          <Menu size={20} />
        </button>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span>Q</span>
          </div>
          <h1>QuietMove</h1>
        </div>
        <div className="top-status">
          <span
            className={`engine-indicator ${engineStatus}`}
            title={`${t("engine")}: ${engineStatus === "ready" ? t("ready") : engineStatus === "loading" ? "…" : t("unavailable")}`}
          >
            <i />
            {t("engine")}
          </span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label={t("settings")}>
            <Settings size={19} />
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className={`mode-rail ${mobileNavOpen ? "is-open" : ""}`} aria-label="Training modes">
          <div className="rail-kicker">MODOS</div>
          {appModes.map((mode) => {
            const Icon = modeIcons[mode];
            return (
              <button
                key={mode}
                className={`mode-button ${session.mode === mode ? "active" : ""}`}
                onClick={() => newMode(mode)}
                aria-current={session.mode === mode ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={1.7} />
                <span>{t(`modeShort.${mode}`)}</span>
              </button>
            );
          })}
        </aside>

        <main className="workspace">
          <section className="board-column">
            <div className={`board-stage ${session.demo ? "demo" : ""}`}>
              <div className="board-toolbar">
                {!session.started && (
                  <button
                    className="icon-button start-game"
                    onClick={startGame}
                    aria-label={t("startGame")}
                    title={t("startGame")}
                  >
                    <Play size={16} fill="currentColor" />
                  </button>
                )}
                {!session.started && (
                  <button
                    className="icon-button"
                    onClick={() =>
                      setBoardOrientation((current) => (current === "white" ? "black" : "white"))
                    }
                    aria-label={t("orientation")}
                    title={t("orientation")}
                  >
                    <ArrowUpDown size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={() => newMode(session.mode)}
                  aria-label={t("newSession")}
                  title={t("newSession")}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              {(isThinking || positionEvaluation.status === "calculating") && (
                <div className="board-activity" role="status">
                  <LoaderCircle className="spin" size={15} />
                  <span>{t("stockfishCalculating")}</span>
                </div>
              )}

              <div className={`board-and-eval ${preferences.showEvaluation ? "" : "without-evaluation"}`}>
                {preferences.showEvaluation && (
                  <EvaluationBar
                    evaluation={positionEvaluation}
                    gameStatus={status}
                    orientation={boardOrientation}
                  />
                )}
                <div className="board-frame">
                  <ChessBoard
                    key={boardRevision}
                    fen={currentFen}
                    orientation={boardOrientation}
                    interactive={allowsMoves}
                    lastMove={
                      session.demo && session.demo.index > 0
                        ? [
                            session.demo.moves[session.demo.index - 1].from,
                            session.demo.moves[session.demo.index - 1].to
                          ]
                        : session.selectedPly > 0
                          ? [
                              session.moves[session.selectedPly - 1]?.from ?? "",
                              session.moves[session.selectedPly - 1]?.to ?? ""
                            ]
                          : undefined
                    }
                    arrows={arrows}
                    highlightedSquares={highlightedSquares}
                    moveAnnotation={visibleClassification ? {
                      square: visibleClassification.move.to,
                      kind: visibleClassification.classification.kind,
                      symbol: moveClassificationSymbols[visibleClassification.classification.kind],
                      label: classificationLabel(visibleClassification.classification, t)
                    } : undefined}
                    onMove={makeMove}
                  />
                  {session.demo && (
                    <div className="board-state-badge">{t("demonstration")}</div>
                  )}
                  {!session.demo && status.isCheck && !realStatus.isGameOver && (
                    <div className="board-state-badge">{t("check")}</div>
                  )}
                  {!session.demo && realStatus.isGameOver && (
                    <button
                      className="board-state-badge board-state-button"
                      onClick={() => setGameSummaryOpen(true)}
                      aria-label={t("openGameSummary")}
                      title={t("openGameSummary")}
                    >
                      {t("gameOver")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <aside className="teacher-column">
            {helpLocked ? (
              <div className="locked-card">
                <ShieldCheck size={30} />
                <h3>{t("modes.solo-game")}</h3>
                <p>{t("soloLocked")}</p>
              </div>
            ) : !teacherConfig[preferences.aiProvider] ? (
              <div className="teacher-setup">
                <button className="teacher-setup-button" onClick={() => setSettingsOpen(true)}>
                  <KeyRound size={24} />
                  {t("configureModel")}
                </button>
              </div>
            ) : (
              <>
                {teacherExchanges.length > 1 && (
                  <div className="teacher-header">
                    <div className="teacher-history-nav">
                      <button
                        onClick={() => setActiveTeacherIndex((current) => Math.max(0, current - 1))}
                        disabled={activeTeacherIndex <= 0}
                        aria-label={t("previousQuestion")}
                        title={t("previousQuestion")}
                      >
                        <ChevronUp size={19} />
                      </button>
                      <span aria-label={t("questionPosition", {
                        current: activeTeacherIndex + 1,
                        total: teacherExchanges.length
                      })}>
                        {activeTeacherIndex + 1}/{teacherExchanges.length}
                      </span>
                      <button
                        onClick={() =>
                          setActiveTeacherIndex((current) =>
                            Math.min(teacherExchanges.length - 1, current + 1)
                          )
                        }
                        disabled={activeTeacherIndex >= teacherExchanges.length - 1}
                        aria-label={t("nextQuestion")}
                        title={t("nextQuestion")}
                      >
                        <ChevronDown size={19} />
                      </button>
                    </div>
                  </div>
                )}

                <section
                  className="engine-variations"
                  aria-label={t("bestEngineLines")}
                  data-status={positionCandidates.status}
                >
                  <ol>
                    {[0, 1, 2].map((index) => {
                      const line = candidateRows[index];
                      const text = positionCandidates.status === "calculating" ? "…" : line || "—";
                      return <li key={index} title={line || undefined}><span>{text}</span></li>;
                    })}
                  </ol>
                </section>

                <div className="conversation" aria-live="polite">
                  {!activeExchange && (
                    <div className="empty-teacher">
                      <div className="constellation" aria-hidden="true">♞</div>
                    </div>
                  )}
                  {activeExchange && <TeacherExchangeView exchange={activeExchange} t={t} />}
                  {tutorError && !activeExchange && (
                    <p className="tutor-error" role="alert">{tutorError}</p>
                  )}
                </div>

                <div className="question-box">
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={t("questionPlaceholder")}
                    rows={2}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void askTeacher();
                      }
                    }}
                  />
                  <button
                    className="ask-button"
                    aria-label={t("ask")}
                    title={t("ask")}
                    disabled={!question.trim() || isAnalyzing}
                    onClick={() => void askTeacher()}
                  >
                    {isAnalyzing ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                  </button>
                </div>
              </>
            )}
          </aside>

          <HistoryPanel
            session={session}
            t={t}
            onSelect={(ply) => setSession((current) => selectPly(current, ply))}
            onDemoStep={(delta) => setSession((current) => stepDemo(current, delta))}
            onExitDemo={() => setSession((current) => setDemo(current, null))}
            onCopyFen={() => navigator.clipboard?.writeText(currentFen)}
            onExportPgn={() => downloadText("quietmove-game.pgn", exportPgn(session))}
          />
        </main>
      </div>

      {gameSummaryOpen && completedGameSummary && (
        <GameSummaryDialog
          summary={completedGameSummary}
          session={session}
          engineAvailable={engineStatus !== "unavailable"}
          classificationsEnabled={preferences.showMoveClassifications}
          onClose={() => setGameSummaryOpen(false)}
          onExport={exportGameJson}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          preferences={preferences}
          onChange={updatePreferences}
          onClose={() => setSettingsOpen(false)}
          teacherConfig={teacherConfig}
          onConfigure={saveTeacherConfiguration}
          t={t}
        />
      )}

      {promotion && (
        <PromotionDialog
          color={promotion.color}
          onChoose={(piece) => {
            commitPlayerMove(promotion.from, promotion.to, piece);
            setPromotion(null);
            setBoardRevision((value) => value + 1);
          }}
          onCancel={() => {
            setPromotion(null);
            setBoardRevision((value) => value + 1);
          }}
        />
      )}

    </div>
  );
}

function elapsedMs(start: number) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return Math.max(0, Math.round(now - start));
}

function updateTeacherCallLog(
  ledger: GameCostLedger,
  id: string,
  patch: Partial<TeacherCallLog>
): GameCostLedger {
  return {
    ...ledger,
    calls: ledger.calls.map((call) => call.id === id ? { ...call, ...patch } : call)
  };
}

function fenBeforeMove(session: GameSession, index: number) {
  return index <= 0 ? session.initialFen : session.moves[index - 1]?.fen ?? session.initialFen;
}

function unclassifiedPlayerMoves(session: GameSession) {
  return session.moves.flatMap((move, index) => {
    const fenBefore = fenBeforeMove(session, index);
    const mover = fenBefore.split(/\s+/)[1] === "w" ? "white" : "black";
    if (mover !== session.playerColor || move.classification) return [];
    const previousOpponentFen =
      index <= 0
        ? undefined
        : index === 1
          ? session.initialFen
          : session.moves[index - 2]?.fen;
    return [{
      key: `${session.id}:${index}:${move.uci}`,
      index,
      fenBefore,
      fenAfter: move.fen,
      playedMove: move.uci,
      previousOpponentFen
    }];
  });
}

function visiblePlayerClassification(session: GameSession, enabled: boolean) {
  if (!enabled || session.demo || session.selectedPly <= 0) return null;
  for (let index = Math.min(session.selectedPly, session.moves.length) - 1; index >= 0; index -= 1) {
    const move = session.moves[index];
    const mover = fenBeforeMove(session, index).split(/\s+/)[1] === "w" ? "white" : "black";
    if (mover !== session.playerColor) continue;
    return move?.classification ? { move, classification: move.classification } : null;
  }
  return null;
}

function classificationLabel(
  classification: MoveClassification,
  t: ReturnType<typeof useTranslation>["t"]
) {
  const label = t(`moveClassification.${classification.kind}`);
  return classification.opening
    ? `${label}: ${classification.opening.eco} · ${classification.opening.name}`
    : label;
}

function EvaluationBar({
  evaluation,
  gameStatus: currentGameStatus,
  orientation
}: {
  evaluation: PositionEvaluation;
  gameStatus: ReturnType<typeof gameStatus>;
  orientation: "white" | "black";
}) {
  const { t } = useTranslation();
  const normalized = evaluation.line
    ? normalizeEvaluationForWhite(evaluation.fen, evaluation.line)
    : null;
  const isCalculating = evaluation.status === "calculating";
  let whitePercent = normalized?.whitePercent ?? 50;
  let label = "—";

  if (currentGameStatus.isGameOver) {
    if (currentGameStatus.isCheckmate) {
      const whiteLost = currentGameStatus.turn === "white";
      whitePercent = whiteLost ? 0 : 100;
      label = whiteLost ? "0–1" : "1–0";
    } else {
      whitePercent = 50;
      label = "½–½";
    }
  } else if (normalized) {
    if (normalized.whiteMate !== null) {
      label = `M${Math.abs(normalized.whiteMate)}`;
    } else if (normalized.whiteScoreCp !== null) {
      label = `${normalized.whiteScoreCp >= 0 ? "+" : ""}${(normalized.whiteScoreCp / 100).toFixed(1)}`;
    }
  }
  return (
    <div
      className={[
        "evaluation-bar",
        `orientation-${orientation}`,
        isCalculating ? "calculating" : "",
        evaluation.status === "unavailable" ? "unavailable" : ""
      ].filter(Boolean).join(" ")}
      aria-label={
        isCalculating || evaluation.status !== "ready"
          ? "Evaluation"
          : t("evaluationForWhite", { value: label })
      }
      title={
        isCalculating || evaluation.status !== "ready"
          ? undefined
          : t("evaluationForWhite", { value: label })
      }
      aria-busy={isCalculating}
      data-evaluation-fen={evaluation.fen}
      data-evaluation-status={evaluation.status}
      data-evaluation-perspective="white"
      data-evaluation-value={label}
    >
      {!isCalculating && evaluation.status === "ready" && (
        <div className="eval-white" style={{ height: `${whitePercent}%` }} />
      )}
      <span>
        {isCalculating
          ? "…"
          : evaluation.status === "unavailable"
            ? "—"
            : label}
      </span>
    </div>
  );
}

function HistoryPanel({
  session,
  t,
  onSelect,
  onDemoStep,
  onExitDemo,
  onCopyFen,
  onExportPgn
}: {
  session: GameSession;
  t: ReturnType<typeof useTranslation>["t"];
  onSelect: (ply: number) => void;
  onDemoStep: (delta: number) => void;
  onExitDemo: () => void;
  onCopyFen: () => void;
  onExportPgn: () => void;
}) {
  return (
    <section className="history-panel">
      <div className="history-title">
        <span>{session.demo ? session.demo.label : t("history")}</span>
        <div className="history-actions">
          {session.demo ? (
            <button className="text-button" onClick={onExitDemo}>
              <X size={15} /> {t("returnGame")}
            </button>
          ) : (
            <>
              <button onClick={onCopyFen} title={t("copyFen")} aria-label={t("copyFen")}><Clipboard size={14} /></button>
              <button onClick={onExportPgn} title={t("exportPgn")} aria-label={t("exportPgn")}><Download size={14} /></button>
            </>
          )}
        </div>
      </div>
      <div className="moves-strip">
        {!session.moves.length && !session.demo && <em>{t("noMoves")}</em>}
        {(session.demo ? session.demo.moves : session.moves).map((move, index) => (
          <button
            key={`${move.uci}-${index}`}
            className={
              (session.demo ? session.demo.index === index + 1 : session.selectedPly === index + 1)
                ? "current"
                : ""
            }
            onClick={() => (session.demo ? null : onSelect(index + 1))}
          >
            {index % 2 === 0 && <small>{Math.floor(index / 2) + 1}.</small>}
            {move.san}
          </button>
        ))}
      </div>
      <div className="history-controls">
        <button onClick={() => (session.demo ? onDemoStep(-999) : onSelect(0))} aria-label="Start">
          <ChevronFirst size={18} />
        </button>
        <button
          onClick={() => (session.demo ? onDemoStep(-1) : onSelect(session.selectedPly - 1))}
          aria-label="Previous"
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {session.demo
            ? `${session.demo.index}/${session.demo.moves.length}`
            : `${session.selectedPly}/${session.moves.length}`}
        </span>
        <button
          onClick={() => (session.demo ? onDemoStep(1) : onSelect(session.selectedPly + 1))}
          aria-label="Next"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => (session.demo ? onDemoStep(999) : onSelect(session.moves.length))}
          aria-label="End"
        >
          <ChevronLast size={18} />
        </button>
      </div>
    </section>
  );
}

function TeacherExchangeView({
  exchange,
  t
}: {
  exchange: TeacherExchange;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <article
      className="teacher-exchange"
      data-teacher-exchange-id={exchange.id}
      data-teacher-exchange-status={exchange.status}
      data-teacher-exchange-fen={exchange.fen}
    >
      <div className="teacher-question">
        <span>{t("yourQuestion")}</span>
        <p>{exchange.question}</p>
      </div>
      {exchange.answer && <TeacherAnswer answer={exchange.answer} />}
      {exchange.status === "analyzing" && (
        <div className="analysis-state">
          <LoaderCircle className="spin" size={20} />
          <span>{t("consultingProvider", { provider: exchange.providerName })}</span>
        </div>
      )}
      {exchange.status === "error" && (
        <p className="tutor-error" role="alert">{exchange.error}</p>
      )}
      {exchange.status === "cancelled" && (
        <p className="teacher-cancelled">{t("teacherCancelledPosition")}</p>
      )}
    </article>
  );
}

function TeacherAnswer({ answer }: { answer: TeacherAnswer }) {
  return (
    <div className="teacher-answer">
      <Suspense fallback={null}>
        <MarkdownAnswer content={answer.summary} />
      </Suspense>
      {answer.sources.length > 0 && (
        <div className="teacher-sources">
          {answer.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function GameSummaryDialog({
  summary,
  session,
  engineAvailable,
  classificationsEnabled,
  onClose,
  onExport
}: {
  summary: GameSummary;
  session: GameSession;
  engineAvailable: boolean;
  classificationsEnabled: boolean;
  onClose: () => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  const pending = classificationsEnabled && engineAvailable && summary.classification.pendingMoves > 0;
  const rating = summary.provisionalRating;
  const ratingText = rating.range
    ? rating.range
    : rating.confidence === "insufficient"
      ? t("ratingInsufficient")
      : t("ratingUnavailable");
  const confidenceText =
    rating.confidence === "very-provisional"
      ? t("ratingVeryProvisional")
      : rating.confidence === "provisional"
        ? t("ratingProvisional")
        : "";

  return (
    <div className="dialog-backdrop game-summary-backdrop" role="presentation">
      <div
        className="dialog-card game-summary-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-summary-title"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">QUIETMOVE</span>
            <h2 id="game-summary-title">{t("gameSummaryTitle")}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t("close")} title={t("close")}>
            <X size={19} />
          </button>
        </div>

        <div className="game-result-block">
          <span>{t("gameResult")}</span>
          <strong>{summary.result ?? "—"}</strong>
          <small>{session.mode === "solo-game" ? t("modes.solo-game") : t("modes.coach-game")}</small>
        </div>

        <section className="classification-summary" aria-labelledby="classification-summary-title">
          <div className="summary-section-heading">
            <h3 id="classification-summary-title">{t("moveClassificationsSummary")}</h3>
            {pending && (
              <span className="summary-loading" role="status">
                <LoaderCircle className="spin" size={15} />
                {t("classificationsCalculating", {
                  remaining: summary.classification.pendingMoves
                })}
              </span>
            )}
          </div>
          {!classificationsEnabled ? (
            <p className="summary-muted">{t("classificationsDisabled")}</p>
          ) : (
            <div className="classification-summary-grid">
              {classificationKinds.map((kind) => (
                <div className="classification-summary-item" key={kind}>
                  <span className={`classification-symbol classification-${kind}`} aria-hidden="true">
                    {moveClassificationSymbols[kind]}
                  </span>
                  <span>{t(`moveClassification.${kind}`)}</span>
                  <strong>{summary.classification.counts[kind] ?? 0}</strong>
                </div>
              ))}
            </div>
          )}
          {classificationsEnabled && !pending && !engineAvailable && (
            <p className="summary-muted">{t("classificationsUnavailable")}</p>
          )}
          {classificationsEnabled && !pending && engineAvailable && summary.classification.playerMoves > 0 && (
            <p className="summary-footnote">
              {t("classifiedMoves", {
                classified: summary.classification.classifiedMoves,
                total: summary.classification.playerMoves
              })}
            </p>
          )}
        </section>

        <section className="rating-summary" aria-labelledby="rating-summary-title">
          <h3 id="rating-summary-title">{t("estimatedPerformance")}</h3>
          <strong>{ratingText}</strong>
          {rating.accuracyPercent !== null && (
            <span>{t("accuracyFromMoves", { value: rating.accuracyPercent.toFixed(1) })}</span>
          )}
          {confidenceText && <small>{confidenceText}</small>}
        </section>

        <div className="game-summary-actions">
          <button
            className="primary export-summary-button"
            onClick={onExport}
            disabled={pending}
            title={pending ? t("waitForClassifications") : t("exportJson")}
          >
            {pending ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {pending ? t("preparingJson") : t("exportJson")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsDialog({
  preferences,
  onChange,
  onClose,
  teacherConfig,
  onConfigure,
  t
}: {
  preferences: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
  onClose: () => void;
  teacherConfig: TeacherConfigStatus;
  onConfigure: (provider: AppPreferences["aiProvider"], apiKey: string) => Promise<void>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [apiKey, setApiKey] = useState("");
  const [connectionState, setConnectionState] = useState<"idle" | "saving" | "error">("idle");
  const availableModels = modelsForProvider(preferences.aiProvider);
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-heading">
          <div><span className="eyebrow">QUIETMOVE</span><h2 id="settings-title">{t("settings")}</h2></div>
          <button className="icon-button" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="settings-grid">
          <label>
            <span><Languages size={17} />{t("language")}</span>
            <select value={preferences.language} onChange={(e) => onChange({ language: e.target.value as "es" | "en" })}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span><MessageSquareText size={17} />{t("detail")}</span>
            <select value={preferences.detailLevel} onChange={(e) => onChange({ detailLevel: e.target.value as AppPreferences["detailLevel"] })}>
              <option value="brief">{t("brief")}</option>
              <option value="balanced">{t("balanced")}</option>
              <option value="deep">{t("deep")}</option>
            </select>
          </label>
          <label className="model-setting">
            <span><BrainCircuit size={17} />{t("provider")}</span>
            <select
              value={preferences.aiProvider}
              onChange={(event) =>
                onChange({ aiProvider: event.target.value as AppPreferences["aiProvider"] })
              }
            >
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </label>
          <label className="model-setting">
            <span><BrainCircuit size={17} />{t("model")}</span>
            <select
              value={preferences.aiModel}
              onChange={(event) =>
                onChange({ aiModel: event.target.value as AppPreferences["aiModel"] })
              }
            >
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} · {t(model.quality)}
                </option>
              ))}
            </select>
          </label>
          <div className="api-key-setting">
            <label htmlFor="teacher-api-key">
              <span><KeyRound size={17} />{t("apiKey")}</span>
            </label>
            <div className="api-key-row">
              <input
                id="teacher-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setConnectionState("idle");
                }}
                placeholder={t("apiKeyPlaceholder")}
              />
              <button
                className="primary"
                disabled={apiKey.trim().length < 10 || connectionState === "saving"}
                onClick={async () => {
                  setConnectionState("saving");
                  try {
                    await onConfigure(preferences.aiProvider, apiKey);
                    setApiKey("");
                    setConnectionState("idle");
                  } catch {
                    setConnectionState("error");
                  }
                }}
              >
                {connectionState === "saving" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {t("saveConnection")}
              </button>
            </div>
            <small className={`setting-note ${connectionState === "error" ? "error" : ""}`}>
              {connectionState === "error"
                ? t("connectionFailed")
                : teacherConfig[preferences.aiProvider]
                  ? t("connectionReady")
                  : t("connectionMissing")}
            </small>
            <small className="key-privacy">{t("keyPrivacy")}</small>
          </div>
          <label>
            <span><BrainCircuit size={17} />{t("estimated")}</span>
            <input type="range" min="0" max="3000" step="100" value={preferences.estimatedRating} onChange={(e) => onChange({ estimatedRating: Number(e.target.value) })} />
            <output>{preferences.estimatedRating}</output>
          </label>
          <section className="settings-section" aria-labelledby="board-aids-title">
            <h3 id="board-aids-title">{t("boardAids")}</h3>
            <Toggle
              checked={preferences.showEvaluation}
              onChange={(checked) => onChange({ showEvaluation: checked })}
              label={t("showEvaluation")}
              icon={<Eye size={17} />}
            />
            <Toggle
              checked={preferences.showMoveClassifications}
              onChange={(checked) => onChange({ showMoveClassifications: checked })}
              label={t("showMoveClassifications")}
              icon={<BadgeCheck size={17} />}
            />
            <Toggle
              checked={preferences.allowHistoricalBranching}
              onChange={(checked) => onChange({ allowHistoricalBranching: checked })}
              label={t("allowHistoricalBranching")}
              icon={<GitBranch size={17} />}
            />
          </section>
          <Toggle
            checked={preferences.theme === "dark"}
            onChange={(checked) => onChange({ theme: checked ? "dark" : "light" })}
            label={t("darkMode")}
            icon={<Moon size={17} />}
          />
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  icon
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <label className="toggle-row">
      <span>{icon}{label}</span>
      <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
        <i />
      </button>
    </label>
  );
}

function PromotionDialog({
  color,
  onChoose,
  onCancel
}: {
  color: "white" | "black";
  onChoose: (piece: string) => void;
  onCancel: () => void;
}) {
  const glyphs =
    color === "white"
      ? { q: "♕", r: "♖", b: "♗", n: "♘" }
      : { q: "♛", r: "♜", b: "♝", n: "♞" };
  return (
    <div className="dialog-backdrop">
      <div className="promotion-dialog" role="dialog" aria-modal="true" aria-label="Pawn promotion">
        {(Object.entries(glyphs) as Array<[string, string]>).map(([piece, glyph]) => (
          <button key={piece} onClick={() => onChoose(piece)} aria-label={`Promote to ${piece}`}>
            {glyph}
          </button>
        ))}
        <button className="promotion-cancel" onClick={onCancel}><X size={18} /></button>
      </div>
    </div>
  );
}
