"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import type { OrganizationDTO } from "@rosegriffon/achillea-types";
import { OrganizationState } from "@rosegriffon/achillea-types/enums/organization";
import { Building2, ArrowLeft, ShieldAlert, Loader2, ChevronRight } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function OrganizationsPendingValidationPage() {
  const { user, isAuthenticated, isLoading: authLoading, login } = useAchilleaAuth();
  const [orgs, setOrgs] = useState<OrganizationDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([
    authLoading,
    isAuthenticated,
    user?.role,
  ]);
  if (
    [authLoading, isAuthenticated, user?.role].some((value, position) => !Object.is(value, requestIdentity1[position]))
  ) {
    setRequestIdentity1([authLoading, isAuthenticated, user?.role]);
    (() => {
      if (authLoading || !isAuthenticated || (user?.role ?? 0) < 2) return;
      setLoading(true);
      setLoadError(null);
    })();
  }
  useEffect(() => {
    if (authLoading || !isAuthenticated || (user?.role ?? 0) < 2) return;
    let cancelled = false;

    const client = createAchilleaClient({ credentials: "include" });

    client.organizations
      .list({ page: 1, pagination: 50, state: OrganizationState.Pending })
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setOrgs(res.value.data);
        } else {
          setLoadError("Impossible de charger la file de validation des organisations.");
          signalerException("organizations/validate", new Error(`${res.kind}: ${res.detail}`));
        }
      })
      .catch(cause => {
        if (cancelled) return;
        setLoadError("Impossible de charger la file de validation des organisations.");
        signalerException("organizations/validate", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.role]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea/admins/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au dashboard admin
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Building2 className="w-5 h-5" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">Organisations en Attente de Revue</h1>
        </div>
      </div>

      {authLoading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Vérification des droits…</p>
        </div>
      ) : !isAuthenticated ? (
        <div className="py-16 text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
          <p className="text-sm text-muted-foreground">Connectez-vous pour accéder à cette file de validation.</p>
          <button
            type="button"
            onClick={() => login("/achillea/organizations/validate")}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
          >
            Se connecter
          </button>
        </div>
      ) : (user?.role ?? 0) < 2 ? (
        <div className="py-16 text-center space-y-3">
          <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
          <p className="text-sm text-muted-foreground">Cette file est réservée aux administrateurs.</p>
        </div>
      ) : loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Chargement des organisations...</p>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="border border-destructive/30 bg-destructive/5 rounded-2xl p-8 text-center space-y-3"
        >
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm font-semibold text-primary underline underline-offset-4"
          >
            Réessayer
          </button>
        </div>
      ) : orgs.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center text-xs text-muted-foreground">
          Aucune organisation en attente de validation.
        </div>
      ) : (
        <div className="divide-y divide-border border border-border rounded-2xl bg-card overflow-hidden">
          {orgs.map(org => (
            <div key={org.id ?? org.name} className="p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-bold text-sm">{org.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{org.description}</div>
              </div>
              <Link
                href={`/achillea/admins/dashboard/organizations/validate/${org.id}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition"
              >
                Examiner
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
