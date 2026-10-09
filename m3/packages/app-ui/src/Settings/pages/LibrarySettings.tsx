import { useForm, useWatch } from "react-hook-form";
import {
  useLibraryQuery,
  useLibraryMutation,
  useSpacedriveClient,
} from "../../contexts/SpacedriveContext";

interface LibrarySettingsForm {
  generate_thumbnails: boolean;
  thumbnail_quality: number;
  enable_ai_tagging: boolean;
  sync_enabled: boolean;
  encryption_enabled: boolean;
  auto_track_system_volumes: boolean;
  auto_track_external_volumes: boolean;
}

export function LibrarySettings() {
  const client = useSpacedriveClient();
  const libraryId = client.getCurrentLibraryId();
  const {
    data: config,
    refetch,
    isLoading,
  } = useLibraryQuery({ type: "config.library.get", input: null as any }, { enabled: !!libraryId });
  const updateConfig = useLibraryMutation("config.library.update");

  const form = useForm<LibrarySettingsForm>({
    values: {
      generate_thumbnails: config?.generate_thumbnails ?? true,
      thumbnail_quality: config?.thumbnail_quality ?? 85,
      enable_ai_tagging: config?.enable_ai_tagging ?? false,
      sync_enabled: config?.sync_enabled ?? false,
      encryption_enabled: config?.encryption_enabled ?? false,
      auto_track_system_volumes: config?.auto_track_system_volumes ?? true,
      auto_track_external_volumes: config?.auto_track_external_volumes ?? false,
    },
  });

  const thumbnailQuality = useWatch({ control: form.control, name: "thumbnail_quality" });

  const onSubmit = form.handleSubmit(async (data) => {
    await updateConfig.mutateAsync(data);
    refetch();
  });

  if (!libraryId) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-title-medium font-semibold text-on-surface mb-2">Library</h2>
          <p className="text-body-medium text-on-surface-variant">
            No library selected. Please select a library first.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-title-medium font-semibold text-on-surface mb-2">Library</h2>
          <p className="text-body-medium text-on-surface-variant">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title-medium font-semibold text-on-surface mb-2">Library</h2>
        <p className="text-body-medium text-on-surface-variant">
          Configure settings for the current library.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Media Section */}
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Media</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Generate thumbnails</span>
              <p className="text-body-small text-on-surface-variant">
                Create preview images for media files
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("generate_thumbnails")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="block">
            <span className="text-body-medium text-on-surface mb-1 block">Thumbnail quality</span>
            <p className="text-body-small text-on-surface-variant mb-2">
              Quality setting for generated thumbnails (1-100)
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="100"
                {...form.register("thumbnail_quality", { valueAsNumber: true })}
                className="flex-1 h-2 rounded-small appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
                style={{
                  background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${((thumbnailQuality - 1) / 99) * 100}%, var(--color-app) ${((thumbnailQuality - 1) / 99) * 100}%, var(--color-app) 100%)`,
                }}
              />
              <span className="text-body-medium text-on-surface w-8">{thumbnailQuality}</span>
            </div>
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">AI tagging</span>
              <p className="text-body-small text-on-surface-variant">
                Enable AI-powered automatic tagging
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("enable_ai_tagging")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>
        </div>

        {/* Sync & Security Section */}
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Sync & security</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Sync enabled</span>
              <p className="text-body-small text-on-surface-variant">
                Sync this library across devices
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("sync_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Encryption</span>
              <p className="text-body-small text-on-surface-variant">
                Encrypt library data at rest
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("encryption_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>
        </div>

        {/* Auto-Tracking Section */}
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Auto-Tracking</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">System volumes</span>
              <p className="text-body-small text-on-surface-variant">
                Automatically track system drives
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("auto_track_system_volumes")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">External volumes</span>
              <p className="text-body-small text-on-surface-variant">
                Automatically track external drives when connected
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("auto_track_external_volumes")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>
        </div>

        {form.formState.isDirty && (
          <button
            type="submit"
            disabled={updateConfig.isPending}
            className="px-4 py-2 bg-primary hover:bg-primary text-white rounded-small text-label-large font-medium transition-colors disabled:opacity-50"
          >
            {updateConfig.isPending ? "Saving…" : "Save changes"}
          </button>
        )}
      </form>
    </div>
  );
}
