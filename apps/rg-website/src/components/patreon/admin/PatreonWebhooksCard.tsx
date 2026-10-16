"use client";

import { Button, Card, CardContent } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, Loader2, Webhook } from "lucide-react";
import { useEffect, useState } from "react";

interface WebhookRow {
  id: string;
  uri?: string;
  triggers?: string[];
  paused?: boolean;
  last_attempted_at?: string | null;
  num_consecutive_times_failed?: number;
}

export function PatreonWebhooksCard() {
  const [loading, setLoading] = useState(true);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/patreon/webhooks");
      const json = (await res.json()) as {
        ok?: boolean;
        webhooks?: WebhookRow[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setWebhooks(json.webhooks ?? []);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Webhook className="size-4" />
            Webhooks Patreon
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              setError(null);
              void load();
            }}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Rafraîchir"}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {loading && webhooks.length === 0 && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Chargement…
          </div>
        )}

        {!loading && webhooks.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            Aucun webhook configuré sur ce compte créateur. Créer un webhook depuis le portail Patreon avec l'URL :{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/auth/patreon/webhook</code>
          </p>
        )}

        {webhooks.length > 0 && (
          <div className="space-y-3">
            {webhooks.map(w => {
              const failing = (w.num_consecutive_times_failed ?? 0) > 0;
              return (
                <div
                  key={w.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {w.paused ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="size-3" />
                          En pause
                        </span>
                      ) : failing ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                          <AlertTriangle className="size-3" />
                          {w.num_consecutive_times_failed} échecs consécutifs
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="size-3" />
                          Actif
                        </span>
                      )}
                      <code className="truncate text-xs text-muted-foreground">id:{w.id}</code>
                    </div>
                    <p className="break-all font-mono text-sm text-foreground">{w.uri ?? "—"}</p>
                    {w.triggers && w.triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {w.triggers.map(t => (
                          <span
                            key={t}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {w.last_attempted_at && (
                      <p className="text-xs text-muted-foreground/70">
                        Dernier appel :{" "}
                        {format(new Date(w.last_attempted_at), "d MMM yyyy 'à' HH:mm", {
                          locale: fr,
                        })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
