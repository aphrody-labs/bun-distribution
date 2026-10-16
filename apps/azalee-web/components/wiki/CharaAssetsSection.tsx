"use client";

/**
 * Section "Assets du jeu" d'une fiche perso : affiche la **voix**
 * (`/audio/.../<code>.acb` → WAV), servie par niers mais absente des colonnes
 * du miroir azalee.
 * Reçoit le code interne (`internalCode`, ex. `c01001900`).
 */
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

const CDN = "https://cdn.rosegriffon.fr";

export function CharaAssetsSection({ internalCode }: { internalCode: string }) {
  const [voiceFailed, setVoiceFailed] = useState(false);
  if (!internalCode || !/^c\d{6,9}$/i.test(internalCode)) return null;

  const voiceUrl = `${CDN}/audio/data/common/sound_asset/ja/${internalCode}.acb`;

  return (
    <section className="rounded-3xl border border-outline-variant/20 bg-surface-container-low/40 p-5 space-y-4">
      <h2 className="flex items-center gap-2 text-fluid-title-md font-bold text-on-surface">
        <Icon name="deployed_code" size={20} className="text-primary" />
        Assets du jeu
      </h2>

      {!voiceFailed && (
        <div>
          <p className="text-xs text-on-surface-variant mb-1">Voix (JP)</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            controls
            preload="none"
            className="w-full max-w-md"
            src={voiceUrl}
            onError={() => setVoiceFailed(true)}
          />
        </div>
      )}
    </section>
  );
}
