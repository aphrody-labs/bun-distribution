// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos, HOME } from "../os";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  opus: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Media player for files of the Rust file system or from your device (mpv in Omarchy). */
/** `start` plays that file of the VFS right away (Files > open with Media). */
export async function mediaApp(root: HTMLElement, start?: string) {
  const os = await webos();
  const stage = h("div", { class: "media-stage" }, h("div", { class: "empty" }, "Choose a video, song or picture."));
  const path = h("input", { class: "fld grow", value: `${HOME}/`, "aria-label": "Path in Files" });
  const file = h("input", { type: "file", accept: "video/*,audio/*,image/*", "aria-label": "Open from device" });
  let url: string | undefined;
  const play = (name: string, data: Uint8Array | Blob) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const type = MIME[ext] ?? (data instanceof Blob ? data.type : "");
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart], { type }));
    const el = type.startsWith("audio/")
      ? h("audio", { controls: true, autoplay: true, src: url })
      : type.startsWith("image/")
        ? h("img", { src: url, alt: name })
        : h("video", { controls: true, autoplay: true, src: url });
    stage.replaceChildren(el);
  };
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (f) play(f.name, f);
  });
  const open = () => {
    try {
      play(path.value.trim(), os.fs.read(path.value.trim()));
    } catch (error) {
      stage.replaceChildren(h("div", { class: "empty err" }, `Cannot open this file: ${String(error)}`));
    }
  };
  path.addEventListener("keydown", e => e.key === "Enter" && open());
  root.append(
    h(
      "div",
      { class: "store" },
      h("div", { class: "files-bar" }, file, path, h("button", { class: "btn", onclick: open }, "Play")),
      stage,
    ),
  );
  if (start) {
    path.value = start;
    open();
  }
}
