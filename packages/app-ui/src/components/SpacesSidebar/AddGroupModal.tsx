import { useState } from "react";
import { Input, Label, dialogManager, useDialog, Dialog } from "@aphrody/m3-primitives";
import { useLibraryMutation } from "@aphrody/drive-client";
import { useForm } from "react-hook-form";
import type { GroupType } from "@aphrody/drive-client";

interface FormData {
  groupName: string;
}

export function openAddGroupDialog(spaceId: string) {
  return dialogManager.create(props => <AddGroupDialog {...props} spaceId={spaceId} />);
}

function AddGroupDialog(props: { id: number; spaceId: string }) {
  const dialog = useDialog(props);
  const [groupType, setGroupType] = useState<GroupType>("Custom");

  const form = useForm<FormData>({
    defaultValues: { groupName: "" },
  });

  const addGroup = useLibraryMutation("spaces.add_group");

  const onSubmit = form.handleSubmit(async data => {
    await addGroup.mutateAsync({
      space_id: props.spaceId,
      name: data.groupName || getDefaultName(groupType),
      group_type: groupType,
    });
    form.reset();
    setGroupType("Custom");
    dialogManager.setState(dialog.id, { open: false });
  });

  return (
    <Dialog form={form} dialog={dialog} title="Add group" onSubmit={onSubmit} ctaLabel="Create">
      <div className="space-y-4">
        <div>
          <Label>Group type</Label>
          <select
            value={typeof groupType === "string" ? groupType : "Custom"}
            onChange={e => setGroupType(e.target.value as GroupType)}
            className="w-full rounded-small border border-outline-variant bg-surface-container-highest px-3 py-2 text-body-medium text-on-surface"
          >
            <option value="Devices">All devices</option>
            <option value="Locations">All locations</option>
            <option value="Tags">Tags</option>
            <option value="Cloud">Cloud storage</option>
            <option value="Custom">Custom</option>
          </select>
        </div>

        {groupType === "Custom" && (
          <div>
            <Label>Group name</Label>
            <Input {...form.register("groupName")} placeholder="Enter group name" />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function getDefaultName(groupType: GroupType): string {
  if (groupType === "Devices") return "Devices";
  if (groupType === "Locations") return "Locations";
  if (groupType === "Tags") return "Tags";
  if (groupType === "Cloud") return "Cloud";
  if (groupType === "Custom") return "Custom Group";
  if (typeof groupType === "object" && "Device" in groupType) return "Device";
  return "Group";
}
