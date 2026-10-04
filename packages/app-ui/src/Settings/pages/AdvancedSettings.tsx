import { useForm } from "react-hook-form";
import { useCoreQuery, useCoreMutation } from "../../contexts/SpacedriveContext";

interface AdvancedSettingsForm {
  job_logging_enabled: boolean;
  job_logging_include_debug: boolean;
  log_level: string;
}

export function AdvancedSettings() {
  const { data: config, refetch } = useCoreQuery({ type: "config.app.get", input: null as any });
  const updateConfig = useCoreMutation("config.app.update");

  const form = useForm<AdvancedSettingsForm>({
    values: {
      job_logging_enabled: config?.job_logging?.enabled ?? true,
      job_logging_include_debug: config?.job_logging?.include_debug ?? false,
      log_level: config?.log_level || "info",
    },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    await updateConfig.mutateAsync(data);
    refetch();
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title-medium font-semibold text-on-surface mb-2">Advanced</h2>
        <p className="text-body-medium text-on-surface-variant">
          Advanced configuration options for power users.
        </p>
      </div>

      <div className="p-3 bg-warning/10 border border-warning/20 rounded-small">
        <p className="text-body-medium text-warning">
          These settings are for expert users. Incorrect configuration may affect performance.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant">
          <h3 className="text-label-large font-medium text-on-surface mb-3">Daemon log level</h3>
          <label className="block">
            <p className="text-body-small text-on-surface-variant mb-2">Set the verbosity of daemon logs</p>
            <select
              {...form.register("log_level")}
              className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-small text-on-surface text-body-medium focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="trace">Trace</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </label>
        </div>

        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Job logging</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Enable job logging</span>
              <p className="text-body-small text-on-surface-variant">Write detailed logs for background jobs</p>
            </div>
            <input
              type="checkbox"
              {...form.register("job_logging_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Include debug logs</span>
              <p className="text-body-small text-on-surface-variant">Include verbose debug information in job logs</p>
            </div>
            <input
              type="checkbox"
              {...form.register("job_logging_include_debug")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <div className="pt-2 border-t border-outline-variant">
            <p className="text-body-small text-on-surface-variant">
              Job logs are stored in the library's logs directory. Enabling debug logs
              will significantly increase log file sizes.
            </p>
          </div>
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
