// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { toast } from "@aphrody/m3-primitives";
import { aphrodyRpc, ensureAphrodyInitialized } from "./tauri-bridge";
import { readSessionIdentity, type SessionIdentity as Identity } from "./session-identity";

/** Identity is read from the actual session broker; it never opens a second notification consumer. */
export function SessionIdentity() {
  const [identity, setIdentity] = useState<Identity>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function refresh(notify: boolean) {
    const current = ++generation.current;
    setPending(true);
    try {
      const value = await readSessionIdentity(ensureAphrodyInitialized, aphrodyRpc);
      if (current !== generation.current) return;
      setIdentity(value); setError("");
      if (notify) toast.success(value.authMode === "oss" ? "Local session verified." : value.authMode ? "Session verified." : "The service has no authenticated account.");
    } catch (failure) {
      if (current !== generation.current) return;
      setIdentity(undefined);
      const message = failure instanceof Error ? failure.message : "Session service unavailable.";
      setError(message);
      if (notify) toast.error(message);
    } finally { if (current === generation.current) setPending(false); }
  }
  useEffect(() => { void refresh(false); return () => { generation.current++; }; }, []);
  const label = pending ? "Checking session" : error ? "Service unavailable" : identity?.authMode === "oss" ? "Local session" : identity?.authMode ? "Authenticated session" : "No account";
  return <button type="button" disabled={pending} onClick={() => void refresh(true)} title={error ? `${error} Click to retry.` : "Identity reported by the Aphrody session service. Click to refresh."} className="flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-label-medium text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60" aria-label={`${label}. Refresh session status`}><span className="material-symbol text-[20px]" aria-hidden="true">{error ? "cloud_off" : "account_circle"}</span><span className="hidden lg:inline">{label}</span></button>;
}
