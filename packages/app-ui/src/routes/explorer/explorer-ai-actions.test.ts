// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import type { File } from "@aphrody/drive-client";
import {
  isOcrEligible,
  isAudioVideoEligible,
  buildAskAphrodyPrompt,
  getFilePhysicalPath,
  classifyAttachment,
  buildTurnInputItems,
  OCR_EXTENSIONS,
  AUDIO_VIDEO_EXTENSIONS,
} from "./ai-helpers";

const makeFile = (id: string, name: string, ext: string, kind?: string, path?: string): File => ({
  id,
  name,
  extension: ext,
  size: 1024,
  mime_type: null,
  type: { mime: null, kind: kind ?? "unknown" },
  kind: "File",
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-01-01T00:00:00Z",
  sd_path: path ? ({ Physical: { path } } as any) : ({} as any),
  tags: [],
  metadata: null,
  image_media_data: null,
  video_media_data: null,
  audio_media_data: null,
  document_media_data: null,
  content_identity: kind ? { uuid: id, hash: null, kind: kind as any } : null,
  sidecars: [],
});

describe("Explorer AI Contextual Actions", () => {
  it("identifies OCR eligibility for images and PDFs", () => {
    const image = makeFile("1", "diagram.png", "png");
    const pdf = makeFile("2", "report.pdf", "pdf");
    const text = makeFile("3", "notes.txt", "txt");
    const audio = makeFile("4", "voice.mp3", "mp3");
    const jpeg = makeFile("5", "photo.jpg", "jpg");

    expect(isOcrEligible(image)).toBe(true);
    expect(isOcrEligible(pdf)).toBe(true);
    expect(isOcrEligible(jpeg)).toBe(true);
    expect(isOcrEligible(text)).toBe(false);
    expect(isOcrEligible(audio)).toBe(false);
  });

  it("identifies audio/video eligibility for transcription", () => {
    const audio = makeFile("1", "speech.m4a", "m4a");
    const video = makeFile("2", "presentation.mp4", "mp4");
    const wav = makeFile("3", "recording.wav", "wav");
    const doc = makeFile("4", "document.docx", "docx");

    expect(isAudioVideoEligible(audio)).toBe(true);
    expect(isAudioVideoEligible(video)).toBe(true);
    expect(isAudioVideoEligible(wav)).toBe(true);
    expect(isAudioVideoEligible(doc)).toBe(false);
  });

  it("extracts physical path correctly", () => {
    const withPath = makeFile("1", "doc.pdf", "pdf", undefined, "C:/docs/doc.pdf");
    const withoutPath = makeFile("2", "doc.pdf", "pdf");

    expect(getFilePhysicalPath(withPath)).toBe("C:/docs/doc.pdf");
    expect(getFilePhysicalPath(withoutPath)).toBeNull();
  });

  it("builds single file prompt for Demander à Aphrody", () => {
    const file = makeFile("1", "rapport.pdf", "pdf", undefined, "C:/docs/rapport.pdf");
    const { prompt, parentDir, targetPaths } = buildAskAphrodyPrompt([file]);

    expect(prompt).toContain('À propos du fichier "rapport.pdf"');
    expect(prompt).toContain("C:/docs/rapport.pdf");
    expect(parentDir).toBe("C:/docs");
    expect(targetPaths).toEqual(["C:/docs/rapport.pdf"]);
  });

  it("builds multi-file prompt with context references", () => {
    const f1 = makeFile("1", "img1.png", "png", undefined, "C:/photos/img1.png");
    const f2 = makeFile("2", "notes.md", "md", undefined, "C:/photos/notes.md");
    const { prompt, parentDir, targetPaths } = buildAskAphrodyPrompt([f1, f2]);

    expect(prompt).toContain("À propos des fichiers sélectionnés :");
    expect(prompt).toContain("- C:/photos/img1.png");
    expect(prompt).toContain("- C:/photos/notes.md");
    expect(parentDir).toBe("C:/photos");
    expect(targetPaths).toEqual(["C:/photos/img1.png", "C:/photos/notes.md"]);
  });

  it("builds directory context prompt", () => {
    const dir: File = {
      ...makeFile("dir1", "ProjetAphrody", "", undefined, "C:/src/ProjetAphrody"),
      kind: "Directory",
    };
    const { prompt, parentDir, targetPaths } = buildAskAphrodyPrompt([dir]);

    expect(prompt).toContain('À propos du dossier "ProjetAphrody"');
    expect(prompt).toContain("C:/src/ProjetAphrody");
    expect(parentDir).toBe("C:/src/ProjetAphrody");
    expect(targetPaths).toEqual(["C:/src/ProjetAphrody"]);
  });

  it("has comprehensive OCR and Audio/Video extension registries", () => {
    expect(OCR_EXTENSIONS.has("pdf")).toBe(true);
    expect(OCR_EXTENSIONS.has("png")).toBe(true);
    expect(OCR_EXTENSIONS.has("webp")).toBe(true);
    expect(OCR_EXTENSIONS.has("heic")).toBe(true);

    expect(AUDIO_VIDEO_EXTENSIONS.has("mp3")).toBe(true);
    expect(AUDIO_VIDEO_EXTENSIONS.has("wav")).toBe(true);
    expect(AUDIO_VIDEO_EXTENSIONS.has("mp4")).toBe(true);
    expect(AUDIO_VIDEO_EXTENSIONS.has("mkv")).toBe(true);
  });

  it("classifies attachments correctly into images, audio/video, files, and links", () => {
    expect(classifyAttachment("https://github.com/aphrody-labs/aphrody").kind).toBe("link");
    expect(classifyAttachment("http://localhost:3000/api").isUrl).toBe(true);

    expect(classifyAttachment("C:/images/screenshot.png").kind).toBe("image");
    expect(classifyAttachment("C:/images/photo.jpeg").extension).toBe("jpeg");
    expect(classifyAttachment("diagram.webp").kind).toBe("image");

    expect(classifyAttachment("C:/audio/speech.wav").kind).toBe("audio_video");
    expect(classifyAttachment("video.mp4").kind).toBe("audio_video");

    expect(classifyAttachment("C:/code/main.rs").kind).toBe("file");
    expect(classifyAttachment("document.pdf").kind).toBe("file");
  });

  it("transforms draft text and attachments into typed turn input items for models", () => {
    const text = "Analyse ces éléments et fais un résumé";
    const attachments = [
      "https://docs.aphrody.net/guide",
      "C:/data/architecture.png",
      "C:/data/recording.mp3",
      "C:/data/config.toml",
    ];

    const items = buildTurnInputItems(text, attachments);

    expect(items.length).toBe(5);
    expect(items[0]).toEqual({ type: "text", text });
    expect(items[1]).toEqual({
      type: "link",
      url: "https://docs.aphrody.net/guide",
    });
    expect(items[2]).toEqual({
      type: "image",
      path: "C:/data/architecture.png",
      mediaType: "image/png",
    });
    expect(items[3]).toEqual({ type: "file", path: "C:/data/recording.mp3" });
    expect(items[4]).toEqual({ type: "file", path: "C:/data/config.toml" });
  });

  it("handles empty draft text with attachments only", () => {
    const items = buildTurnInputItems("", ["C:/data/screen.jpg"]);
    expect(items.length).toBe(1);
    expect(items[0]).toEqual({
      type: "image",
      path: "C:/data/screen.jpg",
      mediaType: "image/jpeg",
    });
  });

  it("handles empty attachments with text only", () => {
    const items = buildTurnInputItems("Bonjour Aphrody");
    expect(items.length).toBe(1);
    expect(items[0]).toEqual({ type: "text", text: "Bonjour Aphrody" });
  });
});
