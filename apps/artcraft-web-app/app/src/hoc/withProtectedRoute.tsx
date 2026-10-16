import type { ComponentType } from "react";
import { useSignals, useSignalEffect } from "@preact/signals-react/runtime";
import { persistLogin } from "~/signals";

export const withProtectionRoute = <P extends object>(
  Component: ComponentType<P>,
) =>
  function ProtectionRoute(rest: P) {
    useSignals();
    useSignalEffect(() => {
      persistLogin();
    });
    return <Component {...rest} />;
  };
