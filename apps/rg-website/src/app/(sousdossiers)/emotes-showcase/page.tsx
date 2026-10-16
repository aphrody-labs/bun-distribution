"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Separator,
} from "@rosegriffon/ui";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import EmotePicker from "@/components/shared/emotes/EmotePicker";
import EmoteRenderer, {
  getTextWithoutEmotes,
  stripEmotes,
} from "@/components/shared/emotes/EmoteRenderer";
import RgEmote, { RgEmoteGrid, RgEmoteLine } from "@/components/shared/emotes/RgEmote";

import {
  useEmoteHistory,
  useEmoteRotation,
  useEmoteValidation,
  useEmotes,
} from "@/hooks/useEmotes";
import type { EMOTES, Emote } from "@/lib/emotes";

export default function EmotesShowcasePage() {
  const [text, setText] = useState("Bienvenue :gaelle-salut: sur Rose Griffon :roy-evil: !");
  const [selectedEmote, setSelectedEmote] = useState<Emote | null>(null);

  const { selectRandomEmote, getByCharacter } = useEmotes();
  const { history, addToHistory } = useEmoteHistory(6);
  const { currentEmote, rotate } = useEmoteRotation(4000);
  const validation = useEmoteValidation(text);

  const handleEmoteSelect = (emote: Emote) => {
    setSelectedEmote(emote);
    addToHistory(emote);
    setText((prev) => `${prev} :${emote.name}:`);
    toast.success(`Emote ajoutée : ${emote.name}`);
  };

  return (
    <div className="container mx-auto py-12 px-4 max-w-6xl">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <RgEmote name="rg-funny" size={64} animated />
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-linear-to-r from-[#B03519] to-[#770007]">
            Système d'Emotes
          </h1>
          <RgEmote name="gaelle-coeur" size={64} animated />
        </div>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Explorez tous les composants et fonctionnalités du système d'emotes Rose Griffon
        </p>
      </div>

      <Tabs defaultValue="picker" className="space-y-8">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="picker">Picker</TabsTrigger>
          <TabsTrigger value="renderer">Renderer</TabsTrigger>
          <TabsTrigger value="grid">Grid</TabsTrigger>
          <TabsTrigger value="hooks">Hooks</TabsTrigger>
        </TabsList>

        {/* Tab: EmotePicker */}
        <TabsContent value="picker" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>EmotePicker Component</CardTitle>
              <CardDescription>Sélecteur d'emotes avec recherche et filtres</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <EmotePicker onSelect={handleEmoteSelect} />
                {selectedEmote && (
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                    <RgEmote name={selectedEmote.name as keyof typeof EMOTES} size={48} animated />
                    <div>
                      <p className="font-semibold">{selectedEmote.name}</p>
                      <p className="text-sm text-muted-foreground">{selectedEmote.alt}</p>
                    </div>
                  </div>
                )}
              </div>

              {history.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Récemment utilisé</h3>
                  <RgEmoteLine
                    emotes={history.map((e) => e.name as keyof typeof EMOTES)}
                    size={40}
                    gap={12}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: EmoteRenderer */}
        <TabsContent value="renderer" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>EmoteRenderer Component</CardTitle>
              <CardDescription>
                Convertit automatiquement :emote-name: en composants
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="route-emotes-showcase-page-tsx-1" className="text-sm font-medium">
                  Texte avec emotes
                </label>
                <Textarea
                  id="route-emotes-showcase-page-tsx-1"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="Tapez du texte avec des :emote-name: ..."
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setText("Bienvenue :gaelle-salut: sur Rose Griffon :roy-evil: !")
                    }
                  >
                    Exemple 1
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setText("Merci :gaelle-coeur: :roy-coeur: pour votre visite :rg-funny: !")
                    }
                  >
                    Exemple 2
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Rendu avec emotes</h3>
                  <Card className="p-4 bg-muted/50">
                    <EmoteRenderer text={text} emoteSize={28} />
                  </Card>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Texte sans emotes (stripEmotes)</h3>
                  <Card className="p-4 bg-muted/50">
                    <p className="text-sm">{stripEmotes(text)}</p>
                  </Card>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Texte pur (getTextWithoutEmotes)</h3>
                  <Card className="p-4 bg-muted/50">
                    <p className="text-sm">{getTextWithoutEmotes(text)}</p>
                  </Card>
                </div>

                {validation.hasInvalidEmotes && (
                  <Card className="p-4 border-destructive bg-destructive/10">
                    <p className="text-sm text-destructive">
                      <strong>Emotes invalides :</strong> {validation.invalid.join(", ")}
                    </p>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: RgEmoteGrid */}
        <TabsContent value="grid" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>RgEmoteGrid Component</CardTitle>
              <CardDescription>Affiche une grille d'emotes filtrables</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="all">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="all">Toutes</TabsTrigger>
                  <TabsTrigger value="gaelle">Gaëlle</TabsTrigger>
                  <TabsTrigger value="roy">Roy</TabsTrigger>
                  <TabsTrigger value="rg">RG</TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="mt-6">
                  <RgEmoteGrid
                    size={56}
                    columns={5}
                    onEmoteClick={(emote) => {
                      toast.success(`Emote cliquée : ${emote.name}`);
                    }}
                  />
                </TabsContent>

                <TabsContent value="gaelle" className="mt-6">
                  <RgEmoteGrid
                    character="gaelle"
                    size={56}
                    columns={4}
                    onEmoteClick={(emote) => {
                      toast.success(`Emote cliquée : ${emote.name}`);
                    }}
                  />
                </TabsContent>

                <TabsContent value="roy" className="mt-6">
                  <RgEmoteGrid
                    character="roy"
                    size={56}
                    columns={4}
                    onEmoteClick={(emote) => {
                      toast.success(`Emote cliquée : ${emote.name}`);
                    }}
                  />
                </TabsContent>

                <TabsContent value="rg" className="mt-6">
                  <RgEmoteGrid
                    character="rg"
                    size={56}
                    columns={2}
                    onEmoteClick={(emote) => {
                      toast.success(`Emote cliquée : ${emote.name}`);
                    }}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Hooks */}
        <TabsContent value="hooks" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* UseEmoteRotation */}
            <Card>
              <CardHeader>
                <CardTitle>useEmoteRotation</CardTitle>
                <CardDescription>Change automatiquement d'emote (4s)</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <button
                  type="button"
                  aria-label="Changer d’emote"
                  onClick={rotate}
                  className="cursor-pointer hover:scale-110 transition-transform"
                >
                  <RgEmote name={currentEmote.name as keyof typeof EMOTES} size={96} animated />
                </button>
                <p className="text-sm text-center text-muted-foreground">{currentEmote.alt}</p>
                <Button onClick={rotate} variant="outline" size="sm">
                  Changer maintenant
                </Button>
              </CardContent>
            </Card>

            {/* UseEmotes */}
            <Card>
              <CardHeader>
                <CardTitle>useEmotes</CardTitle>
                <CardDescription>Hook principal pour manipuler les emotes</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Button
                  onClick={() => {
                    const emote = selectRandomEmote();
                    toast.success(`Emote aléatoire : ${emote.name}`);
                  }}
                >
                  <Sparkles className="size-4 mr-2" />
                  Emote Aléatoire
                </Button>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Toutes les emotes de Gaëlle :</p>
                  <RgEmoteLine
                    emotes={getByCharacter("gaelle").map((e) => e.name as keyof typeof EMOTES)}
                    size={32}
                    gap={8}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Toutes les emotes de Roy :</p>
                  <RgEmoteLine
                    emotes={getByCharacter("roy").map((e) => e.name as keyof typeof EMOTES)}
                    size={32}
                    gap={8}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="mt-12 text-center">
        <Separator className="mb-6" />
        <p className="text-muted-foreground flex items-center justify-center gap-2">
          Système d'Emotes Rose Griffon v2.0
          <RgEmote name="rg-funny" size={20} />
        </p>
      </div>
    </div>
  );
}
