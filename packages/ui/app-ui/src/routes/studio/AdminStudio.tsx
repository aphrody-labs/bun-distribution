// SPDX-License-Identifier: Apache-2.0
// Shenron administration: the complete admin dashboard opens in a native window that talks to the
// desktop's local models through `window.aphrodyNative` (crates/ui/app/src/studio.rs).
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { PageHeader } from "@shenron/ui/layout/PageHeader";
import { isTauri } from "../../tauri-bridge";
import { nativeAi, type NativeAiStatus } from "../../studio-bridge";

const buttonClass = "min-h-12 px-5 text-[18px]";

export function AdminStudio() {
  const [status, setStatus] = useState<NativeAiStatus | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    nativeAi.status().then(setStatus, (cause: unknown) => setError(String(cause)));
  }, []);

  useEffect(() => {
    if (isTauri()) refresh();
  }, [refresh]);

  if (!isTauri()) {
    return <p className="text-[18px] text-on-surface-variant">L’administration nécessite l’application Aphrody.</p>;
  }

  const open = async () => {
    setError(null);
    try {
      await nativeAi.openAdmin(url.trim() || undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const roles: Array<[string, NativeAiStatus["chat"] | undefined]> = [
    ["Chat", status?.chat],
    ["Embeddings", status?.embed],
    ["Rerank", status?.rerank],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Shenron" title="Administration" subtitle="Dashboard complet, IA locale en accès direct" />
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap gap-3">
          {roles.map(([label, role]) => (
            <span
              key={label}
              className={
                role?.ready
                  ? "rounded-full bg-primary-container px-3 py-1 text-[16px] text-on-primary-container"
                  : "rounded-full bg-surface-container px-3 py-1 text-[16px] text-on-surface-variant"
              }
            >
              {label} : {role?.ready ? role.model : "non chargé"}
            </span>
          ))}
          <Button className={buttonClass} variant="tonal" onClick={refresh}>
            Actualiser
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            aria-label="URL de l’administration"
            className="min-h-12 flex-1 rounded-xl border border-outline bg-surface-container px-4 text-[18px]"
            placeholder="https://dragonballfr.com/admin (ou SHENRON_ADMIN_URL, ex. http://localhost:3000/admin)"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button className={buttonClass} onClick={() => void open()}>
            Ouvrir l’administration
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-[18px] text-error">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
