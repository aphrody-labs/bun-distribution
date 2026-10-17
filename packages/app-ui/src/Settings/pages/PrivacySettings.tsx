import { useForm } from "react-hook-form";
import { useCoreQuery, useCoreMutation } from "../../contexts/SpacedriveContext";

interface PrivacySettingsForm {
  telemetry_enabled: boolean;
}

export function PrivacySettings() {
  const { data: config, refetch } = useCoreQuery({
    type: "config.app.get",
    input: null as any,
  });
  const updateConfig = useCoreMutation("config.app.update");

  const form = useForm<PrivacySettingsForm>({
    values: {
      telemetry_enabled: config?.telemetry_enabled ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async data => {
    await updateConfig.mutateAsync(data);
    refetch();
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title-medium font-semibold text-on-surface mb-2">Privacy</h2>
        <p className="text-body-medium text-on-surface-variant">Control your privacy and data sharing preferences.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="p-4 bg-surface-container rounded-small border border-outline-variant space-y-4">
          <h3 className="text-label-large font-medium text-on-surface">Telemetry</h3>

          <label className="flex items-center justify-between">
            <div>
              <span className="text-body-medium text-on-surface">Anonymous usage data</span>
              <p className="text-body-small text-on-surface-variant">
                Help improve Spacedrive by sharing anonymous usage data
              </p>
            </div>
            <input
              type="checkbox"
              {...form.register("telemetry_enabled")}
              className="h-4 w-4 rounded-extra-small border-outline-variant text-primary focus:ring-primary"
            />
          </label>

          <div className="pt-2 border-t border-outline-variant">
            <p className="text-body-small text-on-surface-variant">
              We collect anonymous usage statistics to understand how Spacedrive is used and to prioritize features. No
              personal data or file contents are ever collected.
            </p>
            <a
              href="https://spacedrive.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-body-small text-primary hover:underline mt-2 inline-block"
            >
              Read our privacy policy
            </a>
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
