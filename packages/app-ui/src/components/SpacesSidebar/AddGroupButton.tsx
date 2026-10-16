import { Plus } from "@phosphor-icons/react";
import { openAddGroupDialog } from "./AddGroupModal";

interface AddGroupButtonProps {
  spaceId: string;
}

export function AddGroupButton({ spaceId }: AddGroupButtonProps) {
  return (
    <button
      onClick={() => openAddGroupDialog(spaceId)}
      className="flex w-full items-center gap-2 rounded-small border border-dashed border-outline-variant/70 px-2 py-1.5 text-label-large font-medium text-outline hover:border-outline-variant hover:bg-secondary-container/5 hover:text-on-surface"
    >
      <Plus size={16} weight="bold" />
      <span>Add group</span>
    </button>
  );
}
