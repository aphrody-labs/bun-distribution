// SPDX-License-Identifier: Apache-2.0
"use client";
import { M3Button, M3Toast } from "@aphrody/m3-baseui";
import { useState } from "react";

function Toasts() {
  const { toasts } = M3Toast.useToastManager();
  return toasts.map((toast) => (
    <M3Toast.Root key={toast.id} toast={toast}>
      <M3Toast.Content>
        <M3Toast.Title />
        <M3Toast.Description />
      </M3Toast.Content>
      <M3Toast.Close aria-label="Dismiss">×</M3Toast.Close>
    </M3Toast.Root>
  ));
}

function Trigger() {
  const manager = M3Toast.useToastManager();
  // The React Compiler memoises this component and its handler; there is no useCallback or useMemo.
  const [count, setCount] = useState(0);
  const notify = () => {
    setCount(count + 1);
    manager.add({ title: "Saved", description: `Toast number ${count + 1}` });
  };
  return (
    <M3Button variant="elevated" onClick={notify} data-testid="notify">
      Show a toast ({count})
    </M3Button>
  );
}

/** Client Component: a toast provider, its viewport and the button that adds a toast. */
export function Notifier() {
  return (
    <M3Toast.Provider>
      <Trigger />
      <M3Toast.Portal>
        <M3Toast.Viewport>
          <Toasts />
        </M3Toast.Viewport>
      </M3Toast.Portal>
    </M3Toast.Provider>
  );
}
