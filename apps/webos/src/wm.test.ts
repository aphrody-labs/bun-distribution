// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WindowManager } from "./wm";

let desk: HTMLElement;
let wm: WindowManager;
beforeEach(() => {
  localStorage.removeItem("aph.layouts");
  desk = document.createElement("main");
  document.body.append(desk);
});
afterEach(() => {
  wm?.closeAll();
  desk.remove();
  localStorage.removeItem("aph.layouts");
});
const open = () =>
  wm.open({
    id: "files",
    title: "Files",
    icon: "folder",
    content: document.createElement("div"),
  });

describe("desktop window restoration", () => {
  test("restoring a dock window visits its workspace and focuses its accessible dialog", () => {
    wm = new WindowManager(desk);
    const window = open();
    wm.minimize(window);
    wm.goTo(2);
    wm.restore(window);
    expect(wm.workspace).toBe(1);
    expect(window.minimized).toBe(false);
    expect(window.el.hidden).toBe(false);
    expect(document.activeElement).toBe(window.el);
  });
  test("restoring a scratchpad window opens the scratchpad", () => {
    wm = new WindowManager(desk);
    const window = open();
    wm.sendToScratchpad(window);
    expect(window.el.hidden).toBe(true);
    wm.restore(window);
    expect(wm.scratchOpen).toBe(true);
    expect(window.el.hidden).toBe(false);
    window.setTitle("Project files");
    expect(window.el.getAttribute("aria-label")).toBe("Project files");
  });
  test("invalid persisted layouts cannot prevent the desktop from opening", () => {
    localStorage.setItem("aph.layouts", "null");
    wm = new WindowManager(desk);
    expect(wm.layout()).toBe("floating");
    localStorage.setItem(
      "aph.layouts",
      JSON.stringify({ 1: "unavailable", 2: "dwindle", 11: "scrolling" }),
    );
    wm = new WindowManager(desk);
    expect(wm.layout(1)).toBe("floating");
    expect(wm.layout(2)).toBe("dwindle");
    expect(wm.layout(11)).toBe("floating");
  });
});
