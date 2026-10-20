// SPDX-License-Identifier: Apache-2.0
// Video Studio: a declarative composition (clips, text/image overlays, one audio track) rendered per frame
// on a canvas, the model of Remotion/HyperFrames (HyperFrames: data-start / data-duration / data-track-index
// per element; Remotion: a pure function of the frame number). The project is a small JSON document, not
// Aphrody Video's `.fcproj` (schema v13, integer ticks, an items map, read only by `filmcraft-format`, which
// is not in the webos-wasm build); the hand-off button therefore passes the media, not the project, to
// the installed craft-film package (`window.filmcraft.importFiles`). Preview: HTMLVideoElement frames drawn
// on a Canvas. Audio: WebAudio. Export: MediaRecorder on `canvas.captureStream` (real time) into WebM.
import { h, ask } from "../dom";
import { webos, HOME } from "../os";

export interface VideoOptions {
  /** Open (or focus) the installed Aphrody Video package window (`pkg:craft-film`). */
  openFilm?: () => void;
}

const FORMAT = "bunos.video.project";
const DIR = `${HOME}/Videos`;
const MAX_COPY = 32 * 1024 * 1024;
const IMG = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const VID = /\.(mp4|webm|ogv|mov|m4v|mkv)$/i;
const AUD = /\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i;

interface Clip {
  id: number;
  src: string;
  in: number;
  out: number;
  mute?: boolean;
}
interface Overlay {
  id: number;
  type: "text" | "image";
  start: number;
  dur: number;
  x: number;
  y: number;
  size: number;
  color: string;
  text: string;
  src: string;
}
interface AudioTrack {
  src: string;
  start: number;
  volume: number;
}
interface Project {
  format: typeof FORMAT;
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  clips: Clip[];
  overlays: Overlay[];
  audio: AudioTrack | null;
  next: number;
}
interface Source {
  key: string;
  name: string;
  kind: "video" | "image";
  blob: Blob;
  url: string;
  el: HTMLVideoElement | HTMLImageElement;
  duration: number;
  gain?: GainNode;
}
type Sel = { kind: "clip" | "ov" | "audio"; id: number } | null;

const blank = (): Project => ({
  format: FORMAT,
  version: 1,
  name: "untitled",
  width: 1280,
  height: 720,
  fps: 30,
  clips: [],
  overlays: [],
  audio: null,
  next: 1,
});
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dur = (c: Clip) => Math.max(0.05, c.out - c.in);
const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};
const mimeOf = (name: string) =>
  IMG.test(name) ? "image/*" : VID.test(name) ? "video/*" : AUD.test(name) ? "audio/*" : "";

