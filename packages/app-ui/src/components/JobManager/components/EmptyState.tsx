import { Icon } from "@aphrody/m3-primitives";
import { CARD_HEIGHT } from "../types";

export function EmptyState() {
  return (
    <div className="flex items-center justify-center px-4" style={{ height: CARD_HEIGHT }}>
      <div className="flex items-center gap-2 text-on-surface-variant">
        <Icon name="check_circle" size={16} />
        <span className="text-body-medium">No active jobs</span>
      </div>
    </div>
  );
}
