import { Button, Icon, m3FocusRing, m3StateLayer } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useExplorer } from "./context";
import type { SearchScope } from "./context";

export function SearchToolbar() {
  const explorer = useExplorer();

  if (explorer.mode.type !== "search") {
    return null;
  }

  const { scope } = explorer.mode;

  const handleScopeChange = (newScope: SearchScope) => {
    if (explorer.mode.type === "search") {
      explorer.enterSearchMode(explorer.mode.query, newScope);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-outline-variant bg-surface-container-low">
      <div className="flex items-center gap-2">
        <span className="text-label-medium text-on-surface-variant font-medium">Rechercher dans :</span>
        {/* M3 segmented button: connected outlined segments, selected = secondary-container. */}
        <div
          role="radiogroup"
          aria-label="Portée de recherche"
          className="flex items-center rounded-full border border-outline divide-x divide-outline overflow-hidden shadow-xs"
        >
          <ScopeButton active={scope === "folder"} onClick={() => handleScopeChange("folder")}>
            Ce dossier
          </ScopeButton>
          <ScopeButton active={scope === "location"} onClick={() => handleScopeChange("location")}>
            Emplacement
          </ScopeButton>
          <ScopeButton active={scope === "library"} onClick={() => handleScopeChange("library")}>
            Bibliothèque
          </ScopeButton>
        </div>
      </div>

      <div className="h-4 w-px bg-outline-variant" />

      <Button variant="text" size="xs">
        <Icon name="filter_list" size={16} />
        Filtres
      </Button>

      <div className="flex-1" />

      <Button variant="text" size="xs" onClick={explorer.exitSearchMode}>
        <Icon name="close" size={16} />
        Clear search
      </Button>
    </div>
  );
}

interface ScopeButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ScopeButton({ active, onClick, children }: ScopeButtonProps) {
  return (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- groupe radio segmenté stylé en bouton : un input natif changerait la mise en page
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        "flex h-8 items-center gap-1 px-3 text-label-large",
        m3StateLayer,
        m3FocusRing,
        active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface",
      )}
    >
      {active && <Icon name="check" size={16} />}
      {children}
    </button>
  );
}
