"use client";

import { Button, Card, CardContent } from "@rosegriffon/ui";
import { Check, Copy, ExternalLink, Settings } from "lucide-react";
import { useState } from "react";

interface Props {
  redirectUri: string;
  clientIdMasked: string | null;
}

export function PatreonOAuthConfig({ redirectUri, clientIdMasked }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
          <Settings className="size-4" />
          Configuration OAuth Patreon
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Cette URL doit être déclarée dans <strong>Redirect URIs</strong> du client OAuth Rose Griffon sur le portail
          Patreon. Sans elle, toute tentative de connexion renvoie{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">invalid_request</code>. Le link créateur ajoute les
          scopes campagne à la volée — pas de second redirect URI nécessaire.
        </p>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Redirect URI à déclarer
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all font-mono text-sm text-foreground">{redirectUri}</code>
              <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                    Copié
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copier
                  </>
                )}
              </Button>
            </div>
          </div>

          {clientIdMasked && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Client ID</div>
              <code className="font-mono text-sm text-foreground">{clientIdMasked}</code>
            </div>
          )}

          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a
              href="https://www.patreon.com/portal/registration/register-clients"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 size-4" />
              Ouvrir le portail Patreon Developer
            </a>
          </Button>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Comment configurer ?
          </summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Ouvrir le portail Patreon Developer (lien ci-dessus).</li>
            <li>Sélectionner le client OAuth de Rose Griffon (créateur du client).</li>
            <li>
              Coller l'URL ci-dessus dans le champ <strong>Redirect URIs</strong>.
            </li>
            <li>Sauvegarder. La modification est instantanée — relancer la connexion Patreon depuis l'app.</li>
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}
