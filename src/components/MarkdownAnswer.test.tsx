import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownAnswer from "./MarkdownAnswer";

describe("teacher Markdown rendering", () => {
  it("renders common formatting without executing embedded HTML", () => {
    const { container } = render(
      <MarkdownAnswer content={"**Idea principal**\n\n- Primera razón\n- Segunda razón\n\n<script>alert(1)</script>"} />
    );

    expect(screen.getByText("Idea principal").tagName).toBe("STRONG");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("script")).toBeNull();
    expect(container).not.toHaveTextContent("<script>");
  });
});
