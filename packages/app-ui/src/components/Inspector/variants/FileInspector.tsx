import {
  ArrowsClockwise,
  Calendar,
  ChatCircle,
  ClockCounterClockwise,
  Cube,
  DotsThree,
  Eye,
  FilmStrip,
  Fingerprint,
  HardDrive,
  Hash,
  Image,
  Info,
  MagnifyingGlass,
  MapPin,
  Microphone,
  PaperPlaneRight,
  ShareNetwork,
  Sparkle,
  Tag as TagIcon,
  TextAa,
  Timer,
  VideoCamera,
} from "@phosphor-icons/react";
import { getIcon } from "@aphrody/assets/util";
import type { File, SdPath } from "@aphrody/drive-client";
import { toast, Icon, Button } from "@aphrody/m3-primitives";
import { askLocalAi, usesBrowserBackend } from "../../../tauri-bridge";
import { isAudioVideoEligible } from "../../../routes/explorer/ai-helpers";
import { useAskAphrody } from "../../../routes/explorer/hooks/useAskAphrody";
import { clsx } from "clsx";
import { LocationMap } from "../LocationMap";
import { useState } from "react";
import { TagSelectorButton } from "../../../components/Tags";
import { usePlatform } from "../../../contexts/PlatformContext";
import { useServer } from "../../../contexts/ServerContext";
import { useOptionalExplorer } from "../../../routes/explorer";
import { getContentKind } from "@aphrody/drive-client";
import { getDeviceIcon, useLibraryMutation, useNormalizedQuery } from "../../../contexts/SpacedriveContext";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { File as FileComponent } from "../../../routes/explorer/File";
import { formatBytes } from "../../../routes/explorer/utils";
import { Divider, InfoRow, Section, TabContent, Tabs, Tag } from "../Inspector";
import { useRefetchTagQueries } from "../../../hooks/useRefetchTagQueries";

interface FileInspectorProps {
  file: File;
}

export function FileInspector({ file }: FileInspectorProps) {
  const [activeTab, setActiveTab] = useState("overview");

  // Extract parent directory for pathScope to enable reactive sidecar updates
  const getParentPath = (): SdPath | undefined => {
    if (!file.sd_path) return undefined;

    if ("Physical" in file.sd_path) {
      const fullPath = file.sd_path.Physical.path;
      const lastSlash = fullPath.lastIndexOf("/");
      if (lastSlash === -1) return undefined;

      return {
        Physical: {
          ...file.sd_path.Physical,
          path: fullPath.substring(0, lastSlash),
        },
      };
    }

    if ("Cloud" in file.sd_path) {
      const fullPath = file.sd_path.Cloud.path;
      const lastSlash = fullPath.lastIndexOf("/");
      if (lastSlash === -1) return undefined;

      return {
        Cloud: {
          ...file.sd_path.Cloud,
          path: fullPath.substring(0, lastSlash),
        },
      };
    }

    return undefined;
  };

  const fileQuery = useNormalizedQuery<{ file_id: string }, File>({
    query: "files.by_id",
    input: { file_id: file?.id || "" },
    resourceType: "file",
    resourceId: file?.id,
    pathScope: getParentPath(),
    includeDescendants: false,
    enabled: !!file?.id,
  });

  const fileData = fileQuery.data || file;

  // Extract OCR text or transcript if present
  const ocrText = (fileData as any).extracted_text || fileData.content_identity?.text_content || null;
  const transcriptSidecar = fileData.sidecars?.find(
    (s: any) =>
      s.kind === "transcript" || s.variant === "whisper_base" || s.format === "transcript" || s.format === "srt",
  );
  const transcriptText = (fileData as any).transcript_text || (transcriptSidecar as any)?.content || null;

  const hasTranscript = isAudioVideoEligible(fileData) && (!!transcriptText || !!transcriptSidecar);
  const hasOcrText = !hasTranscript && !!ocrText;

  const tabs = [
    { id: "overview", label: "Overview", icon: Info },
    ...(hasTranscript
      ? [{ id: "transcript", label: "Transcript", icon: Microphone }]
      : hasOcrText
        ? [{ id: "text", label: "Text", icon: TextAa }]
        : []),
    { id: "sidecars", label: "Sidecars", icon: Image },
    { id: "instances", label: "Instances", icon: MapPin },
    { id: "chat", label: "Chat IA", icon: ChatCircle },
    { id: "activity", label: "Activité", icon: ClockCounterClockwise },
    { id: "details", label: "Détails", icon: DotsThree },
  ];

  return (
    <>
      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Content */}
      <div className="mt-2.5 flex flex-1 flex-col overflow-hidden">
        <TabContent id="overview" activeTab={activeTab}>
          <OverviewTab file={fileData} />
        </TabContent>

        {hasTranscript && (
          <TabContent id="transcript" activeTab={activeTab}>
            <TextTranscriptTab
              file={fileData}
              type="transcript"
              text={transcriptText || "Transcription disponible dans le fichier sidecar."}
            />
          </TabContent>
        )}

        {hasOcrText && (
          <TabContent id="text" activeTab={activeTab}>
            <TextTranscriptTab file={fileData} type="text" text={ocrText || ""} />
          </TabContent>
        )}

        <TabContent id="sidecars" activeTab={activeTab}>
          <SidecarsTab file={fileData} />
        </TabContent>

        <TabContent id="instances" activeTab={activeTab}>
          <InstancesTab file={fileData} />
        </TabContent>

        <TabContent id="chat" activeTab={activeTab}>
          <ChatTab file={fileData} />
        </TabContent>

        <TabContent id="activity" activeTab={activeTab}>
          <ActivityTab file={fileData} />
        </TabContent>

        <TabContent id="details" activeTab={activeTab}>
          <DetailsTab file={fileData} />
        </TabContent>
      </div>
    </>
  );
}

