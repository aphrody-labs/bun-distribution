// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { act } from "react";

import { FileThumb } from "../src/FileThumb";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("a controlled thumbnail reports load to its host", async () => {
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let loaded = false;

  try {
    await act(async () => {
      root.render(
        <FileThumb
          iconSrc="/icon.png"
          thumbnailSrc="/thumb.png"
          thumbnailLoaded={loaded}
          // happy-dom fires `error` for image URLs it cannot fetch (no base URL in tests), which
          // would unmount the uncontrolled thumbnail: the host controls the error state too.
          thumbnailError={false}
          onThumbnailLoad={() => {
            loaded = true;
          }}
        />,
      );
    });

    const image = host.querySelector('img[src="/thumb.png"]');
    expect(image).not.toBeNull();
    await act(async () => {
      image!.dispatchEvent(new Event("load"));
    });
    expect(loaded).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
