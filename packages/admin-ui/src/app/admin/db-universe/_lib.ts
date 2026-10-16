/**
 * Helper interne admin pour consommer l'API publique du bot avec no-cache.
 * L'admin doit voir la vraie data temps-réel, pas la version cachée Vercel.
 */
import { API_URL as API } from "@/lib/config";

/**
 * URL publique d'un média de `bot.db_assets`.
 *
 * Deux racines cohabitent derrière ces chemins, et les confondre rend un 404 sur un
 * fichier pourtant présent : le miroir DB vit dans `public/db/` du bot (servi par
 * `/db/`), tandis que les médias uploadés depuis le studio sont enregistrés
 * « ./assets/wiki/… » et vivent dans `apps/shenron/site/public/wiki/` (servi par `/assets/`).
 * Mesuré le 2026-09-03 : 4 uploads étaient invisibles dans la galerie pour ce seul
 * motif — le chemin en base n'est jamais un chemin de disque.
 *
 * `assets/wiki/` n'est PAS le seul préfixe servi par `/assets/` : le bot expose
 * toute son arborescence `apps/shenron/bot/assets/` sous cette route (`serveAsset`), et
 * les scripts d'enrichissement y écrivent la majorité des médias des fiches —
 * `./assets/ext/db_episodes/601.jpg`, `./assets/ext/db_games/17.jpg`,
 * `./assets/dbz/xv2-portraits/…`. Les router vers `/db/` rendait un 404 sur des
 * fichiers présents : mesuré le 2026-09-13, 2 043 médias cassés dans l'admin
 * (652 épisodes, 594 techniques, 515 news, 66 volumes, 28 films…) contre 1 890
 * servis. On teste donc le préfixe `assets/` entier, pas `assets/wiki/`.
 *
 * L'encodage ne touche QUE les caractères non-ASCII (36 fichiers portent un nom
 * japonais) : ré-encoder tout casserait les chemins déjà percent-encodés en base,
 * où « %20 » deviendrait « %2520 ».
 */
export function assetCdnUrl(path: string): string {
  const propre = path.replace(/^\.?\//, "");
  // oxlint-disable-next-line no-control-regex
  const encode = (s: string) =>
    s.replace(/[^\x00-\x7F]/g, (c) => encodeURIComponent(c));
  if (propre.startsWith("assets/")) return `${API}/${encode(propre)}`;
  return `${API}/db/${encode(propre)}`;
}