// Quick Actions Component - Share and media-job buttons
function FileQuickActions({ file }: { file: File }) {
  const platform = usePlatform();
  // Null in the pop-out inspector window, which has no explorer to overlay.
  const explorer = useOptionalExplorer();

  // AI Processing mutations
  const generateSplat = useLibraryMutation("media.splat.generate");
  const regenerateThumbnail = useLibraryMutation("media.thumbnail.regenerate");
  const generateThumbstrip = useLibraryMutation("media.thumbstrip.generate");
  const generateProxy = useLibraryMutation("media.proxy.generate");

  // Check content kind for available actions
  const isImage = getContentKind(file) === "image";
  const isVideo = getContentKind(file) === "video";
  const isAudio = getContentKind(file) === "audio";
  // Media jobs and Ask Aphrody run in the native Drive daemon and agent service; the in-browser
  // backend serves neither, so their buttons appear only where those run.
  const nativeServices = !usesBrowserBackend();
  const showJobsButton = nativeServices && (isImage || isVideo || isAudio);

  // Get physical path for sharing
  const getPhysicalPath = (): string | null => {
    if (file.sd_path && "Physical" in file.sd_path) {
      return (file.sd_path as { Physical: { path: string } }).Physical.path;
    }
    return null;
  };

  const physicalPath = getPhysicalPath();
  const canShare = !!physicalPath && !!platform.shareFiles;

  const handleShare = async () => {
    if (!physicalPath || !platform.shareFiles) {
      toast.error({
        title: "Cannot Share",
        body: "This file cannot be shared from its current location",
      });
      return;
    }

    try {
      await platform.shareFiles([physicalPath]);
    } catch (err) {
      console.error("Failed to share file:", err);
      toast.error({
        title: "Share Failed",
        body: String(err),
      });
    }
  };

  const askAphrody = useAskAphrody();

  // Jobs context menu
  const jobsMenu = useContextMenu({
    items: [
      {
        icon: Cube,
        label: "Générer un Splat 3D",
        onClick: () => {
          generateSplat.mutate({
            entry_uuid: file.id,
            model_path: null,
          });
        },
        condition: () => isImage,
      },
      // Video-only actions
      {
        icon: FilmStrip,
        label: "Generate Thumbstrip",
        onClick: () => {
          generateThumbstrip.mutate({
            entry_uuid: file.id,
            variants: ["thumbstrip_preview", "thumbstrip_detailed"],
            force: false,
          });
        },
        condition: () => isVideo,
      },
      {
        icon: VideoCamera,
        label: "Generate Scrubbing Proxy",
        onClick: () => {
          generateProxy.mutate({
            entry_uuid: file.id,
            resolution: "scrubbing",
            force: false,
            use_hardware_accel: true,
          });
        },
        condition: () => isVideo,
      },
      { type: "separator" as const },
      // Common actions
      {
        icon: ArrowsClockwise,
        label: "Regenerate Thumbnails",
        onClick: () => {
          regenerateThumbnail.mutate({
            entry_uuid: file.id,
            variants: ["grid@1x", "grid@2x", "detail@1x"],
            force: true,
          });
        },
        condition: () => isImage || isVideo,
      },
    ],
  });

  return (
    <div className="flex items-center gap-1.5">
      {/* Demander à Aphrody */}
      {nativeServices && (
        <button
          type="button"
          onClick={() => askAphrody([file])}
          className="border-outline-variant/30 bg-surface-container/20 text-on-surface-variant hover:bg-surface-container/30 hover:text-on-surface flex size-7 items-center justify-center rounded-full border transition-all active:scale-95"
          title="Demander à Aphrody"
        >
          <Icon name="auto_awesome" size={14} />
        </button>
      )}

      {/* Quick Preview Button — spacebar isn't available on touch devices */}
      {explorer && (
        <button
          type="button"
          onClick={() => explorer.openQuickPreview(file.id)}
          className="border-outline-variant/30 bg-surface-container/20 text-on-surface-variant hover:bg-surface-container/30 hover:text-on-surface flex size-7 items-center justify-center rounded-full border transition-all active:scale-95"
          title="Quick preview"
        >
          <Eye size={14} weight="bold" />
        </button>
      )}

      {/* Share Button */}
      {canShare && (
        <button
          type="button"
          onClick={handleShare}
          className="border-outline-variant/30 bg-surface-container/20 text-on-surface-variant hover:bg-surface-container/30 hover:text-on-surface flex size-7 items-center justify-center rounded-full border transition-all active:scale-95"
          title="Share"
        >
          <ShareNetwork size={14} weight="bold" />
        </button>
      )}

      {/* Jobs Button */}
      {showJobsButton && (
        <button
          type="button"
          onClick={e => jobsMenu.show(e)}
          className="border-outline-variant/30 bg-surface-container/20 text-on-surface-variant hover:bg-surface-container/30 hover:text-on-surface flex size-7 items-center justify-center rounded-full border transition-all active:scale-95"
          title="Processing jobs"
        >
          <Sparkle size={14} weight="bold" />
        </button>
      )}
    </div>
  );
}

const formatMediaDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${weekday} • ${monthDay} • ${time}`;
};

const getMegapixels = (width: number, height: number) => {
  const mp = (width * height) / 1000000;
  return mp >= 1 ? `${mp.toFixed(1)} MP` : `${(mp * 1000).toFixed(0)} KP`;
};

// Media Metadata Card Component - iOS Photos style
function MediaMetadataCard({ file }: { file: File }) {
  const imageData = file.image_media_data;
  const videoData = file.video_media_data;

  if (!imageData && !videoData) return null;

  // Format date/time like iOS: "Monday • Jan 19, 2026 • 08:00"

  // Calculate megapixels

  // Get format from extension
  const getFormat = () => {
    const ext = file.extension?.toUpperCase();
    if (!ext) return null;
    // Map common extensions to display names
    const formatMap: Record<string, string> = {
      HEIC: "HEIF",
      HEIF: "HEIF",
      JPG: "JPEG",
      JPEG: "JPEG",
      PNG: "PNG",
      WEBP: "WebP",
      RAW: "RAW",
      DNG: "DNG",
      CR2: "RAW",
      NEF: "RAW",
      ARW: "RAW",
      MOV: "MOV",
      MP4: "MP4",
      M4V: "M4V",
      WEBM: "WebM",
      MKV: "MKV",
      AVI: "AVI",
    };
    return formatMap[ext] || ext;
  };

  // Get camera display name
  const getCameraDisplay = () => {
    if (imageData?.camera_make && imageData?.camera_model) {
      return `${imageData.camera_make} ${imageData.camera_model}`;
    }
    if (imageData?.camera_model) return imageData.camera_model;
    if (imageData?.camera_make) return imageData.camera_make;
    return null;
  };

  // Get lens/camera info line (e.g., "Main Camera — 24 mm ƒ1.78")
  const getLensInfo = () => {
    const parts: string[] = [];

    if (imageData?.lens_model) {
      parts.push(imageData.lens_model);
    } else if (imageData?.focal_length) {
      // If no lens model, just show focal length
      parts.push(imageData.focal_length);
    }

    if (imageData?.aperture) {
      // Format aperture with ƒ symbol
      const aperture = imageData.aperture.replace(/^f\/?/i, "ƒ");
      if (parts.length > 0) {
        parts[parts.length - 1] += ` ${aperture}`;
      } else {
        parts.push(aperture);
      }
    }

    return parts.length > 0 ? parts.join(" — ") : null;
  };

  // Get resolution line (e.g., "12 MP • 3024 × 4032 • 2.1 MB")
  const getResolutionLine = () => {
    const parts: string[] = [];
    const width = imageData?.width || videoData?.width;
    const height = imageData?.height || videoData?.height;

    if (width && height) {
      parts.push(getMegapixels(width, height));
      parts.push(`${width} × ${height}`);
    }

    if (file.size) {
      parts.push(formatBytes(file.size));
    }

    return parts.length > 0 ? parts.join(" • ") : null;
  };

  // Get technical specs (ISO, focal length, exposure, aperture, shutter)
  const getTechSpecs = () => {
    if (!imageData) return [];

    const specs: { label: string; value: string }[] = [];

    if (imageData.iso) {
      specs.push({ label: "ISO", value: String(imageData.iso) });
    }

    if (imageData.focal_length) {
      specs.push({ label: "", value: imageData.focal_length });
    }

    // Exposure value (not typically in our data, but could be calculated)
    // For now skip this

    if (imageData.aperture) {
      const aperture = imageData.aperture.replace(/^f\/?/i, "ƒ");
      specs.push({ label: "", value: aperture });
    }

    if (imageData.shutter_speed) {
      specs.push({ label: "", value: imageData.shutter_speed });
    }

    return specs;
  };

  // Get video-specific info
  const getVideoInfo = () => {
    if (!videoData) return null;

    const parts: string[] = [];

    if (videoData.codec) {
      parts.push(videoData.codec.toUpperCase());
    }

    if (videoData.fps_num && videoData.fps_den && videoData.fps_den !== 0) {
      const fps = Math.round(videoData.fps_num / videoData.fps_den);
      parts.push(`${fps} fps`);
    }

    if (videoData.bit_rate) {
      const mbps = (videoData.bit_rate / 1000000).toFixed(1);
      parts.push(`${mbps} Mbps`);
    }

    return parts.length > 0 ? parts.join(" • ") : null;
  };

  // Get duration for video
  const getDuration = () => {
    if (!videoData?.duration_seconds) return null;
    const duration = videoData.duration_seconds;
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const mediaDate = formatMediaDate(imageData?.date_taken?.toString() || videoData?.date_captured?.toString());
  const cameraDisplay = getCameraDisplay();
  const format = getFormat();
  const lensInfo = getLensInfo();
  const resolutionLine = getResolutionLine();
  const techSpecs = getTechSpecs();
  const hasLocation = !!(imageData?.latitude && imageData?.longitude);
  const videoInfo = getVideoInfo();
  const duration = getDuration();
  const colorProfile = imageData?.color_profile;

  return (
    <div className="space-y-3">
      {/* Date/Time Header */}
      {mediaDate && (
        <div className="px-2">
          <div className="text-on-surface text-label-large font-semibold">{mediaDate}</div>
          <div className="text-on-surface-variant mt-0.5 flex items-center gap-1.5 text-body-small">
            <Image size={12} weight="bold" />
            <span>{file.name}</span>
          </div>
        </div>
      )}

      {/* Camera Info Card */}
      {(cameraDisplay || resolutionLine || videoInfo) && (
        <div className="bg-surface-container/60 border-outline-variant/50 mx-2 overflow-hidden rounded-medium border">
          {/* Camera Header */}
          {cameraDisplay && (
            <div className="border-outline-variant/30 flex items-center justify-between border-b px-3 py-2.5">
              <span className="text-on-surface text-label-large font-medium">{cameraDisplay}</span>
              <div className="flex items-center gap-1.5">
                {format && (
                  <span className="bg-surface-container border-outline-variant text-on-surface-variant rounded-small border px-1.5 py-0.5 text-[10px] font-semibold">
                    {format}
                  </span>
                )}
                {hasLocation && (
                  <span className="text-on-surface-variant">
                    <MapPin size={14} weight="fill" />
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Camera/Lens Details */}
          <div className="space-y-1 px-3 py-2.5">
            {lensInfo && <div className="text-on-surface-variant text-body-small">{lensInfo}</div>}
            {resolutionLine && <div className="text-on-surface-variant text-body-small">{resolutionLine}</div>}
            {videoInfo && <div className="text-on-surface-variant text-body-small">{videoInfo}</div>}
            {duration && (
              <div className="text-on-surface-variant flex items-center gap-1 text-body-small">
                <Timer size={12} weight="bold" />
                <span>{duration}</span>
              </div>
            )}
          </div>

          {/* Technical Specs Row */}
          {techSpecs.length > 0 && (
            <div className="border-outline-variant/30 flex items-center justify-between border-t px-3 py-2">
              {techSpecs.map(spec => (
                <div key={`${spec.label}-${spec.value}`} className="text-on-surface-variant text-center text-[11px]">
                  {spec.label && <span className="mr-0.5 font-medium">{spec.label}</span>}
                  <span>{spec.value}</span>
                </div>
              ))}
              {colorProfile && (
                <span className="bg-surface-container border-outline-variant text-on-surface-variant rounded-small border px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  {colorProfile}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Location Map */}
      {hasLocation && imageData && imageData.latitude && imageData.longitude && (
        <LocationMap
          latitude={imageData.latitude}
          longitude={imageData.longitude}
          className="bg-surface-container/60 border-outline-variant/50 mx-2 overflow-hidden rounded-medium border"
        />
      )}
    </div>
  );
}

function TextTranscriptTab({ file: _file, type, text }: { file: File; type: "transcript" | "text"; text: string }) {
  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texte copié dans le presse-papiers");
    } catch (err) {
      console.error("Failed to copy text:", err);
      toast.error("Impossible de copier le texte");
    }
  };

  const title = type === "transcript" ? "Transcription audio" : "Texte extrait (OCR)";

  return (
    <div className="no-scrollbar mask-fade-out flex flex-col space-y-4 overflow-x-hidden overflow-y-scroll px-3 pb-10 pt-2 text-body-large">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-on-surface text-title-medium font-semibold">{title}</h3>
        <Button
          variant="tonal"
          size="sm"
          onClick={handleCopy}
          disabled={!text}
          className="min-h-[44px] px-3 text-label-large font-medium"
          title="Copier le texte"
        >
          <Icon name="content_copy" size={20} />
          <span>Copier</span>
        </Button>
      </div>

      <div className="bg-surface-container/60 border-outline-variant/50 rounded-medium border p-4 shadow-xs">
        {text ? (
          <div className="text-on-surface font-sans text-body-large whitespace-pre-wrap select-text leading-relaxed">
            {text}
          </div>
        ) : (
          <p className="text-on-surface-variant text-body-large italic">Aucun contenu textuel disponible.</p>
        )}
      </div>
    </div>
  );
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function OverviewTab({ file }: { file: File }) {
  const askAphrody = useAskAphrody();

  // Tag mutations — refetch queries on success to update the UI
  const refetchTagQueries = useRefetchTagQueries();
  const applyTag = useLibraryMutation("tags.apply", {
    onSuccess: refetchTagQueries,
  });
  const unapplyTag = useLibraryMutation("tags.unapply", {
    onSuccess: refetchTagQueries,
  });

  // AI Processing mutations
  const generateSplat = useLibraryMutation("media.splat.generate");
  const regenerateThumbnail = useLibraryMutation("media.thumbnail.regenerate");
  const generateThumbstrip = useLibraryMutation("media.thumbstrip.generate");
  const generateProxy = useLibraryMutation("media.proxy.generate");

  // Check content kind for available actions
  const isImage = getContentKind(file) === "image";
  const isVideo = getContentKind(file) === "video";
  const isAudio = getContentKind(file) === "audio";
  const hasText = file?.content_identity?.text_content;
  const isEphemeral = !file.content_identity;

  const contentKind = getContentKind(file);
  const fileKind =
    contentKind && contentKind !== "unknown"
      ? contentKind
      : file.kind === "File"
        ? file.extension || "File"
        : file.kind;

  return (
    <div className="no-scrollbar mask-fade-out flex flex-col space-y-5 overflow-x-hidden overflow-y-scroll pb-10">
      {/* Thumbnail */}
      <div className="flex w-full justify-center px-4">
        <FileComponent.Thumb file={file} size={200} iconScale={0.6} className="w-full max-w-full" />
      </div>

      {/* File name & Quick Actions */}
      <div className="px-2">
        <h4 className="text-on-surface truncate text-center text-label-large font-semibold">
          {file.name}
          {file.extension ? `.${file.extension}` : ""}
        </h4>
        <p className="text-on-surface-variant mt-1 text-center text-body-large">{fileKind}</p>
        {/* Quick Actions - Share and media jobs */}
        <div className="mt-2.5">
          <FileQuickActions file={file} />
        </div>
      </div>

      {/* Canonical AI Actions */}
      <div className="flex flex-col gap-2.5 px-2">
        <Button
          variant="filled"
          size="sm"
          onClick={() => askAphrody([file])}
          className="w-full justify-start text-label-large min-h-[44px] px-3 font-medium"
          title="Demander à Aphrody avec ce fichier en contexte"
        >
          <Icon name="auto_awesome" size={20} />
          <span>Demander à Aphrody</span>
        </Button>
      </div>

      {/* Media Metadata Card - iOS Photos style */}
      {(isImage || isVideo) && (file.image_media_data || file.video_media_data) && (
        <>
          <Divider />
          <MediaMetadataCard file={file} />
        </>
      )}

      <Divider />

      {/* Details */}
      <Section title="Details" icon={Info}>
        <InfoRow label="Size" value={formatBytes(file.size)} />
        {file.kind === "File" && file.extension && <InfoRow label="Extension" value={file.extension} />}
        <InfoRow label="Kind" value={fileKind} />
      </Section>

      {/* Dates */}
      <Section title="Dates" icon={Calendar}>
        {/* Show capture date for media files */}
        {file.video_media_data?.date_captured && (
          <InfoRow label="Captured" value={formatDate(file.video_media_data.date_captured)} />
        )}
        {file.image_media_data?.date_taken && (
          <InfoRow label="Taken" value={formatDate(file.image_media_data.date_taken)} />
        )}
        <InfoRow label="Created" value={formatDate(file.created_at)} />
        <InfoRow label="Modified" value={formatDate(file.modified_at)} />
        {file.accessed_at && <InfoRow label="Accessed" value={formatDate(file.accessed_at)} />}
      </Section>

      {/* Image Metadata */}
      {file.image_media_data && (
        <Section title="Image info" icon={Image}>
          <InfoRow label="Dimensions" value={`${file.image_media_data.width} × ${file.image_media_data.height}`} />
          {file.image_media_data.camera_make && (
            <InfoRow
              label="Camera"
              value={`${file.image_media_data.camera_make} ${file.image_media_data.camera_model || ""}`}
            />
          )}
          {file.image_media_data.lens_model && <InfoRow label="Lens" value={file.image_media_data.lens_model} />}
          {file.image_media_data.iso && <InfoRow label="ISO" value={String(file.image_media_data.iso)} />}
          {file.image_media_data.focal_length && (
            <InfoRow label="Focal length" value={file.image_media_data.focal_length} />
          )}
          {file.image_media_data.aperture && <InfoRow label="Aperture" value={file.image_media_data.aperture} />}
          {file.image_media_data.shutter_speed && (
            <InfoRow label="Shutter speed" value={file.image_media_data.shutter_speed} />
          )}
        </Section>
      )}

      {/* Video Metadata */}
      {file.video_media_data && (
        <Section title="Video info" icon={Image}>
          <InfoRow label="Resolution" value={`${file.video_media_data.width} × ${file.video_media_data.height}`} />
          {file.video_media_data.duration_seconds && (
            <InfoRow
              label="Duration"
              value={`${Math.floor(file.video_media_data.duration_seconds / 60)}:${String(Math.floor(file.video_media_data.duration_seconds % 60)).padStart(2, "0")}`}
            />
          )}
          {file.video_media_data.codec && <InfoRow label="Codec" value={file.video_media_data.codec} />}
          {file.video_media_data.bit_rate && (
            <InfoRow label="Bitrate" value={`${Math.round(file.video_media_data.bit_rate / 1000000)} Mbps`} />
          )}
          {file.video_media_data.fps_num && file.video_media_data.fps_den && file.video_media_data.fps_den !== 0 && (
            <InfoRow
              label="Frame rate"
              value={`${Math.round((file.video_media_data.fps_num / file.video_media_data.fps_den) * 100) / 100} fps`}
            />
          )}
          {file.video_media_data.audio_codec && (
            <InfoRow
              label="Audio"
              value={`${file.video_media_data.audio_codec} · ${file.video_media_data.audio_channels || ""}`}
            />
          )}
        </Section>
      )}

      {/* Audio Metadata */}
      {file.audio_media_data && (
        <Section title="Audio info" icon={Image}>
          {file.audio_media_data.artist && <InfoRow label="Artist" value={file.audio_media_data.artist} />}
          {file.audio_media_data.album && <InfoRow label="Album" value={file.audio_media_data.album} />}
          {file.audio_media_data.title && <InfoRow label="Title" value={file.audio_media_data.title} />}
          {file.audio_media_data.duration_seconds && (
            <InfoRow
              label="Duration"
              value={`${Math.floor(file.audio_media_data.duration_seconds / 60)}:${String(Math.floor(file.audio_media_data.duration_seconds % 60)).padStart(2, "0")}`}
            />
          )}
          {file.audio_media_data.codec && <InfoRow label="Codec" value={file.audio_media_data.codec} />}
          {file.audio_media_data.bit_rate && (
            <InfoRow label="Bitrate" value={`${Math.round(file.audio_media_data.bit_rate / 1000)} kbps`} />
          )}
          {file.audio_media_data.genre && <InfoRow label="Genre" value={file.audio_media_data.genre} />}
          {file.audio_media_data.year && <InfoRow label="Year" value={String(file.audio_media_data.year)} />}
        </Section>
      )}

      {/* Storage */}
      <Section title="Storage" icon={HardDrive}>
        <InfoRow
          label="Path"
          value={
            "Physical" in file.sd_path
              ? String(file.sd_path.Physical.path)
              : "Cloud" in file.sd_path
                ? String(file.sd_path.Cloud.path)
                : "Content"
          }
        />
        <InfoRow label="Local" value={file.is_local ? "Yes" : "No"} />
      </Section>

      {/* Tags */}
      <Section title="Tags" icon={TagIcon}>
        {isEphemeral ? (
          <p className="text-on-surface-variant text-body-small italic">
            Tags are available after indexing this location
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {file.tags &&
              file.tags.length > 0 &&
              file.tags.map(tag => (
                <Tag
                  key={tag.id}
                  color={tag.color || "#3B82F6"}
                  size="sm"
                  onRemove={async () => {
                    try {
                      await unapplyTag.mutateAsync({
                        entry_ids: [file.id],
                        tag_ids: [tag.id],
                      });
                    } catch (err) {
                      console.error("Failed to remove tag:", err);
                      toast.error(`Failed to remove tag: ${err}`);
                    }
                  }}
                >
                  {tag.canonical_name}
                </Tag>
              ))}

            {!usesBrowserBackend() && (
              /* Add Tag Button: tags live in the native Drive daemon */
              <TagSelectorButton
                onSelect={async tag => {
                  await applyTag.mutateAsync({
                    targets: file.content_identity?.uuid
                      ? {
                          type: "Content",
                          ids: [file.content_identity.uuid],
                        }
                      : {
                          type: "EntryUuid",
                          ids: [file.id],
                        },
                    tag_ids: [tag.id],
                    source: "User",
                    confidence: 1.0,
                    applied_context: null,
                    instance_attributes: null,
                  });
                }}
                contextTags={file.tags || []}
                fileId={file.id}
                contentId={file.content_identity?.uuid}
                trigger={
                  <button className="bg-surface-container hover:bg-on-surface/8 border-outline-variant text-on-surface-variant hover:text-on-surface rounded-full border px-2 py-0.5 text-label-medium font-medium transition-colors">
                    + Add tags
                  </button>
                }
              />
            )}
          </div>
        )}
      </Section>

      {/* AI Processing: media jobs of the native Drive daemon */}
      {!usesBrowserBackend() && (isImage || isVideo || isAudio) && (
        <Section title="AI processing" icon={Sparkle}>
          <div className="flex flex-col gap-2">
            {/* Gaussian Splat for images */}
            {isImage && (
              <button
                onClick={() => {
                  console.log("Generate splat clicked for file:", file.id);
                  generateSplat.mutate(
                    {
                      entry_uuid: file.id,
                      model_path: null,
                    },
                    {
                      onSuccess: data => {
                        console.log("Splat generation success:", data);
                      },
                      onError: error => {
                        console.error("Splat generation error:", error);
                      },
                    },
                  );
                }}
                disabled={generateSplat.isPending}
                className={clsx(
                  "flex items-center gap-2 rounded-small px-3 py-2 text-label-large font-medium transition-colors",
                  "bg-surface-container hover:bg-on-surface/8 border-outline-variant border",
                  generateSplat.isPending && "cursor-not-allowed opacity-50",
                )}
              >
                <Cube size={4} weight="bold" />
                <span>{generateSplat.isPending ? "Generating..." : "Generate 3D Splat"}</span>
              </button>
            )}

            {/* Regenerate thumbnails */}
            {(isImage || isVideo) && (
              <button
                onClick={() => {
                  console.log("Regenerate thumbnails clicked for file:", file.id);
                  regenerateThumbnail.mutate(
                    {
                      entry_uuid: file.id,
                      variants: ["grid@1x", "grid@2x", "detail@1x"],
                      force: true,
                    },
                    {
                      onSuccess: data => {
                        console.log("Thumbnail regeneration success:", data);
                      },
                      onError: error => {
                        console.error("Thumbnail regeneration error:", error);

                        const errorMessage = error instanceof Error ? error.message : String(error);
                        if (
                          errorMessage.includes("feature is not enabled") ||
                          errorMessage.includes("--features ffmpeg") ||
                          errorMessage.includes("FFmpeg feature")
                        ) {
                          toast.error({
                            title: "Feature Not Available",
                            body: "Video thumbnail generation requires FFmpeg. Please rebuild the daemon with --features ffmpeg or use `cargo daemon`",
                          });
                        } else {
                          toast.error({
                            title: "Thumbnail Generation Failed",
                            body: errorMessage,
                          });
                        }
                      },
                    },
                  );
                }}
                disabled={regenerateThumbnail.isPending}
                className={clsx(
                  "flex items-center gap-2 rounded-small px-3 py-2 text-label-large font-medium transition-colors",
                  "bg-surface-container hover:bg-on-surface/8 border-outline-variant border",
                  regenerateThumbnail.isPending && "cursor-not-allowed opacity-50",
                )}
              >
                <ArrowsClockwise size={4} weight="bold" />
                <span>{regenerateThumbnail.isPending ? "Generating..." : "Regenerate Thumbnails"}</span>
              </button>
            )}

            {/* Generate thumbstrip (for videos) */}
            {isVideo && (
              <button
                onClick={() => {
                  console.log("Generate thumbstrip clicked for file:", file.id);
                  generateThumbstrip.mutate(
                    {
                      entry_uuid: file.id,
                      variants: ["thumbstrip_preview", "thumbstrip_detailed"],
                      force: false,
                    },
                    {
                      onSuccess: data => {
                        console.log("Thumbstrip generation success:", data);
                      },
                      onError: error => {
                        console.error("Thumbstrip generation error:", error);

                        const errorMessage = error instanceof Error ? error.message : String(error);
                        if (
                          errorMessage.includes("feature is not enabled") ||
                          errorMessage.includes("--features ffmpeg")
                        ) {
                          toast.error({
                            title: "Feature Not Available",
                            body: "Thumbstrip generation requires FFmpeg. Please rebuild the daemon with --features ffmpeg,heif or use `cargo daemon`",
                          });
                        } else {
                          toast.error({
                            title: "Thumbstrip Generation Failed",
                            body: errorMessage,
                          });
                        }
                      },
                    },
                  );
                }}
                disabled={generateThumbstrip.isPending}
                className={clsx(
                  "flex items-center gap-2 rounded-small px-3 py-2 text-label-large font-medium transition-colors",
                  "bg-surface-container hover:bg-on-surface/8 border-outline-variant border",
                  generateThumbstrip.isPending && "cursor-not-allowed opacity-50",
                )}
              >
                <FilmStrip size={4} weight="bold" />
                <span>{generateThumbstrip.isPending ? "Generating..." : "Generate Thumbstrip"}</span>
              </button>
            )}

            {/* Generate proxy (for videos) */}
            {isVideo && (
              <button
                onClick={() => {
                  console.log("Generate proxy clicked for file:", file.id);
                  generateProxy.mutate(
                    {
                      entry_uuid: file.id,
                      resolution: "scrubbing", // Fast scrubbing proxy
                      force: false,
                      use_hardware_accel: true,
                    },
                    {
                      onSuccess: data => {
                        console.log("Proxy generation success:", data);
                      },
                      onError: error => {
                        console.error("Proxy generation error:", error);
                      },
                    },
                  );
                }}
                disabled={generateProxy.isPending}
                className={clsx(
                  "flex items-center gap-2 rounded-small px-3 py-2 text-label-large font-medium transition-colors",
                  "bg-surface-container hover:bg-on-surface/8 border-outline-variant border",
                  generateProxy.isPending && "cursor-not-allowed opacity-50",
                )}
              >
                <VideoCamera size={4} weight="bold" />
                <span>{generateProxy.isPending ? "Encoding..." : "Generate Scrubbing Proxy"}</span>
              </button>
            )}

            {/* Show extracted text if available */}
            {hasText && (
              <div className="bg-surface-container/40 border-outline-variant/50 mt-2 rounded-small border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-primary">
                    <TextAa size={16} weight="bold" />
                  </span>
                  <span className="text-on-surface text-label-medium font-medium">Extracted text</span>
                </div>
                <pre className="text-on-surface-variant no-scrollbar max-h-40 overflow-y-auto whitespace-pre-wrap text-body-small">
                  {file.content_identity?.text_content}
                </pre>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function SidecarsTab({ file }: { file: File }) {
  const sidecars = file.sidecars || [];
  const platform = usePlatform();
  const { buildSidecarUrl, libraryId } = useServer();

  // Helper to get sidecar URL
  const getSidecarUrl = (sidecar: any) => {
    if (!file.content_identity) return null;

    return buildSidecarUrl(file.content_identity.uuid, sidecar.kind, sidecar.variant, sidecar.format);
  };

  return (
    <div className="no-scrollbar mask-fade-out flex flex-col space-y-4 overflow-x-hidden overflow-y-scroll px-2 pb-10 pt-2">
      <p className="text-on-surface-variant text-body-small">
        Derivative files and associated content generated by Spacedrive
      </p>

      {sidecars.length === 0 ? (
        <div className="text-on-surface-variant flex items-center justify-center py-8 text-body-small">
          No sidecars generated yet
        </div>
      ) : (
        <div className="space-y-2">
          {sidecars.map(sidecar => (
            <SidecarItem
              key={`${sidecar.kind}:${sidecar.variant}:${sidecar.format}`}
              sidecar={sidecar}
              file={file}
              sidecarUrl={getSidecarUrl(sidecar)}
              platform={platform}
              libraryId={libraryId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SidecarItem({
  sidecar,
  file,
  sidecarUrl,
  platform,
  libraryId,
}: {
  sidecar: any;
  file: File;
  sidecarUrl: string | null;
  platform: ReturnType<typeof usePlatform>;
  libraryId: string | null;
}) {
  const isImage =
    (sidecar.kind === "thumb" || sidecar.kind === "thumbstrip") &&
    (sidecar.format === "webp" || sidecar.format === "jpg" || sidecar.format === "png");

  // Get appropriate Spacedrive icon based on sidecar format/kind
  const getSidecarIcon = () => {
    const format = String(sidecar.format).toLowerCase();

    // PLY files (3D mesh) use Mesh icon
    if (format === "ply") {
      return getIcon("Mesh", true);
    }

    // Text files use Text icon
    if (format === "text" || format === "txt" || format === "srt") {
      return getIcon("Text", true);
    }

    // Thumbs/thumbstrips use Image icon
    if (sidecar.kind === "thumb" || sidecar.kind === "thumbstrip") {
      return getIcon("Image", true);
    }

    // Default to Document icon
    return getIcon("Document", true);
  };

  const sidecarIcon = getSidecarIcon();

  const contextMenu = useContextMenu({
    items: [
      {
        icon: MagnifyingGlass,
        label: "Show in Finder",
        onClick: async () => {
          if (platform.getSidecarPath && platform.revealFile && file.content_identity && libraryId) {
            try {
              // Convert "text" format to "txt" extension (matches actual file on disk)
              const format = sidecar.format === "text" ? "txt" : sidecar.format;
              const sidecarPath = await platform.getSidecarPath(
                libraryId,
                file.content_identity.uuid,
                sidecar.kind,
                sidecar.variant,
                format,
              );

              await platform.revealFile(sidecarPath);
            } catch (err) {
              console.error("Failed to reveal sidecar:", err);
            }
          }
        },
        condition: () => !!platform.getSidecarPath && !!platform.revealFile && !!file.content_identity && !!libraryId,
      },
    ],
  });

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await contextMenu.show(e);
  };

  return (
    <div
      onContextMenu={handleContextMenu}
      className="bg-surface-container/40 border-outline-variant/50 hover:bg-surface-container/60 flex cursor-default items-start gap-3 rounded-small border p-2.5 transition-colors"
    >
      {/* Preview thumbnail for image sidecars */}
      {isImage && sidecarUrl ? (
        <div className="bg-surface-container border-outline-variant size-12 shrink-0 overflow-hidden rounded-extra-small border">
          <img
            src={sidecarUrl}
            alt={`${sidecar.variant} preview`}
            className="h-full w-full object-cover"
            onError={e => {
              // Fallback to icon on error
              e.currentTarget.style.display = "none";
              if (e.currentTarget.nextElementSibling) {
                (e.currentTarget.nextElementSibling as HTMLElement).style.display = "flex";
              }
            }}
          />
          <div className="hidden h-full w-full items-center justify-center">
            <img src={sidecarIcon} alt="" className="size-6 object-contain" />
          </div>
        </div>
      ) : (
        <div className="bg-surface-container border-outline-variant flex size-12 shrink-0 items-center justify-center rounded-extra-small border">
          <img src={sidecarIcon} alt="" className="size-6 object-contain" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="text-on-surface text-label-medium font-medium">{String(sidecar.kind)}</div>
        <div className="text-on-surface-variant text-[11px]">
          {String(sidecar.variant)} · {formatBytes(sidecar.size)}
        </div>
        <div className="text-on-surface-variant/70 mt-0.5 text-[10px]">{String(sidecar.format).toUpperCase()}</div>
      </div>
      {/* <span
				className={clsx(
					"text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
					sidecar.status === "ready" && "bg-primary/20 text-primary",
					sidecar.status === "pending" &&
						"bg-on-surface-variant/20 text-on-surface-variant",
				)}
			>
				{String(sidecar.status)}
			</span> */}
    </div>
  );
}

function InstancesTab({ file }: { file: File }) {
  // Query for alternate instances with full File data
  const instancesQuery = useNormalizedQuery<{ entry_uuid: string }, { instances: File[]; total_count: number }>({
    query: "files.alternate_instances",
    input: { entry_uuid: file?.id || "" },
    resourceType: "file",
    enabled: !!file?.id && !!file?.content_identity,
  });

  const instances = (instancesQuery.data as { instances: File[]; total_count: number } | undefined)?.instances || [];

  // Query devices to get proper names and icons
  const devicesQuery = useNormalizedQuery<any, any[]>({
    query: "devices.list",
    input: {
      include_offline: true,
      include_details: false,
      show_paired: true,
    },
    resourceType: "device",
  });

  const devices = devicesQuery.data || [];

  // Group instances by device_slug
  const instancesByDevice = instances.reduce(
    (acc, instance) => {
      let deviceSlug = "unknown";
      if ("Physical" in instance.sd_path) {
        deviceSlug = instance.sd_path.Physical.device_slug;
      } else if ("Cloud" in instance.sd_path) {
        deviceSlug = "cloud";
      }

      if (!acc[deviceSlug]) {
        acc[deviceSlug] = [];
      }
      acc[deviceSlug].push(instance);
      return acc;
    },
    {} as Record<string, File[]>,
  );

  const getDeviceName = (deviceSlug: string) => {
    const device = devices.find(d => d.slug === deviceSlug);
    return device?.name || deviceSlug;
  };

  const getDeviceInfo = (deviceSlug: string) => {
    return devices.find(d => d.slug === deviceSlug);
  };

  if (instancesQuery.isLoading) {
    return (
      <div className="text-on-surface-variant flex items-center justify-center py-8 text-body-small">
        Loading instances...
      </div>
    );
  }

  if (!file.content_identity) {
    return (
      <div className="no-scrollbar mask-fade-out flex flex-col space-y-4 overflow-x-hidden overflow-y-scroll px-2 pb-10 pt-2">
        <p className="text-on-surface-variant text-body-small">
          This file has not been content-hashed yet. Instances will appear after indexing completes.
        </p>
      </div>
    );
  }

  return (
    <div className="no-scrollbar mask-fade-out flex flex-col space-y-5 overflow-x-hidden overflow-y-scroll px-2 pb-10 pt-2">
      <p className="text-on-surface-variant text-body-small">
        All copies of this file across your devices and locations
      </p>

      {instances.length === 0 || instances.length === 1 ? (
        <div className="text-on-surface-variant flex items-center justify-center py-8 text-body-small">
          No alternate instances found
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(instancesByDevice).map(([deviceSlug, deviceInstances]: [string, File[]]) => {
            const deviceInfo = getDeviceInfo(deviceSlug);
            const deviceName = getDeviceName(deviceSlug);

            return (
              <div key={deviceSlug} className="space-y-1">
                {/* Device Header */}
                <div className="flex items-center gap-2 px-2">
                  <img src={getDeviceIcon(deviceInfo)} className="size-4 shrink-0" alt="" />
                  <span className="text-on-surface text-label-medium font-semibold">{deviceName}</span>
                  <div className="flex-1" />
                  <div className="bg-surface-container border-outline-variant text-on-surface-variant flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold">
                    {deviceInstances.length}
                  </div>
                </div>

                {/* List of instances */}
                <div className="space-y-0.5">
                  {deviceInstances.map(instance => (
                    <InstanceRow key={instance.id} instance={instance} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const formatInstanceDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

function InstanceRow({ instance }: { instance: File }) {
  const getPathDisplay = (sdPath: typeof instance.sd_path) => {
    if ("Physical" in sdPath) {
      return sdPath.Physical.path;
    } else if ("Cloud" in sdPath) {
      return sdPath.Cloud.path;
    } else {
      return "Content";
    }
  };

  return (
    <div
      className="hover:bg-surface-container/40 flex cursor-default items-center gap-2 rounded-small px-2 py-1.5 transition-colors"
      title={getPathDisplay(instance.sd_path)}
    >
      {/* Thumbnail */}
      <div className="flex-shrink-0 [&_*]:!rounded-[3px]">
        <FileComponent.Thumb file={instance} size={20} />
      </div>

      {/* File info */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-on-surface truncate text-body-small">
          {instance.name}
          {instance.extension && `.${instance.extension}`}
        </span>
      </div>

      {/* Metadata */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Tags */}
        {instance.tags && instance.tags.length > 0 && (
          <div className="flex items-center gap-0.5" title={instance.tags.map(t => t.canonical_name).join(", ")}>
            {instance.tags.slice(0, 3).map(tag => (
              <div
                key={tag.id}
                className="size-1.5 rounded-full"
                style={{
                  backgroundColor: tag.color || "#3B82F6",
                }}
              />
            ))}
            {instance.tags.length > 3 && (
              <span className="text-outline text-[9px] font-medium">+{instance.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Modified date */}
        <span className="text-on-surface-variant text-[10px]">{formatInstanceDate(instance.modified_at)}</span>

        {/* Size */}
        <span className="text-on-surface-variant min-w-[50px] text-right text-[10px]">
          {formatBytes(instance.size)}
        </span>

        {/* Local indicator */}
        <div
          className={clsx("size-1.5 rounded-full", instance.is_local ? "bg-primary" : "bg-on-surface-variant/40")}
          title={instance.is_local ? "Available locally" : "Remote"}
        />
      </div>
    </div>
  );
}

function ChatTab({ file }: { file?: File }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<
    Array<{
      id: number;
      sender: string;
      content: string;
      time: string;
      isAI: boolean;
      isUser: boolean;
    }>
  >(() => [
    {
      id: 1,
      sender: "Aphrody AI",
      content: file
        ? `Je suis prêt à analyser le fichier "${file.name}". Que souhaitez-vous savoir ou extraire ?`
        : "Je suis prêt à analyser votre fichier sélectionné.",
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      isAI: true,
      isUser: false,
    },
  ]);

  const handleSend = async (customPrompt?: string) => {
    const text = customPrompt || message;
    if (!text.trim() || loading) return;

    const userMsg = {
      id: Date.now(),
      sender: "Vous",
      content: text,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      isAI: false,
      isUser: true,
    };
    setMessages(prev => [...prev, userMsg]);
    if (!customPrompt) setMessage("");
    setLoading(true);

    try {
      const prompt = file ? `[Fichier: ${file.name} (Taille: ${file.size} octets)]\n${text}` : text;
      const res = await askLocalAi(prompt);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: "Aphrody AI",
          content: res?.answer || "Analyse terminée.",
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          isAI: true,
          isUser: false,
        },
      ]);
    } catch (err) {
      toast.error("Erreur IA : " + String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-2 pt-2">
        {messages.map(msg => (
          <div key={msg.id} className={clsx("flex gap-2", msg.isUser ? "flex-row-reverse" : "flex-row")}>
            {/* Avatar */}
            <div
              className={clsx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                msg.isAI ? "bg-primary/20 text-primary" : "bg-secondary-container text-on-surface",
              )}
            >
              {msg.isAI ? "S" : "U"}
            </div>

            {/* Message bubble */}
            <div className={clsx("flex max-w-[85%] flex-col", msg.isUser ? "items-end" : "items-start")}>
              <div
                className={clsx(
                  "rounded-small px-2.5 py-1.5 whitespace-pre-wrap",
                  msg.isAI
                    ? "bg-surface-container-high border-outline-variant/40 border text-on-surface"
                    : "bg-primary text-on-primary",
                )}
              >
                {msg.isAI && <div className="mb-0.5 text-[10px] font-semibold text-primary">{msg.sender}</div>}
                <p className="text-body-small leading-relaxed">{msg.content}</p>
              </div>
              <span className="text-on-surface-variant mt-0.5 px-1 text-[10px]">{msg.time}</span>
            </div>
          </div>
        ))}
        {loading && <div className="text-[11px] text-on-surface-variant italic px-2">Analyse en cours...</div>}
      </div>

      {/* Input */}
      <div className="border-outline-variant space-y-2 border-t p-2">
        <div className="flex items-end gap-1.5">
          <div className="bg-surface-container border-outline-variant flex flex-1 items-center gap-1.5 rounded-small border px-2 py-1.5">
            <input
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Poser une question sur ce fichier..."
              className="text-on-surface placeholder:text-on-surface-variant flex-1 bg-transparent text-body-small outline-none"
            />
          </div>

          <button
            onClick={() => handleSend()}
            disabled={!message.trim() || loading}
            className="bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-small p-1.5 text-on-primary transition-colors"
            title="Envoyer"
          >
            <PaperPlaneRight size={16} weight="bold" />
          </button>
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => handleSend("Résume en trois points clés le contenu et l'utilité de ce document.")}
            className="text-on-surface-variant hover:text-on-surface bg-surface-container/40 hover:bg-surface-container/60 flex items-center gap-1 rounded-small px-2 py-1 text-[10px] font-medium transition-colors"
          >
            <Sparkle size={12} weight="bold" />
            Résumer
          </button>
          <button
            onClick={() => handleSend("Vérifie les métadonnées et la validité de ce format.")}
            className="text-on-surface-variant hover:text-on-surface bg-surface-container/40 hover:bg-surface-container/60 rounded-small px-2 py-1 text-[10px] font-medium transition-colors"
          >
            Vérifier format
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ file }: { file?: File }) {
  const items = [
    {
      action: "Dernière modification locale enregistrée",
      time: file?.modified_at ? new Date(file.modified_at).toLocaleString() : "Inconnue",
      device: file?.is_local ? "Système de fichiers local" : "Stockage distant",
    },
    {
      action: "Date de découverte par Spacedrive",
      time: file?.created_at ? new Date(file.created_at).toLocaleString() : "Inconnue",
      device: "Base SQLite VDFS",
    },
    {
      action: file?.content_identity
        ? "Empreinte de contenu calculée (BLAKE3/SHA256)"
        : "Indexation de contenu en attente",
      time: "Vérifié",
      device: file?.content_identity
        ? String(file.content_identity.content_hash || "").slice(0, 16) + "..."
        : "En attente",
    },
  ];

  return (
    <div className="no-scrollbar mask-fade-out flex flex-col space-y-4 overflow-x-hidden overflow-y-scroll px-2 pb-10 pt-2">
      <p className="text-on-surface-variant text-body-small">Événements et synchronisation réels</p>

      <div className="space-y-1">
        {items.map(item => (
          <div
            key={item.action}
            className="hover:bg-surface-container/40 flex items-start gap-3 rounded-small p-2 transition-colors border border-outline-variant/20"
          >
            <span className="text-primary mt-0.5 shrink-0">
              <ClockCounterClockwise size={16} weight="bold" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-on-surface text-body-small font-medium">{item.action}</div>
              <div className="text-on-surface-variant mt-0.5 text-[11px]">
                {item.time} · {item.device}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailsTab({ file }: { file: File }) {
  return (
    <div className="no-scrollbar mask-fade-out flex flex-col space-y-5 overflow-x-hidden overflow-y-scroll pb-10">
      {/* Content Identity */}
      {file.content_identity && (
        <Section title="Content identity" icon={Fingerprint}>
          <InfoRow label="Content hash" value={String(file.content_identity.content_hash).slice(0, 16) + "..."} mono />
          {file.content_identity.integrity_hash && (
            <InfoRow
              label="Integrity hash"
              value={String(file.content_identity.integrity_hash).slice(0, 16) + "..."}
              mono
            />
          )}
          {file.content_identity.mime_type_id !== null && (
            <InfoRow label="MIME type ID" value={String(file.content_identity.mime_type_id)} />
          )}
        </Section>
      )}

      {/* Metadata */}
      <Section title="Metadata" icon={Hash}>
        <InfoRow label="File ID" value={String(file.id).slice(0, 8) + "..."} mono />
        <InfoRow label="Content kind" value={String(file.content_kind || "Unknown")} />
        {file.extension && <InfoRow label="Extension" value={String(file.extension)} />}
      </Section>

      {/* System */}
      <Section title="System" icon={DotsThree}>
        <InfoRow label="Entry kind" value={file.kind} />
        <InfoRow label="Local" value={file.is_local ? "Yes" : "No"} />
        <InfoRow label="Instances" value={String((file.alternate_paths?.length || 0) + 1)} />
      </Section>
    </div>
  );
}
