"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ExternalLink,
  Loader2,
  Save,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import type { JSONContent } from "@tiptap/react";

import { ShenronEditor } from "@/components/editor";
import { PlainField } from "../../../components/editor/PlainField";
import { Badge } from "@shenron/ui/badge";
import { Button } from "@shenron/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shenron/ui/card";
import { Input } from "@shenron/ui/input";
import { Label } from "@shenron/ui/label";
import { Switch } from "@shenron/ui/switch";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import { slugify } from "@/lib/slug";
import { cn } from "@shenron/ui/lib/utils";
import type { PostContentDoc, PostStatus } from "@shenron/db/schema";
import { checkSlug, deletePost, savePost, type PostInput } from "./_actions";

/** Longueurs au-delà desquelles Google tronque en général l'affichage. */
const SEO_TITLE_LIMIT = 60;
const SEO_DESC_LIMIT = 155;

export type ArticleDraft = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  doc: PostContentDoc | null;
  cover: string | null;
  coverAlt: string | null;
  coverCaption: string | null;
  tags: string[];
  status: PostStatus;
  publishedAt: string | null; // ISO
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  canonicalUrl: string | null;
  noindex: boolean;
};

/** `Date` → valeur d'un `<input type="datetime-local">`, en heure locale. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ArticleEditor({ initial, siteUrl }: { initial: ArticleDraft; siteUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<ArticleDraft>(initial);
  const [dateInput, setDateInput] = useState(() => toLocalInput(initial.publishedAt));
  // L'admin a-t-il repris la main sur le slug ? Tant que non, il suit le titre.
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.slug));
  const [slugState, setSlugState] = useState<"idle" | "checking" | "free" | "taken">("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);

  const set = useCallback(<K extends keyof ArticleDraft>(key: K, value: ArticleDraft[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
    setDirty(true);
  }, []);

  // --- Slug ---------------------------------------------------------------
  const effectiveSlug = slugTouched ? draft.slug : slugify(draft.title);

  useEffect(() => {
    if (!effectiveSlug) {
      setSlugState("idle");
      return;
    }
    setSlugState("checking");
    // Anti-rebond : on ne sollicite le serveur qu'une fois la frappe stabilisée.
    const t = setTimeout(async () => {
      try {
        const res = await checkSlug(effectiveSlug, draft.id);
        setSlugState(res.available ? "free" : "taken");
      } catch {
        setSlugState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [effectiveSlug, draft.id]);

  // --- Garde-fou anti perte de saisie -------------------------------------
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const onDocChange = useCallback((doc: PostContentDoc) => {
    setDraft(d => ({ ...d, doc }));
    setDirty(true);
  }, []);

  // --- Enregistrement ------------------------------------------------------
  const submit = useCallback(
    (status: PostStatus) => {
      setError(null);
      const payload: PostInput = {
        id: draft.id,
        title: draft.title,
        slug: effectiveSlug,
        excerpt: draft.excerpt,
        doc: draft.doc as Record<string, unknown> | null,
        cover: draft.cover ?? undefined,
        coverAlt: draft.coverAlt ?? undefined,
        coverCaption: draft.coverCaption ?? undefined,
        tags: draft.tags,
        status,
        publishedAt: dateInput ? new Date(dateInput).toISOString() : undefined,
        featured: draft.featured,
        seoTitle: draft.seoTitle ?? undefined,
        seoDescription: draft.seoDescription ?? undefined,
        ogImage: draft.ogImage ?? undefined,
        canonicalUrl: draft.canonicalUrl ?? undefined,
        noindex: draft.noindex,
      };

      startTransition(async () => {
        const res = await savePost(payload);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDirty(false);
        setSavedAt(new Date());
        setDraft(d => ({ ...d, id: res.id, slug: res.slug, status }));
        setSlugTouched(true);
        // Création : on bascule sur l'URL d'édition pour que le rechargement
        // ou un partage de lien retombe sur le bon article.
        if (!draft.id) router.replace(`/admin/posts/${res.id}`);
        else router.refresh();
      });
    },
    [draft, dateInput, effectiveSlug, router],
  );

  // Cmd/Ctrl+S — réflexe de rédaction.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        submit(draft.status);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, draft.status]);

  const seoTitlePreview = draft.seoTitle?.trim() || draft.title || "Titre de l'article";
  const seoDescPreview = draft.seoDescription?.trim() || draft.excerpt?.trim() || "Résumé de l'article…";

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      {/* ---- Barre d'action ------------------------------------------------ */}
      <div className="sticky top-0 z-30 -mx-4 mb-6 flex flex-wrap items-center gap-3 border-b border-white/10 bg-dbz-bg/95 px-4 py-3 backdrop-blur md:-mx-10 md:px-10">
        <Link
          href="/admin/posts"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Articles
        </Link>

        <StatusBadge status={draft.status} publishedAt={dateInput} />

        {dirty && <span className="text-[12px] text-amber-300">Modifications non enregistrées</span>}
        {!dirty && savedAt && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-300">
            <Check className="size-3.5" />
            Enregistré à {savedAt.toLocaleTimeString("fr-FR", { timeStyle: "short" })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {draft.id && draft.status === "published" && (
            <a
              href={`/news/${draft.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ExternalLink className="size-4" />
              Voir en ligne
            </a>
          )}
          <Button variant="outline" size="lg" disabled={pending} onClick={() => submit("draft")}>
            Enregistrer le brouillon
          </Button>
          <Button
            size="lg"
            disabled={pending || slugState === "taken"}
            onClick={() => submit(dateInput && new Date(dateInput) > new Date() ? "scheduled" : "published")}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {dateInput && new Date(dateInput) > new Date() ? "Programmer" : "Publier"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[14px] text-red-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---- Colonne principale ---------------------------------------- */}
        <div className="min-w-0 space-y-4">
          <div>
            <Label htmlFor="title" className="sr-only">
              Titre de l&apos;article
            </Label>
            <input
              id="title"
              value={draft.title}
              onChange={e => {
                set("title", e.target.value);
                if (!slugTouched) setDraft(d => ({ ...d, slug: slugify(e.target.value) }));
              }}
              placeholder="Titre de l'article"
              className="w-full border-0 bg-transparent px-1 text-[32px] font-bold leading-tight tracking-tight text-white outline-none placeholder:text-white/25"
            />
          </div>

          <SlugField
            value={effectiveSlug}
            state={slugState}
            siteUrl={siteUrl}
            onChange={v => {
              setSlugTouched(true);
              set("slug", v);
            }}
          />

          <ShenronEditor
            format="doc"
            preset="article"
            // `PostContentDoc` est typé large côté base (jsonb) ; la validité réelle
            // du document est vérifiée par ProseMirror au montage.
            value={initial.doc as JSONContent | null}
            onChangeDoc={doc => onDocChange(doc as PostContentDoc)}
            uploadSubdir="articles"
            autosaveKey={`post:${initial.id ?? "nouveau"}`}
            autosaveLabel={draft.title || "Article sans titre"}
            onSave={() => submit(draft.status)}
            maxHeight="70vh"
            ariaLabel="Corps de l'article"
            placeholder="Racontez l'histoire… tapez « / » pour insérer un bloc, glissez une image directement dans le texte."
          />
        </div>

        {/* ---- Colonne latérale ------------------------------------------ */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <CalendarClock className="size-4 text-white/50" />
                Publication
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="publishedAt">Date de parution</Label>
                <Input
                  id="publishedAt"
                  type="datetime-local"
                  value={dateInput}
                  onChange={e => {
                    setDateInput(e.target.value);
                    setDirty(true);
                  }}
                />
                <p className="text-[12px] text-white/50">
                  Une date future programme l&apos;article : il sortira tout seul le moment venu.
                </p>
              </div>

              <ToggleRow
                icon={<Star className="size-4" />}
                label="Article à la une"
                hint="Affiché en tête du journal, en grand format."
                checked={draft.featured}
                onChange={v => set("featured", v)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Image de couverture</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ImageField
                value={draft.cover ?? ""}
                onChange={cover => set("cover", cover || null)}
                subdir="articles"
                column="couverture"
              />
              <div className="space-y-1.5">
                <Label htmlFor="coverAlt">Texte alternatif</Label>
                <Input
                  id="coverAlt"
                  value={draft.coverAlt ?? ""}
                  onChange={e => set("coverAlt", e.target.value)}
                  placeholder="Ce que montre l'image"
                />
                <p className="text-[12px] text-white/50">
                  Lu par les lecteurs d&apos;écran et indexé par Google Images.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coverCaption">Légende</Label>
                <Input
                  id="coverCaption"
                  value={draft.coverCaption ?? ""}
                  onChange={e => set("coverCaption", e.target.value)}
                  placeholder="Crédit ou contexte (optionnel)"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Résumé & thèmes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="excerpt">Chapô</Label>
                  <Counter value={draft.excerpt.length} limit={320} />
                </div>
                <PlainField
                  id="excerpt"
                  minRows={4}
                  maxRows={10}
                  value={draft.excerpt}
                  onChange={v => set("excerpt", v)}
                  placeholder="Le paragraphe d'accroche affiché dans les listes et sous le titre."
                />
                <p className="text-[12px] text-white/50">
                  Laissé vide, il est généré depuis le début de l&apos;article.
                </p>
              </div>
              <TagInput tags={draft.tags} onChange={t => set("tags", t)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Référencement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Aperçu du résultat de recherche — l'admin voit ce que Google affichera. */}
              <div className="rounded-lg border border-white/10 bg-white p-3">
                <p className="truncate text-[12px] text-[#4d5156]">
                  {siteUrl.replace(/^https?:\/\//, "")} › actualites › {effectiveSlug || "…"}
                </p>
                <p className="truncate text-[16px] leading-snug text-[#1a0dab]">{seoTitlePreview}</p>
                <p className="line-clamp-2 text-[13px] leading-snug text-[#4d5156]">{seoDescPreview}</p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="seoTitle">Titre SEO</Label>
                  <Counter value={(draft.seoTitle ?? draft.title).length} limit={SEO_TITLE_LIMIT} />
                </div>
                <Input
                  id="seoTitle"
                  value={draft.seoTitle ?? ""}
                  onChange={e => set("seoTitle", e.target.value)}
                  placeholder={draft.title || "Reprend le titre de l'article"}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="seoDescription">Méta description</Label>
                  <Counter value={(draft.seoDescription ?? draft.excerpt).length} limit={SEO_DESC_LIMIT} />
                </div>
                <PlainField
                  id="seoDescription"
                  minRows={3}
                  maxRows={8}
                  value={draft.seoDescription ?? ""}
                  onChange={v => set("seoDescription", v)}
                  placeholder="Reprend le chapô si laissé vide"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="canonicalUrl">URL canonique</Label>
                <Input
                  id="canonicalUrl"
                  value={draft.canonicalUrl ?? ""}
                  onChange={e => set("canonicalUrl", e.target.value)}
                  placeholder="À remplir seulement si republié depuis un autre site"
                  className="font-mono text-[12px]"
                />
              </div>

              <ToggleRow
                label="Masquer aux moteurs"
                hint="Pose noindex : l'article reste accessible par son lien mais sort de Google."
                checked={draft.noindex}
                onChange={v => set("noindex", v)}
              />
            </CardContent>
          </Card>

          {draft.id && (
            <form action={deletePost}>
              <input type="hidden" name="id" value={draft.id} />
              <Button
                type="submit"
                variant="destructive"
                size="lg"
                className="w-full"
                onClick={e => {
                  if (!confirm(`Supprimer définitivement « ${draft.title} » ?`)) {
                    e.preventDefault();
                  }
                }}
              >
                <Trash2 className="size-4" />
                Supprimer l&apos;article
              </Button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StatusBadge({ status, publishedAt }: { status: PostStatus; publishedAt: string }) {
  const isFuture = publishedAt ? new Date(publishedAt) > new Date() : false;
  if (status === "draft") return <Badge variant="secondary">Brouillon</Badge>;
  if (status === "scheduled" || isFuture) return <Badge variant="warning">Programmé</Badge>;
  return <Badge variant="success">Publié</Badge>;
}

function SlugField({
  value,
  state,
  siteUrl,
  onChange,
}: {
  value: string;
  state: "idle" | "checking" | "free" | "taken";
  siteUrl: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="shrink-0 font-mono text-[12px] text-white/50">{siteUrl.replace(/^https?:\/\//, "")}/news/</span>
      <input
        value={value}
        onChange={e => onChange(slugify(e.target.value))}
        placeholder="slug-de-l-article"
        className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-white outline-none placeholder:text-white/25"
      />
      {state === "checking" && <Loader2 className="size-3.5 animate-spin text-white/50" />}
      {state === "free" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
          <Check className="size-3.5" /> disponible
        </span>
      )}
      {state === "taken" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
          <TriangleAlert className="size-3.5" /> déjà pris
        </span>
      )}
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [value, setValue] = useState("");

  const add = () => {
    const t = value.trim().replace(/\s+/g, " ");
    if (!t) return;
    if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setValue("");
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="tag-input">Thèmes</Label>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.06] py-0.5 pl-2 pr-1 text-[12px] text-white/80"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter(t => t !== tag))}
                className="grid size-4 place-items-center rounded text-white/50 hover:text-white"
                aria-label={`Retirer ${tag}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        id="tag-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
          // Retour arrière sur un champ vide : retire le dernier thème.
          if (e.key === "Backspace" && !value && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={add}
        placeholder={tags.length >= 8 ? "Maximum atteint" : "Ajouter un thème puis Entrée"}
        disabled={tags.length >= 8}
      />
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-white">
          {icon}
          {label}
        </p>
        <p className="text-[12px] leading-snug text-white/50">{hint}</p>
      </div>
    </div>
  );
}

function Counter({ value, limit }: { value: number; limit: number }) {
  const over = value > limit;
  // Zone d'alerte à 90 % : on prévient avant la troncature, pas après.
  const near = !over && value > limit * 0.9;
  return (
    <span className={cn("text-[11px] tabular-nums", over ? "text-red-400" : near ? "text-amber-400" : "text-white/50")}>
      {value}/{limit}
    </span>
  );
}
