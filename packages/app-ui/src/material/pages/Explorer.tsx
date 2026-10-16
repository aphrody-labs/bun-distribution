// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import {
  GoogleDriveListView,
  TagPill,
  type DriveItem,
} from "@aphrody/m3-explorer";
import { Card, Page, Section } from "../ui.tsx";
import type { PageProps } from "./index.ts";

const SAMPLE_FILES: DriveItem[] = [
  {
    id: "folder",
    name: "Design studies",
    type: "folder",
    owner: "me",
    lastModified: "Today",
    shared: true,
  },
  {
    id: "notes",
    name: "Material notes.md",
    type: "document",
    owner: "me",
    lastModified: "Today",
    size: "4 KB",
    starred: true,
  },
  {
    id: "palette",
    name: "Colour palette.json",
    type: "code",
    owner: "Team",
    lastModified: "Yesterday",
    size: "2 KB",
    shared: true,
  },
  {
    id: "cover",
    name: "Reader cover.svg",
    type: "image",
    owner: "me",
    lastModified: "Yesterday",
    size: "12 KB",
  },
];

export default function Explorer({ adaptive }: PageProps) {
  const [files, setFiles] = useState(SAMPLE_FILES);
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState(
    "Local sample files; no remote Drive connection.",
  );
  const visible = useMemo(
    () =>
      files.filter((item) =>
        filter === "people"
          ? item.shared
          : filter === "modified"
            ? item.lastModified === "Today"
            : filter === "location"
              ? item.type === "folder"
              : true,
      ),
    [files, filter],
  );
  return (
    <Page
      title="Explorer"
      summary="File rows, selection, stars and a responsive grid from m3-explorer. The explicitly local sample inventory exercises callbacks without accessing your files."
      packages={["@aphrody/m3-explorer"]}
      panes={adaptive.panes}
    >
      <Section
        title="Local sample inventory"
        description="Enter opens a row or tile; Space selects it. The filter chips select all files, shared files, today's files or folders."
      >
        <Card>
          <GoogleDriveListView
            title="Sample files"
            items={visible}
            selectedId={selected}
            onSelect={(item) => {
              setSelected(item.id);
              setNotice(`Selected ${item.name}`);
            }}
            onOpen={(item) => {
              setSelected(item.id);
              setNotice(`Opened local preview: ${item.name}`);
            }}
            viewMode={view}
            onViewModeChange={setView}
            activeFilter={filter}
            onFilterChange={setFilter}
            onToggleStar={(item) =>
              setFiles((current) =>
                current.map((entry) =>
                  entry.id === item.id
                    ? { ...entry, starred: !entry.starred }
                    : entry,
                ),
              )
            }
            onRowAction={(item) => {
              const blob = new Blob(
                [`Local demonstration file: ${item.name}\n`],
                {
                  type: "text/plain",
                },
              );
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `${item.name}.sample.txt`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice(`Downloaded local sample for ${item.name}`);
            }}
          />
        </Card>
        <output className="block text-body-medium">{notice}</output>
      </Section>
      <Section title="Tags">
        <div className="flex flex-wrap gap-3">
          <TagPill color="#6750a4">Local sample</TagPill>
          <TagPill color="#00658f">{visible.length} files</TagPill>
          <TagPill color="#3a6a1e">
            {view === "grid" ? "Grid view" : "List view"}
          </TagPill>
        </div>
      </Section>
    </Page>
  );
}
