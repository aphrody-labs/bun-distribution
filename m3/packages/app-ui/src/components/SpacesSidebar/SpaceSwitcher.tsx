// SPDX-License-Identifier: Apache-2.0
import { GearSix, Plus } from "@phosphor-icons/react";
import type { Space } from "@aphrody/drive-client";
import { DropdownMenu } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useCreateSpaceDialog } from "./CreateSpaceModal";
import { AphrodyAvatar } from "@aphrody/identity";

interface SpaceSwitcherProps {
  spaces: Space[] | undefined;
  currentSpace: Space | undefined;
  onSwitch: (spaceId: string) => void;
}

export function SpaceSwitcher({ spaces, currentSpace, onSwitch }: SpaceSwitcherProps) {
  const openCreateSpaceDialog = useCreateSpaceDialog();
  const spaceName = currentSpace?.name || "Aphrody";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Espace actif : ${spaceName}`}
          className="flex h-12 w-full items-center gap-3 rounded-medium bg-surface-container/60 hover:bg-surface-container px-3 py-1.5 transition-colors cursor-pointer text-left border border-outline-variant/30 select-none group"
        >
          {/* Avatar Aphrody */}
          <AphrodyAvatar size={32} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-label-large font-semibold text-on-surface">
              {spaceName}
            </span>
          </div>
          <span className="material-symbol text-title-small text-on-surface-variant group-hover:text-on-surface transition-colors">
            expand_more
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="min-w-(--anchor-width) p-1 bg-surface-container border border-outline-variant rounded-medium shadow-lg z-50">
        {spaces && spaces.length > 1
          ? spaces.map((space) => (
              <DropdownMenu.Item
                key={space.id}
                onClick={() => onSwitch(space.id)}
                className={clsx(
                  "rounded-small px-3 py-2 text-label-large font-medium cursor-pointer",
                  space.id === currentSpace?.id
                    ? "bg-secondary-container text-primary font-semibold"
                    : "text-on-surface hover:bg-secondary-container/40",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: space.color || "#3b82f6" }}
                  />
                  <span>{space.name}</span>
                </div>
              </DropdownMenu.Item>
            ))
          : null}
        {spaces && spaces.length > 1 && (
          <DropdownMenu.Separator className="border-outline-variant/40 my-1" />
        )}
        <DropdownMenu.Item
          onClick={() => openCreateSpaceDialog()}
          className="hover:bg-secondary-container/40 text-on-surface rounded-small px-3 py-2 text-label-large font-medium cursor-pointer flex items-center"
        >
          <Plus className="mr-2 size-5" weight="bold" />
          Nouvel espace
        </DropdownMenu.Item>
        <DropdownMenu.Item className="hover:bg-secondary-container/40 text-on-surface rounded-small px-3 py-2 text-label-large font-medium cursor-pointer flex items-center">
          <GearSix className="mr-2 size-5" weight="bold" />
          Paramètres de l'espace
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
