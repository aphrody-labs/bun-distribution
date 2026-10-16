import { useForm } from "react-hook-form";
import { useLibraryQuery, useLibraryMutation, useSpacedriveClient } from "../../contexts/SpacedriveContext";

interface IndexerSettingsForm {
  no_system_files: boolean;
  no_git: boolean;
  no_dev_dirs: boolean;
  no_hidden: boolean;
  gitignore: boolean;
  only_images: boolean;
}

export function IndexerSettings() {
  const client = useSpacedriveClient();
  const libraryId = client.getCurrentLibraryId();
  const { data: config, refetch, isLoading } = useLibraryQuery(
    { type: "config.library.get", input: null as any },
    { enabled: !!libraryId }
  );
  const updateConfig = useLibraryMutation("config.library.update");

  const form = useForm<IndexerSettingsForm>({
    values: {
      no_system_files: config?.indexer?.no_system_files ?? true,
      no_git: config?.indexer?.no_git ?? true,
      no_dev_dirs: config?.indexer?.no_dev_dirs ?? true,
      no_hidden: config?.indexer?.no_hidden ?? false,
      gitignore: config?.indexer?.gitignore ?? true,
      only_images: config?.indexer?.only_images ?? false,
    },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    await updateConfig.mutateAsync(data);
    refetch();
  });

  if (!libraryId) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-title-medium font-semibold text-on-surface mb-2">Indexer</h2>
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
          <h2 className="text-title-medium font-semibold text-on-surface mb-2">Indexer</h2>
          <p className="text-body-medium text-on-surface-variant">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title-medium font-semibold text-on-surface mb-2">Indexer</h2>
        <p className="text-body-medium text-on-surface-variant">
          Configure what files are indexed in your library.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Exclusions Section */}
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Exclusions</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Skip system files</span>
              <p className="text-body-small text-on-surface-variant">Ignore OS system files and directories</p>
            </div>
            <input
              type="checkbox"
              {...form.register("no_system_files")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Skip Git repositories</span>
              <p className="text-body-small text-on-surface-variant">Ignore .git directories</p>
            </div>
            <input
              type="checkbox"
              {...form.register("no_git")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Skip dev directories</span>
              <p className="text-body-small text-on-surface-variant">Ignore node_modules, vendor, target, etc.</p>
            </div>
            <input
              type="checkbox"
              {...form.register("no_dev_dirs")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Skip hidden files</span>
              <p className="text-body-small text-on-surface-variant">Ignore files starting with a dot</p>
            </div>
            <input
              type="checkbox"
              {...form.register("no_hidden")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>
        </div>

        {/* Filters Section */}
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Filters</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Respect .gitignore</span>
              <p className="text-body-small text-on-surface-variant">Honor .gitignore files when indexing</p>
            </div>
            <input
              type="checkbox"
              {...form.register("gitignore")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Only index images</span>
              <p className="text-body-small text-on-surface-variant">Only index image files (photos, graphics)</p>
            </div>
            <input
              type="checkbox"
              {...form.register("only_images")}
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
