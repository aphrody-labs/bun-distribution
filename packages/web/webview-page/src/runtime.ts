// SPDX-License-Identifier: Apache-2.0
// Page-side resolver. `pageRuntime` is serialised with Function.prototype.toString and evaluated in
// the page, so it must stay self-contained: no imports, no references to module scope.

export type Matcher = { source: string; flags: string } | { text: string; exact: boolean };

export type Step =
  | { css: string }
  | { testId: string; attribute: string }
  | { role: string; name?: Matcher; checked?: boolean }
  | { text: Matcher }
  | { label: Matcher }
  | { hasText: Matcher }
  | { nth: number };

export type Op =
  | { type: "count" }
  | { type: "text"; mode: "inner" | "content" }
  | { type: "attr"; name: string }
  | { type: "value" }
  | { type: "checked" }
  | { type: "enabled" }
  | { type: "visible" }
  | { type: "mark"; id: string }
  | { type: "unmark"; id: string }
  | { type: "focus" }
  | { type: "fill"; value: string }
  | { type: "select"; values: string[] }
  | { type: "tag" }
  | { type: "center" }
  | { type: "eval"; source: string; arg: unknown };

export function pageRuntime(steps: Step[], op: Op, doc: Document = document): unknown {
  const norm = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const test = (matcher: Matcher, value: string, ignoreCase = true) => {
    if ("source" in matcher) return new RegExp(matcher.source, matcher.flags).test(value);
    const left = norm(value);
    const right = norm(matcher.text);
    if (matcher.exact) return left === right;
    return ignoreCase ? left.toLowerCase().includes(right.toLowerCase()) : left.includes(right);
  };
  const view = doc.defaultView;
  const hidden = (el: Element) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return true;
      const style = view?.getComputedStyle?.(node);
      if (style && (style.display === "none" || style.visibility === "hidden")) return true;
    }
    return false;
  };
  const textOf = (el: Element) => norm(el.textContent);
  const labelsOf = (el: Element): string[] => {
    const out: string[] = [];
    const ids = el.getAttribute("aria-labelledby");
    if (ids) {
      out.push(
        ids
          .split(/\s+/)
          .map((id) => textOf(doc.getElementById(id) ?? el))
          .join(" "),
      );
    }
    const aria = el.getAttribute("aria-label");
    if (aria) out.push(norm(aria));
    const labels = (el as HTMLInputElement).labels;
    if (labels) for (const label of Array.from(labels)) out.push(textOf(label));
    if (el.id) {
      for (const label of Array.from(doc.querySelectorAll("label"))) {
        if (label.htmlFor === el.id && !out.includes(textOf(label))) out.push(textOf(label));
      }
    }
    const wrapping = el.closest("label");
    if (wrapping && !out.includes(textOf(wrapping))) out.push(textOf(wrapping));
    return out.filter(Boolean);
  };
  const nameOf = (el: Element): string => {
    const labelled = labelsOf(el);
    if (labelled.length) return labelled[0]!;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || (tag === "input" && (el as HTMLInputElement).type === "image")) {
      return norm(el.getAttribute("alt"));
    }
    if (tag === "input") {
      const type = (el as HTMLInputElement).type;
      if (["button", "submit", "reset"].includes(type)) {
        return norm((el as HTMLInputElement).value || type[0]!.toUpperCase() + type.slice(1));
      }
      return norm(el.getAttribute("placeholder") || el.getAttribute("title"));
    }
    if (["select", "textarea"].includes(tag)) return norm(el.getAttribute("title"));
    const fromContent = textOf(el);
    return fromContent || norm(el.getAttribute("title"));
  };
  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0]!.toLowerCase();
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a":
        return el.hasAttribute("href") ? "link" : null;
      case "button":
        return "button";
      case "select":
        return (el as HTMLSelectElement).multiple || Number(el.getAttribute("size")) > 1
          ? "listbox"
          : "combobox";
      case "textarea":
        return "textbox";
      case "input": {
        const type = (el as HTMLInputElement).type || "text";
        if (["button", "submit", "reset", "image"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        if (
          ["hidden", "file", "color", "date", "time", "datetime-local", "month", "week"].includes(
            type,
          )
        )
          return null;
        return "textbox";
      }
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "img":
        return el.getAttribute("alt") === "" ? "presentation" : "img";
      case "ul":
      case "ol":
        return "list";
      case "li":
        return "listitem";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "aside":
        return "complementary";
      case "header":
        return "banner";
      case "footer":
        return "contentinfo";
      case "table":
        return "table";
      case "tr":
        return "row";
      case "th":
        return "columnheader";
      case "td":
        return "cell";
      case "tbody":
      case "thead":
      case "tfoot":
        return "rowgroup";
      case "option":
        return "option";
      case "dialog":
        return "dialog";
      case "form":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "form" : null;
      case "section":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")
          ? "region"
          : null;
      case "output":
        return "status";
      case "progress":
        return "progressbar";
      case "article":
        return "article";
      default:
        return null;
    }
  };

  const within = (root: ParentNode, selector: string) =>
    Array.from(root.querySelectorAll(selector));
  const unique = (list: Element[]) => Array.from(new Set(list));
  const scopeAll = (root: ParentNode) => within(root, "*");

  let current: Element[] = [];
  let first = true;
  const roots = () => (first ? [doc as ParentNode] : (current as ParentNode[]));
  for (const step of steps) {
    if ("nth" in step) {
      const index = step.nth < 0 ? current.length + step.nth : step.nth;
      current = current[index] ? [current[index]!] : [];
      continue;
    }
    if ("hasText" in step) {
      const matcher = step.hasText;
      current = current.filter((el) => test(matcher, textOf(el)));
      continue;
    }
    let found: Element[] = [];
    for (const root of roots()) {
      if ("css" in step) {
        found = found.concat(within(root, step.css));
      } else if ("testId" in step) {
        found = found.concat(
          within(root, `[${step.attribute}="${step.testId.replace(/"/g, '\\"')}"]`),
        );
      } else if ("role" in step) {
        for (const el of scopeAll(root)) {
          if (roleOf(el) !== step.role.toLowerCase() || hidden(el)) continue;
          if (step.name && !test(step.name, nameOf(el))) continue;
          if (step.checked !== undefined && (el as HTMLInputElement).checked !== step.checked)
            continue;
          found.push(el);
        }
      } else if ("text" in step) {
        const matcher = step.text;
        const matching = scopeAll(root).filter(
          (el) =>
            !["script", "style", "head", "title", "meta"].includes(el.tagName.toLowerCase()) &&
            test(matcher, textOf(el), true),
        );
        // Smallest elements: drop those that contain another matching element.
        found = found.concat(
          matching.filter((el) => !matching.some((other) => other !== el && el.contains(other))),
        );
      } else if ("label" in step) {
        const matcher = step.label;
        for (const el of scopeAll(root)) {
          if (
            !["input", "select", "textarea", "button", "meter", "output", "progress"].includes(
              el.tagName.toLowerCase(),
            ) &&
            !el.hasAttribute("aria-label")
          ) {
            continue;
          }
          if (labelsOf(el).some((label) => test(matcher, label))) found.push(el);
        }
      }
    }
    current = unique(found);
    first = false;
  }
  if (first) current = [doc.documentElement];

  const el = current[0] as HTMLElement | undefined;
  switch (op.type) {
    case "count":
      return current.length;
    case "tag":
      return el ? el.tagName : null;
    case "center": {
      if (!el) return null;
      el.scrollIntoView?.({ block: "center", inline: "center" });
      const box = el.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    case "text":
      if (!el) return null;
      return op.mode === "inner" ? (el.innerText ?? el.textContent ?? "") : el.textContent;
    case "attr":
      return el ? el.getAttribute(op.name) : null;
    case "value":
      return el ? (el as HTMLInputElement).value : null;
    case "checked":
      return el ? Boolean((el as HTMLInputElement).checked) : null;
    case "enabled":
      return el
        ? !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true"
        : null;
    case "visible": {
      if (!el || hidden(el)) return false;
      const rects = el.getClientRects?.();
      return rects ? rects.length > 0 || el.offsetWidth > 0 || el.offsetHeight > 0 : true;
    }
    case "mark":
      if (!el) return false;
      el.setAttribute("data-wvp-target", op.id);
      return true;
    case "unmark":
      for (const marked of within(doc, `[data-wvp-target="${op.id}"]`)) {
        marked.removeAttribute("data-wvp-target");
      }
      return true;
    case "focus":
      if (!el) return false;
      el.focus();
      return true;
    case "fill": {
      if (!el) return false;
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      el.focus();
      if (setter) setter.call(el, op.value);
      else (el as HTMLInputElement).value = op.value;
      const EventCtor = view?.Event ?? Event;
      el.dispatchEvent(new EventCtor("input", { bubbles: true }));
      el.dispatchEvent(new EventCtor("change", { bubbles: true }));
      return true;
    }
    case "select": {
      if (!el) return false;
      const select = el as HTMLSelectElement;
      for (const option of Array.from(select.options)) {
        option.selected = op.values.includes(option.value) || op.values.includes(option.label);
      }
      const EventCtor = view?.Event ?? Event;
      select.dispatchEvent(new EventCtor("input", { bubbles: true }));
      select.dispatchEvent(new EventCtor("change", { bubbles: true }));
      return true;
    }
    case "eval": {
      if (!el) throw new Error("locator resolved to no element");
      // oxlint-disable-next-line no-eval -- the source is a function the caller serialised for this page
      const fn = (0, eval)(`(${op.source})`) as (element: Element, arg: unknown) => unknown;
      return fn(el, op.arg);
    }
  }
}
