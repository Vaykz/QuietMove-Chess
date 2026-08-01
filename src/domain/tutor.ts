import { Chess, type Square } from "chess.js";
import type { TutorRequest, TutorResponse } from "./types";
import { tutorResponseSchema } from "./types";

export function deterministicTutor(request: TutorRequest): TutorResponse {
  const es = request.language === "es";
  const report = request.report;
  const line = report.engineLines[0];
  const bestMove = line?.moves[0] ?? report.checks[0] ?? report.captures[0];
  const variation = line?.moves ?? (bestMove ? [bestMove] : []);
  const summary = es
    ? report.hangingPieces.length
      ? `Antes de elegir un plan, revisa la seguridad de ${report.hangingPieces.join(", ")}. Hay una amenaza concreta que merece prioridad.`
      : `La posición ofrece ${report.legalMoveCount} jugadas legales. Conviene comparar primero jaques, capturas y amenazas antes de decidir el plan.`
    : report.hangingPieces.length
      ? `Before choosing a plan, check the safety of ${report.hangingPieces.join(", ")}. A concrete threat deserves priority.`
      : `The position has ${report.legalMoveCount} legal moves. Compare checks, captures and threats before choosing a plan.`;

  const response: TutorResponse = {
    summary,
    userIdea: es
      ? "Tu pregunta busca convertir la evaluación de la posición en una decisión comprensible."
      : "Your question is trying to turn the position's evaluation into an understandable decision.",
    problem: es
      ? report.hangingPieces.length
        ? "Una pieza atacada y sin defensa suficiente puede volver irrelevante un plan más lento."
        : "Sin una línea de motor cargada todavía, no es seguro afirmar que exista una única mejor jugada."
      : report.hangingPieces.length
        ? "An attacked and insufficiently defended piece can make a slower plan irrelevant."
        : "Without a loaded engine line, it is not safe to claim there is one uniquely best move.",
    recommendedPlan: bestMove
      ? es
        ? `Examina primero ${bestMove}. Reproduce la variante para comprobar la respuesta más exigente del rival.`
        : `Examine ${bestMove} first. Replay the line to verify the opponent's most testing response.`
      : es
        ? "Mejora la coordinación sin dejar piezas indefensas y vuelve a comprobar las amenazas rivales."
        : "Improve coordination without leaving pieces undefended, then recheck the opponent's threats.",
    variations: variation.length
      ? [{ label: es ? "Línea comprobable" : "Verifiable line", moves: variation, evaluation: evaluationText(line) }]
      : [],
    visualSteps: variation.length
      ? [
          {
            id: "main-line",
            fen: request.fen,
            moves: variation,
            arrows: [[variation[0].slice(0, 2), variation[0].slice(2, 4)]],
            squares: report.hangingPieces,
            text: summary,
            durationMs: 1800
          }
        ]
      : [],
    speechSegments: [{ text: summary, visualStepId: variation.length ? "main-line" : null }],
    confidence: line ? "high" : "limited",
    limitations: report.limitations,
    sources: []
  };
  return tutorResponseSchema.parse(response);
}

function evaluationText(line: TutorRequest["report"]["engineLines"][number] | undefined) {
  if (!line) return "—";
  if (line.mate !== null) return `M${line.mate}`;
  return line.scoreCp === null ? "—" : `${line.scoreCp >= 0 ? "+" : ""}${(line.scoreCp / 100).toFixed(2)}`;
}

export function validateTutorResponse(fen: string, candidate: unknown): TutorResponse | null {
  const parsed = tutorResponseSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const visualIds = new Set(parsed.data.visualSteps.map((step) => step.id));
  if (
    parsed.data.speechSegments.some(
      (segment) => segment.visualStepId && !visualIds.has(segment.visualStepId)
    )
  ) {
    return null;
  }
  for (const variation of parsed.data.variations) {
    if (!isLegalLine(fen, variation.moves)) return null;
  }
  for (const step of parsed.data.visualSteps) {
    if (step.fen !== fen || !isLegalLine(step.fen, step.moves)) return null;
  }
  return parsed.data;
}

export function isLegalLine(fen: string, moves: string[]) {
  const chess = new Chess(fen);
  try {
    for (const uci of moves) {
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.slice(4, 5) || "q"
      });
      if (!move) return false;
    }
    return true;
  } catch {
    return false;
  }
}
