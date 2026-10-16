import { CaretRight, Database } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

interface SourcePathBarProps {
  sourceName: string;
  itemCount: number;
}

export function SourcePathBar({ sourceName, itemCount }: SourcePathBarProps) {
  const navigate = useNavigate();

  return (
    <div className="border-outline-variant/50 bg-surface-container-high/80 flex h-8 items-center gap-1.5 rounded-full border px-3 backdrop-blur-xl">
      <Database size={14} className="text-outline shrink-0" />

      <button
        onClick={() => navigate("/sources")}
        className="text-sidebar-inkDull hover:text-on-surface whitespace-nowrap text-label-medium font-medium transition-colors"
      >
        Sources
      </button>

      <CaretRight size={12} className="text-outline shrink-0 opacity-50" />

      <span className="text-on-surface whitespace-nowrap text-label-medium font-medium">
        {sourceName}
      </span>

      <span className="text-outline ml-1 whitespace-nowrap text-[11px]">
        {itemCount.toLocaleString()} items
      </span>
    </div>
  );
}
