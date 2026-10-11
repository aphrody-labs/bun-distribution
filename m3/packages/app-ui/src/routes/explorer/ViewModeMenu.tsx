import {
  CircleButton,
  CircleButtonGroup,
  Icon,
  m3FocusRing,
  m3StateLayer,
} from "@aphrody/m3-primitives";
import { clsx } from "clsx";

/** Vite/Bun inject `import.meta.env`; read it through a typed view so no global declaration is needed. */
const isDevBuild = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

type ViewMode = "list" | "grid" | "column" | "media" | "size" | "knowledge";

interface ViewOption {
  id: ViewMode;
  label: string;
  /** Material Symbols name. */
  icon: string;
  color: string;
  keybind: string;
}

const viewOptions: ViewOption[] = [
  {
    id: "grid",
    label: "Grille",
    icon: "grid_view",
    color: "bg-primary",
    keybind: "⌘1",
  },
  {
    id: "list",
    label: "Liste",
    icon: "view_list",
    color: "bg-tertiary",
    keybind: "⌘2",
  },
  {
    id: "media",
    label: "Médias",
    icon: "photo_library",
    color: "bg-tertiary",
    keybind: "⌘3",
  },
  {
    id: "column",
    label: "Colonnes",
    icon: "view_column",
    color: "bg-warning",
    keybind: "⌘4",
  },
  {
    id: "size",
    label: "Taille",
    icon: "pie_chart",
    color: "bg-success",
    keybind: "⌘5",
  },
  {
    id: "knowledge",
    label: "Connaissance",
    icon: "auto_awesome",
    color: "bg-tertiary",
    keybind: "⌘6",
  },
];

interface ViewModeMenuPanelProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onClose?: () => void;
}

export function ViewModeMenuPanel({ viewMode, onViewModeChange, onClose }: ViewModeMenuPanelProps) {
  const availableViews = viewOptions.filter((option) => option.id !== "knowledge" || isDevBuild);

  return (
    <div
      role="menu"
      className="bg-surface-container w-[240px] rounded-extra-small p-2 shadow-md3-2"
    >
      <div className="grid grid-cols-3 gap-1">
        {availableViews.map((option) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={viewMode === option.id}
            key={`${option.id}-${option.label}`}
            onClick={() => {
              onViewModeChange(option.id);
              onClose?.();
            }}
            className={clsx(
              "flex flex-col items-center gap-1.5 rounded-small px-2 py-2",
              m3StateLayer,
              m3FocusRing,
              viewMode === option.id
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant",
            )}
          >
            <Icon name={option.icon} size={24} filled={viewMode === option.id} />
            <div className="flex flex-col items-center gap-0.5">
              <div className="text-label-medium">{option.label}</div>
              <div className="text-label-small opacity-80">{option.keybind}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ViewModeMenuProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

/**
 * 4 Canonical Views button group in TopBar (Parité Spacedrive alpha 0.2 & docs/UI-DESIGN.md §3.2).
 */
export function ViewModeMenu({ viewMode, onViewModeChange }: ViewModeMenuProps) {
  return (
    <CircleButtonGroup>
      <CircleButton
        icon="grid_view"
        title="Grid (⌘1)"
        aria-label="Grid view"
        active={viewMode === "grid"}
        onClick={() => onViewModeChange("grid")}
      />
      <CircleButton
        icon="view_list"
        title="List (⌘2)"
        aria-label="List view"
        active={viewMode === "list"}
        onClick={() => onViewModeChange("list")}
      />
      <CircleButton
        icon="photo_library"
        title="Media (⌘3)"
        aria-label="Media view"
        active={viewMode === "media"}
        onClick={() => onViewModeChange("media")}
      />
      <CircleButton
        icon="view_column"
        title="Column (⌘4)"
        aria-label="Column view"
        active={viewMode === "column"}
        onClick={() => onViewModeChange("column")}
      />
    </CircleButtonGroup>
  );
}
