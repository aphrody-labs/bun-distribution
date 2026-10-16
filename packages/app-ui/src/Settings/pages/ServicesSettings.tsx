import { useForm } from "react-hook-form";
import { useCoreQuery, useCoreMutation } from "../../contexts/SpacedriveContext";

interface ServicesSettingsForm {
  networking_enabled: boolean;
  volume_monitoring_enabled: boolean;
  fs_watcher_enabled: boolean;
  statistics_listener_enabled: boolean;
}

export function ServicesSettings() {
  const { data: config, refetch } = useCoreQuery({ type: "config.app.get", input: null as any });
  const updateConfig = useCoreMutation("config.app.update");

  const form = useForm<ServicesSettingsForm>({
    values: {
      networking_enabled: config?.services?.networking_enabled ?? true,
      volume_monitoring_enabled: config?.services?.volume_monitoring_enabled ?? true,
      fs_watcher_enabled: config?.services?.fs_watcher_enabled ?? true,
      statistics_listener_enabled: config?.services?.statistics_listener_enabled ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    const result = await updateConfig.mutateAsync(data);
    refetch();

    if (result.requires_restart) {
      alert("Some changes require a daemon restart to take effect.");
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title-medium font-semibold text-on-surface mb-2">Services</h2>
        <p className="text-body-medium text-on-surface-variant">
          Configure daemon background services.
        </p>
      </div>

      <div className="p-3 bg-warning/10 border border-warning/20 rounded-small">
        <p className="text-body-medium text-warning">
          Changes to service settings may require a daemon restart to take effect.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Networking</span>
              <p className="text-body-small text-on-surface-variant">Enable P2P networking and device pairing</p>
            </div>
            <input
              type="checkbox"
              {...form.register("networking_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Volume monitoring</span>
              <p className="text-body-small text-on-surface-variant">Monitor for connected and disconnected volumes</p>
            </div>
            <input
              type="checkbox"
              {...form.register("volume_monitoring_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Filesystem watcher</span>
              <p className="text-body-small text-on-surface-variant">Watch for file changes in tracked locations</p>
            </div>
            <input
              type="checkbox"
              {...form.register("fs_watcher_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Statistics listener</span>
              <p className="text-body-small text-on-surface-variant">Listen for and update library statistics</p>
            </div>
            <input
              type="checkbox"
              {...form.register("statistics_listener_enabled")}
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
