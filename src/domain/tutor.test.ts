import { describe, expect, it } from "vitest";
import { START_FEN } from "./game";
import { validateTutorResponse } from "./tutor";

const valid = {
  summary: "Develop a piece.",
  userIdea: "Improve coordination.",
  problem: "No immediate problem.",
  recommendedPlan: "Play Nf3.",
  variations: [{ label: "Line", moves: ["g1f3"], evaluation: "+0.2" }],
  visualSteps: [
    {
      id: "line",
      fen: START_FEN,
      moves: ["g1f3"],
      arrows: [["g1", "f3"]],
      squares: ["f3"],
      text: "Nf3 develops.",
      durationMs: 1000
    }
  ],
  speechSegments: [{ text: "Nf3 develops.", visualStepId: "line" }],
  confidence: "medium",
  limitations: []
};

describe("tutor contract", () => {
  it("accepts a legal response tied to the exact FEN", () => {
    expect(validateTutorResponse(START_FEN, valid)).not.toBeNull();
  });

  it("rejects an illegal generated variation", () => {
    expect(
      validateTutorResponse(START_FEN, {
        ...valid,
        variations: [{ label: "Invented", moves: ["e2e5"], evaluation: "+9" }]
      })
    ).toBeNull();
  });

  it("rejects speech references without a visual step", () => {
    expect(
      validateTutorResponse(START_FEN, {
        ...valid,
        speechSegments: [{ text: "Missing", visualStepId: "not-there" }]
      })
    ).toBeNull();
  });
});
