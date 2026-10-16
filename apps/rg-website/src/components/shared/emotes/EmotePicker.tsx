"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@rosegriffon/ui";
import { Search, Smile } from "lucide-react";
import { useState } from "react";

import { EMOTES } from "@/lib/emotes";
import type { Emote } from "@/lib/emotes";

import RgEmote from "./RgEmote";

interface EmotePickerProps {
  /** Callback appelé lors de la sélection d'une emote */
  onSelect: (emote: Emote) => void;
  /** Élément déclencheur personnalisé (bouton par défaut) */
  trigger?: React.ReactNode;
  /** Taille des emotes dans le picker (default: 48) */
  emoteSize?: number;
  /** Titre du dialog */
  title?: string;
}

/**
 * Composant de sélection d'emotes Rose Griffon
 *
 * @example
 * ```tsx
 * <EmotePicker
 *   onSelect={(emote) => console.log(emote.name)}
 * />
 * ```
 */
export default function EmotePicker({
  onSelect,
  trigger,
  emoteSize = 48,
  title = "Sélectionner une emote",
}: EmotePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "gaelle" | "roy" | "rg">("all");

  const handleSelect = (emote: Emote) => {
    onSelect(emote);
    setOpen(false);
    setSearch("");
  };

  // Filtrage des emotes
  let filteredEmotes = Object.values(EMOTES);

  // Filtre par personnage (onglet)
  if (activeTab !== "all") {
    filteredEmotes = filteredEmotes.filter(e => e.character === activeTab);
  }

  // Filtre par recherche
  if (search) {
    const searchLower = search.toLowerCase();
    filteredEmotes = filteredEmotes.filter(
      e =>
        e.name.toLowerCase().includes(searchLower) ||
        e.alt.toLowerCase().includes(searchLower) ||
        e.category.toLowerCase().includes(searchLower),
    );
  }

  // Classement par personnage puis par nom
  filteredEmotes.sort((a, b) => {
    if (a.character === b.character) {
      return a.name.localeCompare(b.name);
    }
    return a.character.localeCompare(b.character);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Smile className="size-4 mr-2" />
            Emote
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[600px] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Smile className="size-5 text-[#B03519]" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Barre de recherche */}
          <div className="px-6 py-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher une emote..."
                className="pl-10"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Onglets par personnage */}
          <Tabs
            value={activeTab}
            onValueChange={v => setActiveTab(v as "all" | "gaelle" | "roy" | "rg")}
            className="flex-1 flex flex-col"
          >
            <div className="px-6 pt-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">Toutes</TabsTrigger>
                <TabsTrigger value="gaelle">
                  <span className="hidden sm:inline">Gaëlle</span>
                  <span className="sm:hidden">G</span>
                </TabsTrigger>
                <TabsTrigger value="roy">
                  <span className="hidden sm:inline">Roy</span>
                  <span className="sm:hidden">R</span>
                </TabsTrigger>
                <TabsTrigger value="rg">RG</TabsTrigger>
              </TabsList>
            </div>

            {/* Grille d'emotes */}
            <div className="flex-1 overflow-y-auto p-6">
              <TabsContent value={activeTab} className="mt-0">
                {filteredEmotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Smile className="size-12 mb-2 opacity-20" />
                    <p>Aucune emote trouvée</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                    {filteredEmotes.map(emote => (
                      <button
                        key={emote.name}
                        onClick={() => handleSelect(emote)}
                        className="group flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-muted transition-all focus:outline-hidden focus:ring-2 focus:ring-[#B03519]/50 bg-background border border-border/50 hover:border-[#B03519]/50"
                        title={emote.alt}
                        type="button"
                      >
                        <RgEmote name={emote.name as keyof typeof EMOTES} size={emoteSize} animated />
                        <span className="text-[10px] text-muted-foreground text-center line-clamp-2 group-hover:text-foreground transition-colors">
                          {emote.name.replaceAll(/-/g, " ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>

          {/* Footer avec infos */}
          <div className="px-6 py-3 border-t bg-muted/30 text-xs text-muted-foreground">
            {filteredEmotes.length} emote{filteredEmotes.length > 1 ? "s" : ""} {search && `pour "${search}"`}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
