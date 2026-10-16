"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@rosegriffon/ui";
import { AlertCircle, Home, RefreshCcw } from "lucide-react";
import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Admin Global Error:", error);
  }, [error]);

  return (
    <div className="container max-w-4xl py-20 space-y-8">
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <div className="rounded-full bg-destructive/10 p-4">
          <AlertCircle className="size-12 text-destructive" />
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Une erreur inattendue est survenue</h2>
        <p className="text-muted-foreground max-w-lg text-lg">
          Le panneau d'administration a rencontré un problème critique.
        </p>
      </div>

      {/* La pile d'exécution divulguait les chemins absolus du VPS et les noms
			    de modules internes à l'administrateur — et poussait les boutons sous
			    la ligne de flottaison. On ne montre que le digest en production ;
			    la pile reste dans les journaux serveur via le console.error ci-dessus. */}
      <Alert variant="destructive" className="mx-auto max-w-2xl">
        <AlertCircle className="size-4" />
        <AlertTitle>Détails techniques</AlertTitle>
        <AlertDescription className="mt-2 max-h-64 overflow-auto rounded border border-destructive/20 bg-destructive/5 p-4 font-mono text-xs">
          {error.message || "Erreur inconnue"}
          {error.digest && (
            <div className="mt-2 border-t border-destructive/20 pt-2 opacity-70">Digest : {error.digest}</div>
          )}
          {process.env.NODE_ENV !== "production" && error.stack && (
            <div className="mt-2 border-t border-destructive/20 pt-2 whitespace-pre-wrap opacity-70">{error.stack}</div>
          )}
        </AlertDescription>
      </Alert>

      <div className="flex justify-center gap-4">
        <Button onClick={() => (window.location.href = "/admin")} variant="outline" size="lg">
          <Home className="mr-2 size-4" />
          Tableau de bord
        </Button>
        <Button onClick={() => reset()} variant="default" size="lg" className="bg-red-600 hover:bg-red-700 text-white">
          <RefreshCcw className="mr-2 size-4" />
          Réessayer
        </Button>
      </div>
    </div>
  );
}
