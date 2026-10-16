import { XIcon } from "@rosegriffon/ui";

/**
 * Logo X — RÉ-EXPORT, plus une seconde copie du tracé.
 *
 * Ce fichier dessinait le même `path` que `XIcon` de `@rosegriffon/ui`,
 * caractère pour caractère. Deux copies, c'est deux occasions de diverger : le
 * jour où la marque change son logo, l'une est corrigée et l'autre reste.
 *
 * La signature d'origine (`width`/`height` en nombres, export par défaut) est
 * conservée telle quelle — cinq fichiers l'appellent ainsi, et les migrer
 * n'apporterait rien de plus que ce ré-export.
 */
interface TwitterIconProps {
  width?: number;
  height?: number;
  className?: string;
}

export default function TwitterIcon({ width, height, className }: TwitterIconProps) {
  return <XIcon title="X" width={width ?? 24} height={height ?? 24} className={className} />;
}
