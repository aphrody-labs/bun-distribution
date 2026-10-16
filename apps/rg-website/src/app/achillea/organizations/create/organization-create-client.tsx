"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { absoluteUrl } from "@/lib/site-url";
import { normalizeNames } from "@rosegriffon/achillea-core/names";
import { SocialMedia, type SocialMediaDTO } from "@rosegriffon/achillea-types/domain/common";
import {
  Building2,
  ArrowLeft,
  ShieldAlert,
  Loader2,
  Check,
  Globe,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Radio,
  Share2,
  AlertCircle,
} from "lucide-react";

const COUNTRY_OPTIONS = [
  { code: "FR", name: "France (FR)" },
  { code: "GB", name: "Royaume-Uni (GB)" },
  { code: "US", name: "États-Unis (US)" },
  { code: "JP", name: "Japon (JP)" },
  { code: "DE", name: "Allemagne (DE)" },
  { code: "IT", name: "Italie (IT)" },
  { code: "ES", name: "Espagne (ES)" },
  { code: "PT", name: "Portugal (PT)" },
  { code: "BE", name: "Belgique (BE)" },
  { code: "CH", name: "Suisse (CH)" },
  { code: "CA", name: "Canada (CA)" },
];

export default function OrganizationCreationPage() {
  const router = useRouter();
  const { isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();

  const [name, setName] = useState<string>("");
  const [normalizedName, setNormalizedName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [logo, setLogo] = useState<string>("");
  const [origin, setOrigin] = useState<string>("FR");

  // Social & Broadcast Medias
  const [twitter, setTwitter] = useState<string>("");
  const [instagram, setInstagram] = useState<string>("");
  const [tiktok, setTiktok] = useState<string>("");
  const [twitch, setTwitch] = useState<string>("");
  const [youtube, setYoutube] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (val: string) => {
    setName(val);
    setNormalizedName(normalizeNames(val.trim()));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ([...name.trim()].length < 3 || [...name.trim()].length > 30) {
      setError("Le nom de l'organisation doit comporter entre 3 et 30 caractères.");
      return;
    }
    if (!normalizedName || normalizedName !== normalizeNames(name.trim())) {
      setError("L'identifiant normalisé ne correspond pas au nom de l'organisation.");
      return;
    }

    setError(null);
    setSubmitting(true);
    const client = createAchilleaClient({ credentials: "include" });

    const socialMedias: SocialMediaDTO[] = [];
    if (twitter.trim()) {
      const handle = twitter.trim().replace(/^@/, "");
      socialMedias.push({
        platform: SocialMedia.X,
        username: handle,
        canonicalUrl: `https://x.com/${handle}`,
      });
    }
    if (instagram.trim()) {
      const handle = instagram.trim().replace(/^@/, "");
      socialMedias.push({
        platform: SocialMedia.Instagram,
        username: handle,
        canonicalUrl: `https://instagram.com/${handle}`,
      });
    }
    if (tiktok.trim()) {
      const handle = tiktok.trim().replace(/^@/, "");
      socialMedias.push({
        platform: SocialMedia.TikTok,
        username: handle,
        canonicalUrl: `https://tiktok.com/@${handle}`,
      });
    }

    const broadcastMedias: SocialMediaDTO[] = [];
    if (twitch.trim()) {
      const handle = twitch.trim().replace(/^@/, "");
      broadcastMedias.push({
        platform: SocialMedia.Twitch,
        username: handle,
        canonicalUrl: `https://twitch.tv/${handle}`,
      });
    }
    if (youtube.trim()) {
      const handle = youtube.trim();
      broadcastMedias.push({
        platform: SocialMedia.Youtube,
        username: handle,
        canonicalUrl: handle.startsWith("http") ? handle : `https://youtube.com/@${handle.replace(/^@/, "")}`,
      });
    }

    try {
      const res = await client.organizations.create({
        name: name.trim(),
        normalizedName: normalizedName.trim(),
        description: description.trim() || "Organisation esport officielle Achilléa.",
        logo: logo.trim() || absoluteUrl("/achillea/achillea.png"),
        origin: origin,
        orgManagers: [],
        socialMedias,
        broadcastMedias,
      });

      if (res.ok) {
        router.push("/achillea/tournaments");
      } else {
        setError(res.detail || "Impossible de soumettre la demande d'organisation.");
      }
    } catch {
      setError("Une erreur inattendue est survenue lors de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p>Vérification de la session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">Connexion requise</h2>
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour enregistrer votre structure officielle sur Achilléa.
        </p>
        <button
          type="button"
          onClick={() => login()}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au hub Achilléa
        </Link>
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Building2 className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Déclarer une Organisation</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Enregistrez votre structure pour organiser des tournois officiels et engager des équipes en championnat.
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="border border-border bg-card rounded-2xl p-6 md:p-8 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-5">
          {/* Nom de la structure */}
          <div className="space-y-1.5">
            <label
              htmlFor="route-create-organization-create-client-tsx-1"
              className="text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <Building2 className="w-3.5 h-3.5 text-primary" />
              Nom de la structure *
            </label>
            <input
              id="route-create-organization-create-client-tsx-1"
              type="text"
              placeholder="Ex: Solary, Vitality, Chrono Storm..."
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          {/* Identifiant normalisé */}
          <div className="space-y-1.5">
            <label
              htmlFor="route-create-organization-create-client-tsx-2"
              className="text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Identifiant unique
            </label>
            <p className="text-xs text-muted-foreground">Généré selon le nom de la structure.</p>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">ACHILLÉA</span>
              <input
                id="route-create-organization-create-client-tsx-2"
                type="text"
                value={normalizedName}
                onChange={e => setNormalizedName(e.target.value)}
                className="flex-1 px-3 py-2 text-xs font-mono bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              htmlFor="route-create-organization-create-client-tsx-3"
              className="text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5 text-primary" />
              Description & Présentation
            </label>
            <textarea
              id="route-create-organization-create-client-tsx-3"
              rows={3}
              placeholder="Présentez brièvement la structure, son palmarès et ses ambitions sur Inazuma Eleven..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Logo & Live Preview */}
          <div className="space-y-1.5">
            <label
              htmlFor="route-create-organization-create-client-tsx-4"
              className="text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <ImageIcon className="w-3.5 h-3.5 text-primary" />
              URL du Logo officiel (PNG transparent ou WebP)
            </label>
            <div className="flex items-center gap-3">
              {logo ? (
                <img
                  src={logo}
                  alt="Aperçu logo structure"
                  className="w-12 h-12 rounded-xl object-cover bg-muted border border-border shrink-0 shadow-sm"
                  onError={e => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs shrink-0 font-bold">
                  ORG
                </div>
              )}
              <input
                id="route-create-organization-create-client-tsx-4"
                type="url"
                placeholder="https://.../logo.png"
                value={logo}
                onChange={e => setLogo(e.target.value)}
                className="flex-1 px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Pays d'origine */}
          <div className="space-y-1.5">
            <label
              htmlFor="route-create-organization-create-client-tsx-5"
              className="text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5 text-primary" />
              Pays d'origine
            </label>
            <select
              id="route-create-organization-create-client-tsx-5"
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {COUNTRY_OPTIONS.map(c => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Réseaux sociaux & Diffusion */}
          <div className="p-4 rounded-xl bg-background border border-border space-y-4">
            <div className="text-xs font-bold text-foreground flex items-center gap-2">
              <Share2 className="w-4 h-4 text-primary" />
              Réseaux Sociaux & Canaux Officiels
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label htmlFor="route-create-organization-create-client-tsx-6" className="text-muted-foreground">
                  Compte X (Twitter)
                </label>
                <input
                  id="route-create-organization-create-client-tsx-6"
                  type="text"
                  placeholder="@Structure"
                  value={twitter}
                  onChange={e => setTwitter(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="route-create-organization-create-client-tsx-7" className="text-muted-foreground">
                  Compte Instagram
                </label>
                <input
                  id="route-create-organization-create-client-tsx-7"
                  type="text"
                  placeholder="@structure_esport"
                  value={instagram}
                  onChange={e => setInstagram(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="route-create-organization-create-client-tsx-8" className="text-muted-foreground">
                  Compte TikTok
                </label>
                <input
                  id="route-create-organization-create-client-tsx-8"
                  type="text"
                  placeholder="@structure"
                  value={tiktok}
                  onChange={e => setTiktok(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="route-create-organization-create-client-tsx-9"
                  className="text-muted-foreground flex items-center gap-1"
                >
                  <Radio className="w-3 h-3 text-purple-400" />
                  Chaîne Twitch (Diffusion)
                </label>
                <input
                  id="route-create-organization-create-client-tsx-9"
                  type="text"
                  placeholder="structure_tv"
                  value={twitch}
                  onChange={e => setTwitch(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="route-create-organization-create-client-tsx-10" className="text-muted-foreground">
                  Chaîne YouTube
                </label>
                <input
                  id="route-create-organization-create-client-tsx-10"
                  type="text"
                  placeholder="@StructureEsport ou URL complète"
                  value={youtube}
                  onChange={e => setYoutube(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
          <Link
            href="/achillea/tournaments"
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted transition"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Déposer la demande officielle
          </button>
        </div>
      </form>
    </div>
  );
}
