// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";

type Token = { t: "n"; v: number } | { t: "o"; v: string };
const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(\d+\.?\d*|\.\d+|[-+*/%^()])/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error("Invalid input");
    i = re.lastIndex;
    const s = m[1]!;
    const prev = out.at(-1);
    const unary = s === "-" && (!prev || (prev.t === "o" && prev.v !== ")"));
    if (/^[\d.]/.test(s)) out.push({ t: "n", v: Number(s) });
    else if (unary) out.push({ t: "n", v: 0 }, { t: "o", v: "-" });
    else out.push({ t: "o", v: s });
  }
  return out;
}

/** Shunting-yard evaluation; no eval, no Function. */
export function evaluate(src: string): number {
  const output: number[] = [];
  const ops: string[] = [];
  const apply = () => {
    const op = ops.pop()!;
    const b = output.pop();
    const a = output.pop();
    if (a === undefined || b === undefined) throw new Error("Invalid expression");
    output.push(
      op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : op === "%" ? a % b : a ** b,
    );
  };
  for (const tok of tokenize(src)) {
    if (tok.t === "n") output.push(tok.v);
    else if (tok.v === "(") ops.push("(");
    else if (tok.v === ")") {
      while (ops.length && ops.at(-1) !== "(") apply();
      if (ops.pop() !== "(") throw new Error("Unbalanced parentheses");
    } else {
      while (
        ops.length &&
        ops.at(-1) !== "(" &&
        (PREC[ops.at(-1)!]! > PREC[tok.v]! || (PREC[ops.at(-1)!] === PREC[tok.v] && tok.v !== "^"))
      )
        apply();
      ops.push(tok.v);
    }
  }
  while (ops.length) {
    if (ops.at(-1) === "(") throw new Error("Unbalanced parentheses");
    apply();
  }
  if (output.length !== 1 || !Number.isFinite(output[0]!)) throw new Error("Invalid expression");
  return output[0]!;
}

export function calculatorApp(root: HTMLElement) {
  let expr = "";
  const display = h("output", { class: "calc-out", "aria-live": "polite" }, "0");
  const history = h("div", { class: "calc-hist muted" });
  const show = () => (display.textContent = expr || "0");
  const press = (k: string) => {
    if (k === "C") expr = "";
    else if (k === "⌫") expr = expr.slice(0, -1);
    else if (k === "=") {
      try {
        const r = evaluate(expr);
        history.textContent = `${expr} =`;
        expr = String(Math.round(r * 1e10) / 1e10);
      } catch (error) {
        history.textContent = (error as Error).message;
      }
    } else expr += k;
    show();
  };
  const keys = ["C", "(", ")", "⌫", "7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"];
  const pad = h(
    "div",
    { class: "calc-pad" },
    ...keys.map(k =>
      h("button", { class: `calc-key${/\D/.test(k) && k !== "." ? " op" : ""}`, onclick: () => press(k) }, k),
    ),
  );
  root.append(h("div", { class: "calc" }, history, display, pad));
  root.addEventListener("keydown", e => {
    const k = (e as KeyboardEvent).key;
    if (/^[\d.+\-*/()%^]$/.test(k)) press(k);
    else if (k === "Enter" || k === "=") press("=");
    else if (k === "Backspace") press("⌫");
    else if (k === "Escape") press("C");
    else return;
    e.preventDefault();
  });
  root.tabIndex = 0;
  root.focus();
}