export async function videoApp(root: HTMLElement, opts: VideoOptions = {}) {
  const os = await webos();
  let p = blank();
  let sel: Sel = null;
  let t = 0;
  let playing = false;
  let raf = 0;
  let pps = 80;
  let status = "";
  let exporting = false;
  const sources = new Map<string, Source>();
  const history: string[] = [];
  let actx: AudioContext | undefined;
  let master: GainNode | undefined;
  let tap: MediaStreamAudioDestinationNode | undefined;
  let audioBuf: AudioBuffer | undefined;
  let audioNode: AudioBufferSourceNode | undefined;
  let active: Clip | undefined;
  let wall = 0;
  let from = 0;
  let onEnd: (() => void) | undefined;

  const canvas = h("canvas", { class: "vs-canvas", "aria-label": "Preview" });
  const g = canvas.getContext("2d")!;
  const total = () => p.clips.reduce((a, c) => a + dur(c), 0);
  const locate = (time: number) => {
    let at = 0;
    for (const clip of p.clips) {
      const d = dur(clip);
      if (time < at + d) return { clip, local: time - at, at };
      at += d;
    }
    const last = p.clips.at(-1);
    return last ? { clip: last, local: dur(last), at: at - dur(last) } : undefined;
  };

  // ---- compositor: one pure function of (project, time) ----
  function draw() {
    if (canvas.width !== p.width || canvas.height !== p.height) {
      canvas.width = p.width;
      canvas.height = p.height;
    }
    const { width: W, height: H } = p;
    g.globalAlpha = 1;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    const loc = locate(t);
    const s = loc && sources.get(loc.clip.src);
    if (s) fit(s.el, 0, 0, W, H);
    for (const o of p.overlays) {
      if (t < o.start || t > o.start + o.dur) continue;
      const fade = Math.min(1, (t - o.start) / 0.25, (o.start + o.dur - t) / 0.25);
      g.globalAlpha = clamp(fade, 0, 1);
      if (o.type === "text") {
        g.font = `700 ${Math.round(o.size * H)}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.lineJoin = "round";
        g.lineWidth = Math.max(2, o.size * H * 0.12);
        g.strokeStyle = "rgba(0,0,0,.65)";
        g.strokeText(o.text, o.x * W, o.y * H);
        g.fillStyle = o.color;
        g.fillText(o.text, o.x * W, o.y * H);
      } else {
        const img = sources.get(o.src)?.el;
        if (img instanceof HTMLImageElement && img.naturalWidth) {
          const w = o.size * W;
          const hh = w * (img.naturalHeight / img.naturalWidth);
          g.drawImage(img, o.x * W - w / 2, o.y * H - hh / 2, w, hh);
        }
      }
    }
    g.globalAlpha = 1;
  }
  function fit(el: HTMLVideoElement | HTMLImageElement, x: number, y: number, W: number, H: number) {
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const hh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !hh || (el instanceof HTMLVideoElement && el.readyState < 2)) return;
    const k = Math.min(W / w, H / hh);
    g.drawImage(el, x + (W - w * k) / 2, y + (H - hh * k) / 2, w * k, hh * k);
  }

  // ---- audio graph ----
  function audio() {
    if (!actx) {
      actx = new AudioContext();
      master = actx.createGain();
      tap = actx.createMediaStreamDestination();
      master.connect(actx.destination);
      master.connect(tap);
    }
    return actx;
  }
  function route(s: Source) {
    if (s.gain || !(s.el instanceof HTMLVideoElement)) return;
    const c = audio();
    s.gain = c.createGain();
    c.createMediaElementSource(s.el).connect(s.gain);
    s.gain.connect(master!);
  }

  // ---- playback ----
  const pauseAll = () => {
    for (const s of sources.values()) if (s.el instanceof HTMLVideoElement) s.el.pause();
    audioNode?.stop();
    audioNode = undefined;
  };
  function enter(loc: { clip: Clip; local: number }) {
    for (const s of sources.values()) if (s.el instanceof HTMLVideoElement) s.el.pause();
    active = loc.clip;
    const s = sources.get(loc.clip.src);
    if (s && s.el instanceof HTMLVideoElement) {
      route(s);
      if (s.gain) s.gain.gain.value = loc.clip.mute ? 0 : 1;
      s.el.currentTime = loc.clip.in + loc.local;
      if (playing) void s.el.play().catch(() => {});
    }
  }
  function startAudio() {
    audioNode?.stop();
    audioNode = undefined;
    if (!audioBuf || !p.audio || !actx || !master) return;
    const node = actx.createBufferSource();
    const gain = actx.createGain();
    gain.gain.value = p.audio.volume;
    node.buffer = audioBuf;
    node.connect(gain).connect(master);
    const offset = t - p.audio.start;
    if (offset >= audioBuf.duration) return;
    node.start(offset < 0 ? actx.currentTime - offset : 0, Math.max(0, offset));
    audioNode = node;
  }
  async function seek(time: number) {
    const was = playing;
    stop();
    t = clamp(time, 0, total());
    const loc = locate(t);
    if (loc) {
      enter(loc);
      const s = sources.get(loc.clip.src);
      if (s?.el instanceof HTMLVideoElement && Math.abs(s.el.currentTime - (loc.clip.in + loc.local)) > 0.001) {
        await new Promise<void>(r => {
          const done = () => r();
          s.el.addEventListener("seeked", done, { once: true });
          setTimeout(done, 600);
        });
      }
    } else active = undefined;
    draw();
    ui();
    if (was) play();
  }
  function play() {
    if (playing || !p.clips.length) return;
    if (t >= total() - 0.01) t = 0;
    audio();
    void actx!.resume();
    playing = true;
    from = t;
    wall = performance.now();
    const loc = locate(t);
    if (loc) enter(loc);
    startAudio();
    const loop = () => {
      if (!playing) return;
      t = from + (performance.now() - wall) / 1000;
      if (t >= total()) {
        t = total();
        stop();
        draw();
        ui();
        const f = onEnd;
        onEnd = undefined;
        f?.();
        return;
      }
      const l = locate(t)!;
      if (l.clip !== active) enter(l);
      else {
        const s = sources.get(l.clip.src);
        if (s?.el instanceof HTMLVideoElement && Math.abs(s.el.currentTime - (l.clip.in + l.local)) > 0.3)
          s.el.currentTime = l.clip.in + l.local;
      }
      draw();
      ui();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    ui();
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    pauseAll();
    ui();
  }

  // ---- project edits (every mutation snapshots for undo) ----
  const snap = () => {
    history.push(JSON.stringify(p));
    if (history.length > 100) history.shift();
  };
  function edit(fn: () => void) {
    snap();
    fn();
    t = clamp(t, 0, total());
    redraw();
  }
  function redraw() {
    draw();
    ui();
    tl();
    inspector();
  }
  function undo() {
    const last = history.pop();
    if (!last) return;
    p = JSON.parse(last) as Project;
    sel = null;
    t = clamp(t, 0, total());
    redraw();
  }
  const say = (m: string) => {
    status = m;
    ui();
  };

  // ---- media ----
  async function addSource(name: string, blob: Blob, path?: string): Promise<Source | undefined> {
    const kind = IMG.test(name) || blob.type.startsWith("image/") ? "image" : "video";
    let key = path ?? "";
    if (!key) {
      key = `${DIR}/media/${name}`;
      try {
        const old = os.fs.read(key);
        if (old.byteLength !== blob.size) key = `${DIR}/media/${Date.now()}-${name}`;
      } catch {
        // New name: copy below.
      }
      if (blob.size <= MAX_COPY) {
        try {
          os.fs.mkdir(`${DIR}/media`);
          os.fs.write(key, new Uint8Array(await blob.arrayBuffer()));
        } catch (error) {
          say(`Not copied into Files: ${String(error)}`);
        }
      } else key = `device:${name}`;
    }
    const known = sources.get(key);
    if (known) return known;
    const url = URL.createObjectURL(blob);
    let el: HTMLVideoElement | HTMLImageElement;
    let duration = 4;
    if (kind === "image") {
      el = new Image();
      el.src = url;
      try {
        await el.decode();
      } catch {
        URL.revokeObjectURL(url);
        say(`Cannot decode image ${name}`);
        return;
      }
    } else {
      const v = document.createElement("video");
      v.preload = "auto";
      v.playsInline = true;
      v.src = url;
      const ok = await new Promise<boolean>(r => {
        v.onloadeddata = () => r(true);
        v.onerror = () => r(false);
      });
      if (ok && v.duration === Infinity) {
        // MediaRecorder WebM (including our own exports) has no duration header: seeking far forces the scan.
        await new Promise<void>(r => {
          v.ontimeupdate = () => {
            v.ontimeupdate = null;
            r();
          };
          v.currentTime = 1e101;
          setTimeout(r, 2000);
        });
        v.currentTime = 0;
      }
      if (!ok || !Number.isFinite(v.duration)) {
        URL.revokeObjectURL(url);
        say(`Cannot decode ${name} in this browser`);
        return;
      }
      el = v;
      duration = v.duration;
    }
    const s: Source = { key, name, kind, blob, url, el, duration };
    sources.set(key, s);
    return s;
  }
  const fromVfs = async (path: string) => {
    try {
      const bytes = os.fs.read(path);
      const name = path.split("/").pop() ?? path;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const type = IMG.test(name) ? (ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`) : VID.test(name) ? `video/${ext === "mov" || ext === "m4v" ? "mp4" : ext}` : "";
      return addSource(name, new Blob([bytes as BlobPart], { type }), path);
    } catch (error) {
      say(`Cannot open ${path}: ${String(error)}`);
      return undefined;
    }
  };
  function placeClip(s: Source) {
    edit(() => {
      p.clips.push({ id: p.next++, src: s.key, in: 0, out: s.kind === "image" ? 4 : s.duration });
      if (p.clips.length === 1 && s.el instanceof HTMLVideoElement && s.el.videoWidth) {
        p.width = s.el.videoWidth >= s.el.videoHeight ? 1280 : 720;
        p.height = s.el.videoWidth >= s.el.videoHeight ? 720 : 1280;
      }
    });
    void seek(t);
  }
  async function addFiles(files: FileList | File[]) {
    for (const f of files) {
      if (AUD.test(f.name) || f.type.startsWith("audio/")) await setAudio(f.name, f);
      else {
        const s = await addSource(f.name, f);
        if (s) placeClip(s);
      }
    }
    await os.flush();
  }
  async function setAudio(name: string, blob: Blob) {
    try {
      const c = audio();
      audioBuf = await c.decodeAudioData(await blob.arrayBuffer());
      let key = `${DIR}/media/${name}`;
      if (blob.size <= MAX_COPY) {
        os.fs.mkdir(`${DIR}/media`);
        os.fs.write(key, new Uint8Array(await blob.arrayBuffer()));
      } else key = `device:${name}`;
      edit(() => (p.audio = { src: key, start: 0, volume: 0.8 }));
      say(`Audio track: ${name}`);
    } catch (error) {
      say(`Cannot decode audio: ${String(error)}`);
    }
  }

  // ---- project files ----
  async function save(): Promise<string> {
    os.fs.mkdir(DIR);
    const path = `${DIR}/${p.name.replace(/[^\w.-]+/g, "_")}.bunvideo.json`;
    os.fs.write(path, new TextEncoder().encode(JSON.stringify(p, null, 2)));
    await os.flush();
    say(`Saved ${path}`);
    return path;
  }
  async function open(path: string) {
    try {
      const doc = JSON.parse(new TextDecoder().decode(os.fs.read(path))) as Project;
      if (doc.format !== FORMAT || doc.version !== 1) throw new Error("not a Bun OS video project");
      stop();
      p = doc;
      sel = null;
      history.length = 0;
      const missing: string[] = [];
      const keys = new Set([...p.clips.map(c => c.src), ...p.overlays.filter(o => o.type === "image").map(o => o.src)]);
      for (const k of keys) if (k.startsWith("/") ? !(await fromVfs(k)) : true) missing.push(k);
      if (p.audio?.src.startsWith("/")) {
        try {
          audioBuf = await audio().decodeAudioData(os.fs.read(p.audio.src).slice().buffer as ArrayBuffer);
        } catch {
          missing.push(p.audio.src);
        }
      }
      t = 0;
      redraw();
      await seek(0);
      say(missing.length ? `Opened; missing media: ${missing.join(", ")}` : `Opened ${path}`);
      nameIn.value = p.name;
    } catch (error) {
      say(`Cannot open project: ${String(error)}`);
    }
  }
  function scan(dir: string, depth: number, out: string[]) {
    try {
      for (const r of JSON.parse(os.fs.list(dir)) as { name: string; kind: string }[]) {
        const path = `${dir === "/" ? "" : dir}/${r.name}`;
        if (r.kind === "dir") {
          if (depth > 0) scan(path, depth - 1, out);
        } else if (mimeOf(r.name)) out.push(path);
      }
    } catch {
      // Missing directory: nothing to list.
    }
    return out;
  }

  // ---- export (real time: MediaRecorder on the canvas stream, audio from the WebAudio tap) ----
  async function exportWebm() {
    if (exporting || !p.clips.length) return;
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(m =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) return say("This browser cannot record WebM");
    exporting = true;
    audio();
    await actx!.resume();
    stop();
    await seek(0);
    const stream = canvas.captureStream(p.fps);
    tap!.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const parts: Blob[] = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    const done = new Promise<void>(r => (rec.onstop = () => r()));
    rec.start(500);
    onEnd = () => setTimeout(() => rec.stop(), 250);
    play();
    say("Exporting in real time...");
    await done;
    exporting = false;
    const blob = new Blob(parts, { type: "video/webm" });
    try {
      os.fs.mkdir(DIR);
      const path = `${DIR}/${p.name.replace(/[^\w.-]+/g, "_")}.webm`;
      os.fs.write(path, new Uint8Array(await blob.arrayBuffer()));
      await os.flush();
      lastExport = blob;
      say(`Exported ${path} (${(blob.size / 1048576).toFixed(1)} MiB)`);
    } catch (error) {
      say(`Export finished but could not be saved to Files: ${String(error)}`);
    }
  }
  let lastExport: Blob | undefined;

  // ---- hand-off to the installed Aphrody Video package ----
  async function handOff() {
    const path = await save();
    const files: File[] = [];
    for (const k of new Set(p.clips.map(c => c.src))) {
      const s = sources.get(k);
      if (s) files.push(new File([s.blob], s.name, { type: s.blob.type }));
    }
    if (lastExport) files.push(new File([lastExport], `${p.name}.webm`, { type: "video/webm" }));
    if (!opts.openFilm) return say(`Saved ${path}. Install Aphrody Video from the App Store to continue.`);
    opts.openFilm();
    say("Opening Aphrody Video...");
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      const frame = document.querySelector<HTMLIFrameElement>('iframe[src^="/apps/craft-film"]');
      const api = (frame?.contentWindow as (Window & { filmcraft?: { importFiles(f: File[]): Promise<unknown> } }) | null)
        ?.filmcraft;
      if (api?.importFiles) {
        try {
          await api.importFiles(files);
          return say(`Sent ${files.length} media file(s) to Aphrody Video`);
        } catch (error) {
          return say(`Aphrody Video import failed: ${String(error)}`);
        }
      }
    }
    say("Aphrody Video did not become ready; import the media from Files");
  }

  // ---- UI ----
  const btn = (label: string, fn: () => void, cls = "", title = "") =>
    h("button", { class: `vs-b ${cls}`.trim(), onclick: fn, title: title || label, "aria-label": title || label }, label);
  const nameIn = h("input", {
    class: "fld vs-name",
    value: p.name,
    "aria-label": "Project name",
    onchange: (e: Event) => {
      snap();
      p.name = (e.target as HTMLInputElement).value.trim() || "untitled";
    },
  });
  const device = h("input", {
    type: "file",
    multiple: true,
    accept: "video/*,image/*,audio/*",
    hidden: true,
    onchange: (e: Event) => {
      const i = e.target as HTMLInputElement;
      if (i.files?.length) void addFiles(Array.from(i.files));
      i.value = "";
    },
  });
  const library = h("select", { class: "fld vs-lib", "aria-label": "Add from Files" }, h("option", { value: "" }, "From Files..."));
  const fillLibrary = () => {
    const items = scan(HOME, 3, []);
    library.replaceChildren(
      h("option", { value: "" }, items.length ? "From Files..." : "No media in Files"),
      ...items.map(i => h("option", { value: i }, i.replace(`${HOME}/`, ""))),
    );
  };
  library.addEventListener("focus", fillLibrary);
  library.addEventListener("change", async () => {
    const v = library.value;
    library.value = "";
    if (!v) return;
    if (AUD.test(v)) {
      try {
        await setAudio(v.split("/").pop()!, new Blob([os.fs.read(v) as BlobPart]));
      } catch (error) {
        say(String(error));
      }
    } else {
      const s = await fromVfs(v);
      if (s) placeClip(s);
    }
  });
  const sizeSel = h(
    "select",
    {
      class: "fld",
      "aria-label": "Canvas size",
      onchange: (e: Event) => {
        const [w, hh] = (e.target as HTMLSelectElement).value.split("x").map(Number) as [number, number];
        edit(() => {
          p.width = w;
          p.height = hh;
        });
      },
    },
    ...["1280x720", "1920x1080", "720x1280", "1080x1080"].map(v => h("option", { value: v }, v)),
  );
  const play$ = btn("play", () => (playing ? stop() : play()), "vs-ic", "Play / pause (Space)");
  const time$ = h("span", { class: "vs-time", "aria-live": "off" });
  const status$ = h("span", { class: "vs-status", role: "status" });
  const scrub = h("input", {
    type: "range",
    class: "vs-scrub",
    min: 0,
    max: 1000,
    value: 0,
    "aria-label": "Scrubber",
    oninput: (e: Event) => {
      const f = Number((e.target as HTMLInputElement).value) / 1000;
      void seek(f * total());
    },
  });
  const tlBox = h("div", { class: "vs-tl", tabindex: 0 });
  const insp = h("div", { class: "vs-insp" });

  function ui() {
    play$.textContent = "";
    play$.append(playing ? "pause" : "play_arrow");
    play$.className = "vs-b vs-ic material-symbols-rounded";
    time$.textContent = `${fmt(t)} / ${fmt(total())}`;
    status$.textContent = exporting ? "Exporting in real time..." : status;
    const tot = total();
    scrub.value = String(tot ? Math.round((t / tot) * 1000) : 0);
    const head = tlBox.querySelector<HTMLElement>(".vs-head");
    if (head) head.style.left = `${t * pps + 8}px`;
  }

  function block(cls: string, left: number, width: number, label: string, selected: boolean, onClick: () => void) {
    const b = h("div", { class: `vs-blk ${cls}${selected ? " sel" : ""}`, role: "button", tabindex: 0, title: label }, h("span", {}, label));
    b.style.left = `${left * pps + 8}px`;
    b.style.width = `${Math.max(6, width * pps)}px`;
    b.addEventListener("click", ev => {
      ev.stopPropagation();
      onClick();
    });
    b.addEventListener("keydown", ev => ev.key === "Enter" && onClick());
    return b;
  }
  function tl() {
    const tot = Math.max(total(), 10);
    const width = tot * pps + 40;
    const ruler = h("div", { class: "vs-ruler" });
    for (let s = 0; s <= tot; s++) {
      const tick = h("span", { class: "vs-tick" }, s % 5 === 0 || pps >= 60 ? `${s}s` : "");
      tick.style.left = `${s * pps + 8}px`;
      ruler.append(tick);
    }
    const scrubTo = (e: PointerEvent, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      void seek((e.clientX - r.left - 8) / pps);
    };
    ruler.addEventListener("pointerdown", e => {
      ruler.setPointerCapture(e.pointerId);
      scrubTo(e, ruler);
      const move = (m: PointerEvent) => scrubTo(m, ruler);
      ruler.addEventListener("pointermove", move);
      ruler.addEventListener("pointerup", () => ruler.removeEventListener("pointermove", move), { once: true });
    });
    const main = h("div", { class: "vs-lane" });
    let at = 0;
    p.clips.forEach(c => {
      const s = sources.get(c.src);
      main.append(
        block(`clip ${s?.kind ?? "missing"}`, at, dur(c), s?.name ?? c.src, sel?.kind === "clip" && sel.id === c.id, () => {
          sel = { kind: "clip", id: c.id };
          tl();
          inspector();
        }),
      );
      at += dur(c);
    });
    const ov = h("div", { class: "vs-lane" });
    for (const o of p.overlays) {
      const b = block(`ov ${o.type}`, o.start, o.dur, o.type === "text" ? o.text : (sources.get(o.src)?.name ?? "image"), sel?.kind === "ov" && sel.id === o.id, () => {
        sel = { kind: "ov", id: o.id };
        tl();
        inspector();
      });
      b.addEventListener("pointerdown", e => {
        const startX = e.clientX;
        const o0 = o.start;
        const d0 = o.dur;
        const edge = e.offsetX > b.clientWidth - 8;
        let moved = false;
        const move = (m: PointerEvent) => {
          const dt = (m.clientX - startX) / pps;
          if (Math.abs(m.clientX - startX) > 3 && !moved) {
            moved = true;
            snap();
          }
          if (!moved) return;
          if (edge) o.dur = Math.max(0.2, d0 + dt);
          else o.start = Math.max(0, o0 + dt);
          b.style.left = `${o.start * pps + 8}px`;
          b.style.width = `${o.dur * pps}px`;
          draw();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          if (moved) {
            tl();
            inspector();
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      });
      ov.append(b);
    }
    const au = h("div", { class: "vs-lane" });
    if (p.audio && audioBuf)
      au.append(
        block("aud", p.audio.start, Math.min(audioBuf.duration, Math.max(0, tot - p.audio.start)), p.audio.src.split("/").pop() ?? "audio", sel?.kind === "audio", () => {
          sel = { kind: "audio", id: 0 };
          tl();
          inspector();
        }),
      );
    const head = h("div", { class: "vs-head" });
    head.style.left = `${t * pps + 8}px`;
    const labels = h("div", { class: "vs-labels" }, h("div", {}, ""), h("div", {}, "Video"), h("div", {}, "Overlays"), h("div", {}, "Audio"));
    const body = h("div", { class: "vs-tracks" }, ruler, main, ov, au, head);
    body.style.width = `${width}px`;
    const scroll = tlBox.querySelector<HTMLElement>(".vs-scroll");
    const left = scroll?.scrollLeft ?? 0;
    const sc = h("div", { class: "vs-scroll" }, body);
    tlBox.replaceChildren(labels, sc);
    sc.scrollLeft = left;
  }

  const num = (label: string, value: number, step: number, set: (v: number) => void, min = 0, max = 1e6) => {
    const i = h("input", { type: "number", class: "fld vs-num", value: Number(value.toFixed(3)), step, min, max, "aria-label": label });
    i.addEventListener("change", () => edit(() => set(clamp(Number(i.value) || 0, min, max))));
    return h("label", { class: "vs-f" }, h("span", {}, label), i);
  };
  function inspector() {
    const rows: HTMLElement[] = [];
    const clip = sel?.kind === "clip" ? p.clips.find(c => c.id === sel!.id) : undefined;
    const ov = sel?.kind === "ov" ? p.overlays.find(o => o.id === sel!.id) : undefined;
    if (clip) {
      const s = sources.get(clip.src);
      const max = s?.kind === "image" ? 3600 : (s?.duration ?? clip.out);
      rows.push(
        h("div", { class: "vs-h" }, s?.name ?? clip.src),
        num("In (s)", clip.in, 0.1, v => (clip.in = Math.min(v, clip.out - 0.1)), 0, max),
        num("Out (s)", clip.out, 0.1, v => (clip.out = Math.max(v, clip.in + 0.1)), 0, max),
        h(
          "label",
          { class: "vs-f" },
          h("span", {}, "Mute clip audio"),
          h("input", { type: "checkbox", checked: !!clip.mute, onchange: (e: Event) => edit(() => (clip.mute = (e.target as HTMLInputElement).checked)) }),
        ),
      );
    } else if (ov) {
      rows.push(h("div", { class: "vs-h" }, ov.type === "text" ? "Text overlay" : "Image overlay"));
      if (ov.type === "text") {
        const ti = h("input", { class: "fld", value: ov.text, "aria-label": "Text" });
        ti.addEventListener("change", () => edit(() => (ov.text = ti.value)));
        const ci = h("input", { type: "color", value: ov.color, "aria-label": "Colour" });
        ci.addEventListener("change", () => edit(() => (ov.color = ci.value)));
        rows.push(h("label", { class: "vs-f" }, h("span", {}, "Text"), ti), h("label", { class: "vs-f" }, h("span", {}, "Colour"), ci));
      }
      rows.push(
        num("Start (s)", ov.start, 0.1, v => (ov.start = v)),
        num("Duration (s)", ov.dur, 0.1, v => (ov.dur = Math.max(0.2, v))),
        num("X (0-1)", ov.x, 0.05, v => (ov.x = v), 0, 1),
        num("Y (0-1)", ov.y, 0.05, v => (ov.y = v), 0, 1),
        num(ov.type === "text" ? "Size (of height)" : "Width (of frame)", ov.size, 0.02, v => (ov.size = v), 0.02, 1),
      );
    } else if (sel?.kind === "audio" && p.audio) {
      rows.push(
        h("div", { class: "vs-h" }, "Audio track"),
        num("Start (s)", p.audio.start, 0.1, v => (p.audio!.start = v)),
        num("Volume", p.audio.volume, 0.05, v => (p.audio!.volume = v), 0, 2),
      );
    } else {
      rows.push(
        h("div", { class: "vs-h" }, "Project"),
        h("div", { class: "vs-note" }, "Select a clip, overlay or the audio track on the timeline. Space plays, S splits at the playhead, Delete removes the selection, Ctrl+Z undoes."),
      );
    }
    insp.replaceChildren(...rows);
  }

  // ---- actions ----
  function split() {
    const loc = locate(t);
    if (!loc || loc.local < 0.05 || dur(loc.clip) - loc.local < 0.05) return;
    edit(() => {
      const c = loc.clip;
      const i = p.clips.indexOf(c);
      const cut = c.in + loc.local;
      p.clips.splice(i, 1, { ...c, out: cut }, { ...c, id: p.next++, in: cut });
    });
  }
  function remove() {
    if (!sel) return;
    const s = sel;
    edit(() => {
      if (s.kind === "clip") p.clips = p.clips.filter(c => c.id !== s.id);
      else if (s.kind === "ov") p.overlays = p.overlays.filter(o => o.id !== s.id);
      else {
        p.audio = null;
        audioBuf = undefined;
      }
      sel = null;
    });
    void seek(t);
  }
  function move(d: -1 | 1) {
    if (sel?.kind !== "clip") return;
    const i = p.clips.findIndex(c => c.id === sel!.id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= p.clips.length) return;
    edit(() => {
      const [c] = p.clips.splice(i, 1);
      p.clips.splice(j, 0, c!);
    });
    void seek(t);
  }
  function addText() {
    edit(() => {
      const o: Overlay = { id: p.next++, type: "text", start: t, dur: 3, x: 0.5, y: 0.85, size: 0.08, color: "#ffffff", text: "Title", src: "" };
      p.overlays.push(o);
      sel = { kind: "ov", id: o.id };
    });
  }
  const imagePick = h("input", {
    type: "file",
    accept: "image/*",
    hidden: true,
    onchange: async (e: Event) => {
      const i = e.target as HTMLInputElement;
      const f = i.files?.[0];
      i.value = "";
      if (!f) return;
      const s = await addSource(f.name, f);
      if (!s || s.kind !== "image") return;
      edit(() => {
        const o: Overlay = { id: p.next++, type: "image", start: t, dur: 3, x: 0.5, y: 0.5, size: 0.3, color: "#fff", text: "", src: s.key };
        p.overlays.push(o);
        sel = { kind: "ov", id: o.id };
      });
      await os.flush();
    },
  });

  root.className = "vs";
  root.tabIndex = 0;
  root.addEventListener("keydown", e => {
    const tg = e.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tg.tagName)) return;
    if (e.key === " ") (e.preventDefault(), playing ? stop() : play());
    else if (e.key === "s" && !e.ctrlKey) split();
    else if (e.key === "Delete" || e.key === "Backspace") remove();
    else if (e.key === "z" && e.ctrlKey) (e.preventDefault(), undo());
    else if (e.key === "ArrowLeft") void seek(t - 1 / p.fps);
    else if (e.key === "ArrowRight") void seek(t + 1 / p.fps);
  });
  root.append(
    h(
      "div",
      { class: "vs-bar" },
      nameIn,
      btn("Add media", () => device.click(), "", "Add media from this device"),
      library,
      btn("Text", addText, "", "Add a text overlay"),
      btn("Image", () => imagePick.click(), "", "Add an image overlay"),
      sizeSel,
      btn("Save", () => void save(), "", "Save the project into Files"),
      btn("Open", async () => {
        const path = await ask("Open project", "Path in Files", `${DIR}/${p.name}.bunvideo.json`);
        if (path) await open(path);
      }),
      btn("Export WebM", () => void exportWebm(), "prime", "Record the composition to WebM in Files"),
      btn("Open in Aphrody Video", () => void handOff(), "", "Save, then send the media to the Aphrody Video editor"),
      device,
      imagePick,
    ),
    h(
      "div",
      { class: "vs-main" },
      h("div", { class: "vs-view" }, h("div", { class: "vs-stage" }, canvas)),
      insp,
    ),
    h(
      "div",
      { class: "vs-trans" },
      play$,
      btn("content_cut", split, "vs-ic material-symbols-rounded", "Split at playhead (S)"),
      btn("arrow_back", () => move(-1), "vs-ic material-symbols-rounded", "Move clip earlier"),
      btn("arrow_forward", () => move(1), "vs-ic material-symbols-rounded", "Move clip later"),
      btn("delete", remove, "vs-ic material-symbols-rounded", "Delete selection"),
      btn("undo", undo, "vs-ic material-symbols-rounded", "Undo (Ctrl+Z)"),
      time$,
      scrub,
      btn("remove", () => ((pps = Math.max(20, pps - 20)), tl()), "vs-ic material-symbols-rounded", "Zoom out"),
      btn("add", () => ((pps = Math.min(240, pps + 20)), tl()), "vs-ic material-symbols-rounded", "Zoom in"),
    ),
    tlBox,
    status$,
  );
  // Glyph buttons use text content as the icon name; restore it after h() put the label in.
  root.querySelectorAll<HTMLElement>(".vs-ic").forEach(b => b.classList.add("material-symbols-rounded"));
  draw();
  tl();
  inspector();
  ui();
  fillLibrary();
  say(`Add media from your device or Files. Projects and exports are saved in ${DIR}.`);
  const cleanup = new MutationObserver(() => {
    if (!root.isConnected) {
      stop();
      for (const s of sources.values()) URL.revokeObjectURL(s.url);
      void actx?.close();
      cleanup.disconnect();
    }
  });
  if (root.parentElement) cleanup.observe(root.parentElement, { childList: true, subtree: true });
}
