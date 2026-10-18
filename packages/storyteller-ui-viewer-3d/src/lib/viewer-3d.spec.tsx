import { describe, it, expect, afterEach } from "bun:test";
import { stubGlobal, restoreGlobals } from "../../../artcraft-frontend/tools/testing/globals";
import { render } from "@testing-library/react";

import StorytellerUiViewer3d from "./viewer-3d";

// jsdom has no ResizeObserver; the viewer only needs it to exist.
stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

describe("StorytellerUiViewer3d", () => {
  it("should render successfully", () => {
    const { baseElement } = render(<StorytellerUiViewer3d />);
    expect(baseElement).toBeTruthy();
  });

  it("unmounts cleanly before the scene ever initialized", () => {
    const { unmount } = render(<StorytellerUiViewer3d />);
    expect(() => unmount()).not.toThrow();
  });
});

afterEach(restoreGlobals);
