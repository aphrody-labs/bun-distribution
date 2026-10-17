// SPDX-License-Identifier: Apache-2.0
import { Card, Kbd } from "@aphrody/m3-primitives";

const SHORTCUT_ITEMS = [
  {
    keys: ["Ctrl", "N"],
    action: "Nouveau chat dans le projet actif",
    scope: "Chat",
  },
  {
    keys: ["Ctrl", "1"],
    action: "Basculer vers la zone Chat",
    scope: "Navigation",
  },
  {
    keys: ["Ctrl", "2"],
    action: "Basculer vers la zone Fichiers (Explorer)",
    scope: "Navigation",
  },
  {
    keys: ["Ctrl", "3"],
    action: "Basculer vers la zone Modèles",
    scope: "Navigation",
  },
  {
    keys: ["Ctrl", "B"],
    action: "Afficher / masquer la barre latérale",
    scope: "Affichage",
  },
  {
    keys: ["Ctrl", "I"],
    action: "Afficher / masquer le volet Inspecteur",
    scope: "Affichage",
  },
  {
    keys: ["Ctrl", "F"],
    action: "Rechercher dans la surface active",
    scope: "Recherche",
  },
  {
    keys: ["Ctrl", "K"],
    action: "Ouvrir la palette de commandes globale",
    scope: "Global",
  },
  { keys: ["Ctrl", "T"], action: "Ouvrir un nouvel onglet", scope: "Onglets" },
  { keys: ["Ctrl", "W"], action: "Fermer l'onglet actif", scope: "Onglets" },
  {
    keys: ["Ctrl", "Tab"],
    action: "Passer à l'onglet suivant",
    scope: "Onglets",
  },
  { keys: ["Ctrl", ","], action: "Ouvrir les Paramètres", scope: "Global" },
  {
    keys: ["Espace"],
    action: "Aperçu rapide du fichier sélectionné",
    scope: "Fichiers",
  },
  {
    keys: ["Entrée"],
    action: "Envoyer le message ou valider",
    scope: "Saisie",
  },
  {
    keys: ["Maj", "Entrée"],
    action: "Insérer un saut de ligne",
    scope: "Saisie",
  },
  {
    keys: ["Échap"],
    action: "Arrêter le tour en cours ou fermer le panneau",
    scope: "Action",
  },
  {
    keys: ["Alt", "Espace"],
    action: "Ouvrir la capsule d'assistance rapide",
    scope: "Système",
  },
];

export function KeyboardSettings() {
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">Clavier</h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Raccourcis clavier de la station de travail Aphrody.
        </p>
      </div>

      <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
        <div className="divide-y divide-outline-variant/30">
          {SHORTCUT_ITEMS.map(item => (
            <div
              key={item.action}
              className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 gap-4 min-h-12"
            >
              <div>
                <span className="text-label-large font-medium text-on-surface block">{item.action}</span>
                <span className="text-body-large text-on-surface-variant">{item.scope}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {item.keys.map(k => (
                  <Kbd
                    key={k}
                    className="px-2.5 py-1 text-label-large rounded-small bg-surface-container-high border border-outline-variant text-on-surface font-semibold shadow-xs"
                  >
                    {k}
                  </Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
