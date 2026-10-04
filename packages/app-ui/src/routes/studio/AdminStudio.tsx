// SPDX-License-Identifier: Apache-2.0
// Shenron administration: the complete admin dashboard opens in a native window that talks to the
// desktop's local models through `window.aphrodyNative` (crates/ui/app/src/studio.rs).
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { StudioHeader } from "./StudioHeader";
import { isTauri } from "../../tauri-bridge";
import { nativeAi, type NativeAiStatus } from "../../studio-bridge";
import { adminUrl } from "@shenron/config/admin";

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

  const open = async () => {
    setError(null);
    try {
      if (isTauri()) await nativeAi.openAdmin(url.trim() || undefined);
      else {
        const target = new URL(url.trim() || adminUrl());
        window.location.assign(
          adminUrl({ SHENRON_PUBLIC_SITE_URL: target.href }, target.pathname + target.search),
        );
      }
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
      <StudioHeader
        eyebrow="Aphrody · Shenron"
        title="Administration"
        subtitle="Bot, site, manga, transcriptions et accès"
      />
      <Card className="flex flex-col gap-4 p-6">
        {isTauri() && (
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
                {label} :{" "}
                {status
                  ? role?.ready
                    ? role.model
                    : "non chargé"
                  : error
                    ? "indisponible"
                    : "lecture en cours"}
              </span>
            ))}
            <Button className={buttonClass} variant="tonal" onClick={refresh}>
              Actualiser
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <input
            aria-label="URL de l’administration"
            className="min-h-12 flex-1 rounded-xl border border-outline bg-surface-container px-4 text-[18px]"
            placeholder={adminUrl()}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
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
