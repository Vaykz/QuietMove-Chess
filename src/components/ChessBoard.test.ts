import { describe, expect, it } from "vitest";
import { squareGridPosition } from "./ChessBoard";

describe("move classification board coordinates", () => {
  it("maps every square to the correct grid cell for both orientations", () => {
    expect(squareGridPosition("a8", "white")).toEqual({ column: 1, row: 1 });
    expect(squareGridPosition("h1", "white")).toEqual({ column: 8, row: 8 });
    expect(squareGridPosition("a8", "black")).toEqual({ column: 8, row: 8 });
    expect(squareGridPosition("h1", "black")).toEqual({ column: 1, row: 1 });
    expect(squareGridPosition("c3", "white")).toEqual({ column: 3, row: 6 });
    expect(squareGridPosition("c3", "black")).toEqual({ column: 6, row: 3 });
  });

  it("rejects invalid squares", () => {
    expect(squareGridPosition("i9", "white")).toBeNull();
  });
});
