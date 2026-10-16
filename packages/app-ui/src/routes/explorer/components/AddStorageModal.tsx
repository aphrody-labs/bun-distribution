import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  Folder,
  FolderOpen,
  HardDrive,
  CloudArrowUp,
} from "@phosphor-icons/react";
import {
  Icon,
  Button,
  Input,
  Label,
  Dialog,
  dialogManager,
  useDialog,
  CircleButton,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@aphrody/m3-primitives";
import type {
  IndexMode,
  LocationAddInput,
  VolumeAddCloudInput,
  CloudStorageConfig,
  ValidateLocationPathInput,
  RiskLevel,
  ValidationWarning as PathValidationWarning,
  VolumeIndexingSuggestion,
} from "@aphrody/drive-client";
import {
  useLibraryMutation,
  useLibraryQuery,
  useSpacedriveClient,
} from "../../../contexts/SpacedriveContext";
import { usePlatform } from "../../../contexts/PlatformContext";
import { clsx } from "clsx";

// Import icons
import FolderIcon from "@aphrody/assets/icons/Folder.png";
import DriveIcon from "@aphrody/assets/icons/Drive.png";
import HDDIcon from "@aphrody/assets/icons/HDD.png";
import DriveAmazonS3 from "@aphrody/assets/icons/AmazonS3.png";

type StorageCategory = "local" | "cloud" | "external";
type ModalStep = "category" | "provider" | "local-config" | "cloud-config";
type SettingsTab = "preset" | "jobs";

interface CategoryOption {
  id: StorageCategory;
  label: string;
  description: string;
  icon: string;
}

interface CloudProvider {
  id: "s3" | "r2" | "minio";
  name: string;
  icon: string;
  cloudServiceType: "s3";
}

interface JobOption {
  id: string;
  label: string;
  description: string;
  presets: IndexMode[];
  order: number;
}

interface LocalFolderFormData {
  path: string;
  name: string;
  mode: IndexMode;
}

interface CloudFormData {
  display_name: string;
  bucket?: string;
  region?: string;
  access_key_id?: string;
  secret_access_key?: string;
  endpoint?: string;
}

const categories: CategoryOption[] = [
  {
    id: "local",
    label: "Local folder",
    description: "Index a folder on your computer",
    icon: FolderIcon,
  },
  {
    id: "cloud",
    label: "Cloud storage",
    description: "Connect S3 or an S3-compatible endpoint",
    icon: DriveIcon,
  },
  {
    id: "external",
    label: "External Drive",
    description: "Track a connected drive",
    icon: HDDIcon,
  },
];

const cloudProviders: CloudProvider[] = [
  {
    id: "s3",
    name: "Amazon S3",
    icon: DriveAmazonS3,
    cloudServiceType: "s3",
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    icon: DriveAmazonS3,
    cloudServiceType: "s3",
  },
  {
    id: "minio",
    name: "MinIO",
    icon: DriveAmazonS3,
    cloudServiceType: "s3",
  },
];

const indexModes: Array<{
  value: IndexMode;
  label: string;
  description: string;
}> = [
  {
    value: "Shallow",
    label: "Shallow",
    description: "Just filesystem metadata",
  },
  {
    value: "Content",
    label: "Content",
    description: "Generate content identities",
  },
  {
    value: "Deep",
    label: "Deep",
    description: "Full indexing + thumbnails",
  },
];

interface StorageDialogProps {
  dialog: ReturnType<typeof useDialog>;
  form: any;
  title: string;
  icon: React.ReactNode;
  description: React.ReactNode;
  onSubmit?: any;
  ctaLabel?: string;
  ctaDanger?: boolean;
  submitDisabled?: boolean;
  loading?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
  hideButtons?: boolean;
  children: React.ReactNode;
}

function StorageDialog({
  dialog,
  form,
  title,
  icon,
  description,
  onSubmit,
  ctaLabel,
  ctaDanger,
  submitDisabled,
  loading,
  showBackButton,
  onBack,
  hideButtons,
  children,
}: StorageDialogProps) {
  return (
    <Dialog
      dialog={dialog}
      form={form}
      onSubmit={onSubmit}
      title={title}
      icon={icon}
      description={description}
      ctaLabel={ctaLabel}
      ctaDanger={ctaDanger}
      submitDisabled={submitDisabled}
      onCancelled={true}
      loading={loading}
      formClassName="!min-w-[480px] !max-w-[480px] max-h-[80vh] flex flex-col"
      hideButtons={hideButtons}
      buttonsSideContent={
        showBackButton ? (
          <Button
            aria-label="Back"
            title="Back"
            variant="gray"
            size="sm"
            onClick={onBack}
          >
            <Icon name="arrow_back" size={18} />
          </Button>
        ) : undefined
      }
    >
      {children}
    </Dialog>
  );
}

const jobOptions: JobOption[] = [
  {
    id: "thumbnail",
    label: "Generate thumbnails",
    description: "Create preview thumbnails for images and videos",
    presets: ["Content", "Deep"],
    order: 1,
  },
  {
    id: "thumbstrip",
    label: "Generate thumbstrips",
    description: "Create video storyboard grids (5×5 grid of frames)",
    presets: ["Deep"],
    order: 2,
  },
  {
    id: "proxy",
    label: "Generate proxies",
    description: "Create scrubbing proxies for videos (~8s per video)",
    presets: [],
    order: 3,
  },
  {
    id: "ocr",
    label: "Extract Text (OCR)",
    description: "OCR and text extraction from images/PDFs",
    presets: [],
    order: 4,
  },
  {
    id: "speech_to_text",
    label: "Speech to text",
    description: "Transcribe audio and video files",
    presets: [],
    order: 5,
  },
];

export function useAddStorageDialog(
  onStorageAdded?: (sdPath: any) => void,
  initialPath?: string,
) {
  return dialogManager.create((props) => (
    <AddStorageDialog
      {...props}
      onStorageAdded={onStorageAdded}
      initialPath={initialPath}
    />
  ));
}

function AddStorageDialog(props: {
  id: number;
  onStorageAdded?: (sdPath: any) => void;
  initialPath?: string;
}) {
  const dialog = useDialog(props);
  const platform = usePlatform();

  // Derive initial folder name from path
  const initialFolderName =
    props.initialPath?.split("/").findLast(Boolean) || "";

  const [step, setStep] = useState<ModalStep>(
    props.initialPath ? "local-config" : "category",
  );
  const [selectedCategory, setSelectedCategory] =
    useState<StorageCategory | null>(props.initialPath ? "local" : null);
  const [selectedProvider, setSelectedProvider] =
    useState<CloudProvider | null>(null);
  const [tab, setTab] = useState<SettingsTab>("preset");
  const [validationResult, setValidationResult] = useState<{
    riskLevel: RiskLevel;
    warnings: PathValidationWarning[];
    suggestion: VolumeIndexingSuggestion | null;
  } | null>(null);

  console.log("AddStorageDialog render:", { validationResult, step });

  const client = useSpacedriveClient();
  const addLocation = useLibraryMutation("locations.add");
  const addCloudVolume = useLibraryMutation("volumes.add_cloud");
  const trackVolume = useLibraryMutation("volumes.track");
  const indexVolume = useLibraryMutation("volumes.index");
  const { data: suggestedLocations } = useLibraryQuery({
    type: "locations.suggested",
    input: null,
  });
  const { data: volumesData } = useLibraryQuery({
    type: "volumes.list",
    input: { filter: "UntrackedOnly" },
  });

  const volumes = volumesData?.volumes || [];

  const localForm = useForm<LocalFolderFormData>({
    defaultValues: {
      path: props.initialPath || "",
      name: initialFolderName,
      mode: "Deep",
    },
  });

  const cloudForm = useForm<CloudFormData>({
    defaultValues: {
      display_name: "",
    },
  });

  // Dummy form for non-form dialogs (to satisfy Dialog component)
  const dummyForm = useForm();

  // Subscribe to the local form's `path` field so the picker step's
  // Continue button reacts as the user types into the input.
  const localPathWatched = useWatch({
    control: localForm.control,
    name: "path",
  });
  const localPathTyped = localPathWatched || "";

  // Update selected jobs when preset mode changes
  const currentMode = useWatch({ control: localForm.control, name: "mode" });
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(
    new Set(
      jobOptions.filter((j) => j.presets.includes("Deep")).map((j) => j.id),
    ),
  );

  // Sync selected jobs with preset when mode changes
  const handleModeChange = (mode: IndexMode) => {
    localForm.setValue("mode", mode);
    const presetJobs = jobOptions.filter((j) => j.presets.includes(mode));
    setSelectedJobs(new Set(presetJobs.map((j) => j.id)));
  };

  const toggleJob = (jobId: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const handleCategorySelect = (category: StorageCategory) => {
    setSelectedCategory(category);
    setStep("provider");
  };

  const handleProviderSelect = (provider: CloudProvider) => {
    setSelectedProvider(provider);
    setStep("cloud-config");
  };

  const handleBack = () => {
    if (step === "cloud-config") {
      setStep("provider");
      setSelectedProvider(null);
    } else if (step === "local-config") {
      setStep("provider");
      localForm.setValue("path", "");
      localForm.setValue("name", "");
    } else {
      setStep("category");
      setSelectedCategory(null);
      setSelectedProvider(null);
    }
  };

  const handleBrowse = async () => {
    if (!platform.openDirectoryPickerDialog) {
      console.error("Directory picker not available on this platform");
      return;
    }

    const selected = await platform.openDirectoryPickerDialog({
      title: "Choose a folder to add",
      multiple: false,
    });

    if (selected && typeof selected === "string") {
      localForm.setValue("path", selected);
      const folderName = selected.split("/").pop() || "";
      localForm.setValue("name", folderName);
      setStep("local-config");
    }
  };

  const handleSelectSuggested = (path: string, name: string) => {
    localForm.setValue("path", path);
    localForm.setValue("name", name);
    setStep("local-config");
  };

  const onSubmitManualPath = localForm.handleSubmit((data) => {
    const path = (data.path || "").trim();
    if (!path) return;
    if (!data.name) {
      const folderName = path.split("/").findLast(Boolean) || path;
      localForm.setValue("name", folderName);
    }
    setStep("local-config");
  });

  const handleVolumeSelect = async (volume: any) => {
    try {
      // Step 1: Track the volume
      await trackVolume.mutateAsync({
        fingerprint: volume.fingerprint,
        display_name: volume.display_name || volume.name,
      });

      // Step 2: Create a location for the volume's mount point
      const locationInput: LocationAddInput = {
        path: {
          Physical: {
            device_slug: "local",
            path: volume.mount_point || "/",
          },
        },
        name: volume.display_name || volume.name,
        mode: "Deep",
        job_policies: {},
      };

      const locationResult = await addLocation.mutateAsync(locationInput);
      dialogManager.setState(dialog.id, { open: false });

      if (locationResult?.path && props.onStorageAdded) {
        props.onStorageAdded(locationResult.path);
      }
    } catch (error) {
      console.error("Failed to track volume and add location:", error);
    }
  };

  const onSubmitLocal = localForm.handleSubmit(async (data) => {
    // Validate path first
    const validateInput: ValidateLocationPathInput = {
      path: {
        Physical: {
          device_slug: "local",
          path: data.path,
        },
      },
    };

    let validation:
      | {
          risk_level: RiskLevel;
          warnings: PathValidationWarning[];
          suggested_alternative: VolumeIndexingSuggestion | null;
        }
      | undefined;
    try {
      validation = (await client.execute(
        "query:locations.validate_path",
        validateInput,
      )) as any;
      console.log("Validation result:", validation);
    } catch (error) {
      console.error("Failed to validate path:", error);
      // Continue anyway if validation fails
    }

    // Show warning if path is risky (but don't block submission if user already saw it)
    if (
      validation &&
      (validation.risk_level === "medium" ||
        validation.risk_level === "high") &&
      !validationResult
    ) {
      console.log("Validation warning for risk level:", validation.risk_level);
      setValidationResult({
        riskLevel: validation.risk_level,
        warnings: validation.warnings,
        suggestion: validation.suggested_alternative || null,
      });
      // Don't submit yet - let user review the warning
      return;
    }

    // Path is safe or user proceeding anyway - clear validation and add location
    if (validationResult) {
      setValidationResult(null);
    }
    const job_policies: any = {};
    selectedJobs.forEach((jobId) => {
      job_policies[jobId] = { enabled: true };
    });

    const input: LocationAddInput = {
      path: {
        Physical: {
          device_slug: "local",
          path: data.path,
        },
      },
      name: data.name || null,
      mode: data.mode,
      job_policies,
    };

    try {
      const result = await addLocation.mutateAsync(input);
      dialogManager.setState(dialog.id, { open: false });

      if (result?.path && props.onStorageAdded) {
        props.onStorageAdded(result.path);
      }
    } catch (error) {
      console.error("Failed to add location:", error);
      localForm.setError("root", {
        type: "manual",
        message:
          error instanceof Error ? error.message : "Failed to add location",
      });
    }
  });

  const onSubmitCloud = cloudForm.handleSubmit(async (data) => {
    if (!selectedProvider) return;

    const provider = selectedProvider;
    if (
      !data.bucket?.trim() ||
      !data.region?.trim() ||
      !data.access_key_id?.trim() ||
      !data.secret_access_key?.trim() ||
      ((provider.id === "r2" || provider.id === "minio") &&
        !data.endpoint?.trim())
    ) {
      cloudForm.setError("root", {
        type: "manual",
        message:
          "Bucket, region and credentials are required; R2 and MinIO also need an endpoint.",
      });
      return;
    }
    const config: CloudStorageConfig = {
      type: "S3",
      bucket: data.bucket!,
      region: data.region!,
      access_key_id: data.access_key_id!,
      secret_access_key: data.secret_access_key!,
      endpoint: data.endpoint || null,
    };

    const volumeInput: VolumeAddCloudInput = {
      service: provider.cloudServiceType,
      display_name: data.display_name,
      config,
    };

    let volumeAdded = false;
    try {
      // Step 1: Add the cloud volume and get fingerprint
      await addCloudVolume.mutateAsync(volumeInput);
      volumeAdded = true;

      // Step 2: Create a location for the cloud volume so it gets indexed
      const locationInput: LocationAddInput = {
        path: {
          Cloud: {
            service: provider.cloudServiceType,
            identifier: data.bucket!,
            path: "",
          },
        },
        name: data.display_name,
        mode: "Deep",
        job_policies: {},
      };

      const locationResult = await addLocation.mutateAsync(locationInput);
      dialogManager.setState(dialog.id, { open: false });

      if (locationResult?.path && props.onStorageAdded) {
        props.onStorageAdded(locationResult.path);
      }
    } catch (error) {
      console.error("Failed to add cloud storage:", error);
      cloudForm.setError("root", {
        type: "manual",
        message: volumeAdded
          ? "The volume was added, but its indexing location failed. Finish setup in Sources."
          : error instanceof Error
            ? error.message
            : "Failed to add cloud storage",
      });
    }
  });

  const handleUseVolumeIndexing = async () => {
    if (!validationResult?.suggestion) return;

    try {
      const result = await indexVolume.mutateAsync({
        fingerprint: validationResult.suggestion.volume_fingerprint,
        scope: "Recursive",
      });

      // Clear validation and close dialog
      setValidationResult(null);
      dialogManager.setState(dialog.id, { open: false });

      console.log("Volume indexed:", result.message);
    } catch (error) {
      console.error("Failed to index volume:", error);
      localForm.setError("root", {
        type: "manual",
        message:
          error instanceof Error ? error.message : "Failed to index volume",
      });
    }
  };

  // Render category selection
  if (step === "category") {
    return (
      <StorageDialog
        dialog={dialog}
        form={dummyForm}
        title="Add storage"
        icon={<CloudArrowUp size={20} weight="fill" />}
        description="Choose the type of storage you want to connect"
        hideButtons={true}
      >
        <div className="grid grid-cols-2 gap-3">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-label={category.label}
              onClick={() => handleCategorySelect(category.id)}
              className={clsx(
                "flex flex-col items-center gap-3 rounded-lg border p-6",
                "transition-all hover:scale-[1.02]",
                "border-app-line bg-app-box hover:bg-app-hover hover:border-accent/50",
              )}
            >
              <img src={category.icon} className="size-12" alt="" />
              <div className="text-center">
                <div className="text-sm font-medium text-ink">
                  {category.label}
                </div>
                <div className="mt-1 text-xs text-ink-faint">
                  {category.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </StorageDialog>
    );
  }

  // Render provider selection for cloud
  if (step === "provider" && selectedCategory === "cloud") {
    return (
      <StorageDialog
        dialog={dialog}
        form={dummyForm}
        title="Select cloud provider"
        icon={<CloudArrowUp size={20} weight="fill" />}
        description="Choose your cloud storage service"
        hideButtons={true}
        showBackButton={true}
        onBack={handleBack}
      >
        <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1">
          {cloudProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => handleProviderSelect(provider)}
              className={clsx(
                "flex flex-col items-center gap-2 rounded-lg border p-4",
                "transition-all hover:scale-[1.02]",
                "border-app-line bg-app-box hover:bg-app-hover hover:border-accent/50",
              )}
            >
              <img src={provider.icon} className="size-10" alt="" />
              <div className="text-xs font-medium text-ink text-center">
                {provider.name}
              </div>
            </button>
          ))}
        </div>
      </StorageDialog>
    );
  }

  // Render provider selection for external
  if (step === "provider" && selectedCategory === "external") {
    return (
      <StorageDialog
        dialog={dialog}
        form={dummyForm}
        title="Track external drive"
        icon={<HardDrive size={20} weight="fill" />}
        description="Select a connected drive to track"
        hideButtons={true}
        showBackButton={true}
        onBack={handleBack}
      >
        <div className="space-y-3">
          {volumes && volumes.length > 0 ? (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {volumes.map((volume) => (
                <button
                  key={volume.fingerprint}
                  type="button"
                  onClick={() => handleVolumeSelect(volume)}
                  className={clsx(
                    "w-full flex items-center gap-3 rounded-lg border p-3 text-left",
                    "transition-all hover:scale-[1.01]",
                    "border-app-line bg-app-box hover:bg-app-hover hover:border-accent/50",
                  )}
                >
                  <img src={HDDIcon} className="size-8" alt="" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {volume.display_name || volume.name}
                    </div>
                    <div className="text-xs text-ink-faint">
                      {volume.mount_point} •{" "}
                      {typeof volume.file_system === "string"
                        ? volume.file_system
                        : ((volume.file_system as any)?.Other ?? "Unknown")}
                    </div>
                  </div>
                  <div className="text-xs text-ink-dull">
                    {volume.total_capacity
                      ? (volume.total_capacity / 1e9).toFixed(0)
                      : "?"}{" "}
                    GB
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-app-box border border-app-line p-6 text-center">
              <p className="text-sm text-ink-dull">
                No untracked external drives found. Connect a drive and refresh
                to see it here.
              </p>
            </div>
          )}
        </div>
      </StorageDialog>
    );
  }

  // Render local folder configuration (browse + suggested + settings)
  if (step === "provider" && selectedCategory === "local") {
    return (
      <StorageDialog
        dialog={dialog}
        form={localForm}
        onSubmit={onSubmitManualPath}
        title="Add local folder"
        icon={<Folder size={20} weight="fill" />}
        description="Choose a folder to index and manage"
        ctaLabel="Continue"
        submitDisabled={!localPathTyped.trim()}
        showBackButton={true}
        onBack={handleBack}
      >
        <div className="space-y-4 flex flex-col">
          <div className="space-y-2">
            <Label>Browse</Label>
            <div className="relative">
              <Input
                value={localPathTyped}
                onChange={(e) =>
                  localForm.setValue("path", e.target.value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Type or paste a folder path"
                size="lg"
                className="pr-14"
              />
              <CircleButton
                icon={FolderOpen}
                onClick={handleBrowse}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              />
            </div>
          </div>

          {suggestedLocations && suggestedLocations.locations.length > 0 && (
            <div className="space-y-2">
              <Label>Suggested locations</Label>
              <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1">
                {suggestedLocations.locations.map((loc) => (
                  <button
                    key={loc.path}
                    type="button"
                    onClick={() => handleSelectSuggested(loc.path, loc.name)}
                    className="flex items-center gap-3 rounded-lg border border-app-line bg-app-box p-3 text-left transition-all hover:bg-app-hover hover:border-accent/50 h-fit"
                  >
                    <Folder
                      className="size-5 shrink-0 text-accent"
                      weight="fill"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink truncate">
                        {loc.name}
                      </div>
                      <div className="text-xs text-ink-faint truncate">
                        {loc.path}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </StorageDialog>
    );
  }

  // Render local folder settings (after path selected)
  if (step === "local-config") {
    return (
      <StorageDialog
        dialog={dialog}
        form={localForm}
        onSubmit={onSubmitLocal}
        title="Configure location"
        icon={<Folder size={20} weight="fill" />}
        description={localPathWatched}
        ctaLabel={validationResult ? "Proceed anyway" : "Add Location"}
        ctaDanger={!!validationResult}
        loading={addLocation.isPending}
        showBackButton={true}
        onBack={handleBack}
      >
        <div className="space-y-4">
          {/* Validation Warning Card */}
          {validationResult && (
            <div
              className={clsx(
                "rounded-lg border p-4 space-y-3",
                validationResult.riskLevel === "high"
                  ? "bg-error/10 border-error/50"
                  : "bg-warning/10 border-warning/50",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="text-title-medium">
                  {validationResult.riskLevel === "high" ? "⚠️" : "⚡"}
                </span>
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium text-ink">
                    {validationResult.riskLevel === "high"
                      ? "High risk path detected"
                      : "Warning"}
                  </p>
                  {validationResult.warnings.map((warning) => (
                    <div key={warning.message} className="space-y-1">
                      <p className="text-xs text-ink-dull">{warning.message}</p>
                      {warning.suggestion && (
                        <p className="text-xs text-ink-faint italic">
                          💡 {warning.suggestion}
                        </p>
                      )}
                    </div>
                  ))}

                  {validationResult.suggestion && (
                    <div className="mt-3 pt-3 border-t border-app-line/50">
                      <p className="text-xs font-medium text-ink mb-2">
                        Alternative suggestion
                      </p>
                      <p className="text-xs text-ink-dull mb-2">
                        {validationResult.suggestion.message}
                      </p>
                      <Button
                        onClick={handleUseVolumeIndexing}
                        variant="accent"
                        size="sm"
                        className="w-full"
                      >
                        Index Volume: {validationResult.suggestion.volume_name}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label slug="name">Display name</Label>
            <Input
              {...localForm.register("name")}
              size="md"
              placeholder="My documents"
              className="bg-app-input"
            />
          </div>

          <TabsRoot value={tab} onValueChange={(v) => setTab(v as SettingsTab)}>
            <TabsList>
              <TabsTrigger value="preset">Preset</TabsTrigger>
              <TabsTrigger value="jobs">
                Jobs {selectedJobs.size > 0 && `(${selectedJobs.size})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preset" className="pt-3">
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                <Label>Indexing mode</Label>
                <div className="grid grid-cols-3 gap-2">
                  {indexModes.map((mode) => {
                    const isSelected = currentMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => handleModeChange(mode.value)}
                        className={clsx(
                          "rounded-lg border p-3 text-left transition-all",
                          isSelected
                            ? "border-accent bg-accent/5 ring-1 ring-accent"
                            : "border-app-line bg-app-box hover:bg-app-hover",
                        )}
                      >
                        <div className="text-xs font-medium text-ink">
                          {mode.label}
                        </div>
                        <div className="mt-1 text-[11px] leading-tight text-ink-faint">
                          {mode.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="jobs" className="pt-3">
              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                <p className="text-xs text-ink-faint">
                  Select which jobs to run after indexing. Extensions can add
                  more jobs.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {jobOptions.map((job) => {
                    const isSelected = selectedJobs.has(job.id);
                    return (
                      <button
                        key={job.id}
                        type="button"
                        aria-label={job.label}
                        onClick={() => toggleJob(job.id)}
                        className={clsx(
                          "flex items-start gap-2 rounded-lg border p-3 text-left transition-all",
                          isSelected
                            ? "border-accent bg-accent/5 ring-1 ring-accent"
                            : "border-app-line bg-app-box hover:bg-app-hover",
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-ink">
                            {job.label}
                          </div>
                          <div className="text-[11px] text-ink-faint mt-1 leading-tight">
                            {job.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </TabsContent>
          </TabsRoot>

          {localForm.formState.errors.root && (
            <p className="text-body-small text-error">
              {localForm.formState.errors.root.message}
            </p>
          )}
        </div>
      </StorageDialog>
    );
  }

  // Render cloud configuration form
  if (step === "cloud-config" && selectedProvider) {
    const provider = selectedProvider;

    return (
      <StorageDialog
        dialog={dialog}
        form={cloudForm}
        onSubmit={onSubmitCloud}
        title={`Add ${provider.name}`}
        icon={<img src={provider.icon} className="size-5" alt="" />}
        description="Configure your cloud storage connection"
        ctaLabel="Add storage"
        loading={addCloudVolume.isPending}
        showBackButton={true}
        onBack={handleBack}
      >
        <div className="space-y-4 h-full overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input
              {...cloudForm.register("display_name")}
              size="md"
              placeholder={`My ${provider.name}`}
              className="bg-app-input"
            />
          </div>

          <>
            <div className="space-y-2">
              <Label>Bucket</Label>
              <Input
                {...cloudForm.register("bucket")}
                size="md"
                placeholder="my-bucket"
                className="bg-app-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Region</Label>
              <Input
                {...cloudForm.register("region")}
                size="md"
                placeholder="us-west-2"
                className="bg-app-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Access key ID</Label>
              <Input
                {...cloudForm.register("access_key_id")}
                size="md"
                placeholder="AKIA..."
                className="bg-app-input"
              />
            </div>
            <div className="space-y-2">
              <Label>Secret access key</Label>
              <Input
                {...cloudForm.register("secret_access_key")}
                type="password"
                size="md"
                placeholder="••••••••••••••••••"
                className="bg-app-input"
              />
            </div>
            {(provider.id === "r2" || provider.id === "minio") && (
              <div className="space-y-2">
                <Label>
                  Endpoint
                  {provider.id === "r2" &&
                    " (e.g., https://account.r2.cloudflarestorage.com)"}
                  {provider.id === "minio" && " (e.g., http://localhost:9000)"}
                </Label>
                <Input
                  {...cloudForm.register("endpoint")}
                  size="md"
                  placeholder={
                    provider.id === "r2"
                      ? "https://account.r2.cloudflarestorage.com"
                      : provider.id === "minio"
                        ? "http://localhost:9000"
                        : "https://..."
                  }
                  className="bg-app-input"
                />
              </div>
            )}
          </>

          {cloudForm.formState.errors.root && (
            <p className="text-body-small text-error">
              {cloudForm.formState.errors.root.message}
            </p>
          )}
        </div>
      </StorageDialog>
    );
  }

  return null;
}
