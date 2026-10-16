import { describe, expect, test } from "bun:test";
import { buildJevTriageRequest, capabilityNames, JEV_MODEL, parseCapabilities, sourceCheckouts } from "../src";

describe("Windows capability activation", () => {
  test("is opt-in", () => {
    expect(parseCapabilities("")).toEqual([]);
    expect(parseCapabilities("winrt,dotnet")).toEqual(["winrt", "dotnet"]);
    expect(parseCapabilities("all")).toEqual([...capabilityNames]);
  });

  test("rejects misspelled capabilities", () => {
    expect(() => parseCapabilities("winrt,wine")).toThrow("wine");
  });

  test("owns the pinned source checkout map", () => {
    expect(sourceCheckouts().terminal.pathname.replaceAll("\\", "/")).toEndWith("/vendor/windows-terminal/");
  });
});

describe("Jev triage", () => {
  test("keeps workflow decisions in code", () => {
    const request = buildJevTriageRequest({
      summary: "PowerShell quoting differs from Bun Shell",
      evidence: ["A literal backtick is consumed"],
      component: "shell",
    });

    expect(request.model).toBe(JEV_MODEL);
    expect(request.state.finding.component).toBe("shell");
    expect(request.questions.area.criteria).toHaveProperty("none_of_the_above");
    expect(request.questions.needs_reasoning_review.type).toBe("noul");
  });
});
