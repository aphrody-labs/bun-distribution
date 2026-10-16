"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAchilleaClient, useAchilleaAuth } from "@/lib/achillea";
import { absoluteUrl } from "@/lib/site-url";
import type { Country } from "@rosegriffon/achillea-types/domain/common";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import { ArrowLeft, Shield, AlertCircle } from "lucide-react";

export default function CreateClanPage() {
  const router = useRouter();
  const { isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();

  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [biography, setBiography] = useState("");
  const [founderIds, setFounderIds] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      login("/achillea/clans/create");
      return;
    }

    if (name.trim().length < 3 || name.trim().length > 30) {
      setError("Le nom du clan doit comporter entre 3 et 30 caractères.");
      return;
    }
    if (!/^[A-Z0-9]{2,3}$/i.test(tag.trim())) {
      setError("Le sigle (tag) doit comporter 2 ou 3 lettres ou chiffres.");
      return;
    }
    if (![xUrl, instagramUrl, tiktokUrl].some(url => url.trim())) {
      setError("Ajoute au moins un lien X, Instagram ou TikTok pour le clan.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const client = createAchilleaClient({ credentials: "include" });
      const founders = founderIds
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(id => ({ id }));
      const clanName = name.trim();
      const clanTag = tag.trim().toUpperCase();
      const paysFrance: Country = {
        code: "fr",
        language: "Français",
        name: "France",
        flag: "flags/flag_fr.svg",
      };

      const res = await client.clans.create({
        founders,
        logo: absoluteUrl("/achillea/achillea.png"),
        name: clanName,
        normalizedName: clanName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        shortName: clanTag,
        normalizedShortName: clanTag,
        description: biography.trim() || `Clan ${clanName} sur la scène compétitive Achilléa.`,
        ...(xUrl.trim() ? { twitter: xUrl.trim() } : {}),
        ...(instagramUrl.trim() ? { instagram: instagramUrl.trim() } : {}),
        ...(tiktokUrl.trim() ? { tiktok: tiktokUrl.trim() } : {}),
        origin: paysFrance,
        languages: [paysFrance],
      });

      if (res.ok) {
        if (res.value.clanId) {
          router.push(`/achillea/clans/${res.value.clanId}`);
        } else {
          router.push("/achillea/clans");
        }
      } else {
        setError(res.detail || "Impossible de créer le clan.");
      }
    } catch {
      setError("Une erreur inattendue est survenue.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center text-sm text-on-surface-variant">
        Vérification de la session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-20 text-center">
        <Shield className="mx-auto size-12 text-primary" />
        <h2 className="text-xl font-bold text-on-surface">Connexion requise</h2>
        <p className="text-sm text-on-surface-variant">Connecte-toi pour déposer une demande de création de clan.</p>
        <Button type="button" onClick={() => login("/achillea/clans/create")}>
          Se connecter
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-1.5 -ml-2 text-on-surface-variant">
        <Link href="/achillea/clans">
          <ArrowLeft className="size-4" />
          Tous les clans
        </Link>
      </Button>

      <Card className="rounded-3xl border-outline/20 shadow-xl overflow-hidden">
        <CardHeader className="space-y-1 bg-surface-variant/20 p-6 sm:p-8 border-b border-outline/10">
          <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold mb-2">
            <Shield className="size-6" />
          </div>
          <CardTitle className="text-2xl font-black">Fonder un clan officiel</CardTitle>
          <CardDescription className="text-sm text-on-surface-variant">
            Remplis les informations fondamentales de ton équipe compétitive.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 sm:p-8">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 text-sm flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label
                htmlFor="route-create-clan-create-client-tsx-1"
                className="text-xs font-bold text-on-surface uppercase tracking-wider"
              >
                Nom du clan <span className="text-red-500">*</span>
              </label>
              <input
                id="route-create-clan-create-client-tsx-1"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="ex. Raimon Eleven"
                className="w-full px-3.5 py-2.5 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
              <p className="text-[11px] text-on-surface-variant">Entre 3 et 30 caractères.</p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="route-create-clan-create-client-tsx-2"
                className="text-xs font-bold text-on-surface uppercase tracking-wider"
              >
                Sigle / Tag court <span className="text-red-500">*</span>
              </label>
              <input
                id="route-create-clan-create-client-tsx-2"
                type="text"
                required
                maxLength={3}
                value={tag}
                onChange={e => setTag(e.target.value.toUpperCase())}
                placeholder="ex. RG"
                className="w-full max-w-xs px-3.5 py-2.5 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface uppercase font-mono font-bold focus:outline-none focus:border-primary"
              />
              <p className="text-[11px] text-on-surface-variant">
                2 ou 3 lettres majuscules ou chiffres (ex. RG, INA).
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="route-create-clan-create-client-tsx-3"
                className="text-xs font-bold text-on-surface uppercase tracking-wider"
              >
                Biographie & Présentation
              </label>
              <textarea
                id="route-create-clan-create-client-tsx-3"
                rows={4}
                value={biography}
                onChange={e => setBiography(e.target.value)}
                placeholder="Présentation du clan, ambitions esport, critères de sélection..."
                className="w-full p-3 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="route-create-clan-create-client-tsx-4"
                className="text-xs font-bold text-on-surface uppercase tracking-wider"
              >
                Identifiants des co-fondateurs (Discord IDs)
              </label>
              <input
                id="route-create-clan-create-client-tsx-4"
                type="text"
                value={founderIds}
                onChange={e => setFounderIds(e.target.value)}
                placeholder="ID1, ID2, ID3..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
              <p className="text-[11px] text-on-surface-variant">
                Optionnel : sépare les IDs Discord par des virgules pour lancer le vote de fondation.
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-xs font-bold text-on-surface uppercase tracking-wider">
                Réseaux sociaux <span className="text-red-500">*</span>
              </legend>
              <p className="text-[11px] text-on-surface-variant">Ajoute au moins un lien X, Instagram ou TikTok.</p>
              <input
                type="url"
                value={xUrl}
                onChange={e => setXUrl(e.target.value)}
                placeholder="https://x.com/mon-clan"
                aria-label="Lien X du clan"
                className="w-full px-3.5 py-2.5 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
              <input
                type="url"
                value={instagramUrl}
                onChange={e => setInstagramUrl(e.target.value)}
                placeholder="https://instagram.com/mon-clan"
                aria-label="Lien Instagram du clan"
                className="w-full px-3.5 py-2.5 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
              <input
                type="url"
                value={tiktokUrl}
                onChange={e => setTiktokUrl(e.target.value)}
                placeholder="https://tiktok.com/@mon-clan"
                aria-label="Lien TikTok du clan"
                className="w-full px-3.5 py-2.5 rounded-xl border border-outline/30 bg-surface-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </fieldset>

            <div className="pt-4 flex justify-end gap-3">
              <Button asChild variant="outline">
                <Link href="/achillea/clans">Annuler</Link>
              </Button>
              <Button type="submit" disabled={submitting} className="font-bold">
                {submitting ? "Création en cours..." : "Valider et créer le clan"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
