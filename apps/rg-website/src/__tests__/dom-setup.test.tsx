/// <reference lib="dom" />
// Smoke test du setup DOM testing (happy-dom preload via bunfig.toml [test] preload).
// Atteste que les globals navigateur (document/window) et React Testing Library
// fonctionnent sous `bun test`. Voir https://bun.com/docs/test/dom.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("setup DOM testing (happy-dom)", () => {
  test("le global document est disponible", () => {
    document.body.innerHTML = "<button>Salut</button>";
    expect(document.querySelector("button")?.textContent).toBe("Salut");
  });

  test("React Testing Library rend un composant", () => {
    render(<button type="button">Cliquez-moi</button>);
    expect(screen.getByRole("button").textContent).toBe("Cliquez-moi");
  });
});
