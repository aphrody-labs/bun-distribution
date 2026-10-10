import { useState, useCallback, useId, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLibraryQuery, useLibraryMutation } from "../../contexts/SpacedriveContext";
import { TopBarPortal, TopBarItem } from "../../TopBar";
import { Icon, Button, CircleButton, m3FocusRing, m3StateLayer } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

/** M3 outlined text field, dense (desktop density step). */
const fieldClassName =
  "h-10 w-full rounded-extra-small border border-outline bg-transparent px-3 text-body-medium text-on-surface placeholder:text-on-surface-variant outline-none transition-colors duration-200 ease-standard hover:border-on-surface focus:border-2 focus:border-primary focus:px-[11px]";
import { ExpandableSearchButton } from "../explorer/components/ExpandableSearchButton";
import { SourceTypeIcon } from "../../components/Sources/SourceTypeIcon";

export function AdaptersScreen() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");

  const { data: adaptersRaw, isLoading } = useLibraryQuery({
    type: "adapters.list",
    input: {},
  });
  const adapters = adaptersRaw as any[] | undefined;

  const [selectedAdapter, setSelectedAdapter] = useState<string | null>(null);
  const selected = adapters?.find((a) => a.id === selectedAdapter);

  const filteredAdapters = useMemo(() => {
    if (!adapters || !searchValue.trim()) return adapters;
    const q = searchValue.toLowerCase();
    return adapters.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.data_type.toLowerCase().includes(q),
    );
  }, [adapters, searchValue]);

  return (
    <>
      <TopBarPortal
        left={
          <>
            <TopBarItem id="navigation" label="Navigation" priority="high">
              <CircleButton icon="arrow_back" onClick={() => navigate(-1)} title="Back" />
            </TopBarItem>
            <TopBarItem id="title" label="Title" priority="high">
              <span className="text-on-surface whitespace-nowrap text-title-small">
                Data adapters
              </span>
            </TopBarItem>
          </>
        }
        right={
          <>
            <TopBarItem id="search" label="Search" priority="high">
              <ExpandableSearchButton
                placeholder="Search adapters..."
                value={searchValue}
                onChange={setSearchValue}
                onClear={() => setSearchValue("")}
              />
            </TopBarItem>
          </>
        }
      />
      <div className="p-6">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-outline text-body-medium">Loading...</div>
          </div>
        )}

        {adapters && adapters.length === 0 && !searchValue && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-on-surface-variant text-body-medium">No adapters installed</p>
            <p className="text-outline mt-1 text-body-small">
              Adapters are loaded from the adapters directory on startup
            </p>
          </div>
        )}

        {filteredAdapters && filteredAdapters.length === 0 && searchValue && (
          <div className="flex items-center justify-center py-20">
            <p className="text-outline text-body-medium">No matching adapters</p>
          </div>
        )}

        {filteredAdapters && filteredAdapters.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {filteredAdapters.map((adapter) => (
              <button
                key={adapter.id}
                onClick={() => setSelectedAdapter(adapter.id)}
                className={clsx(
                  "border-outline-variant bg-surface-container-low text-on-surface flex items-center gap-3 rounded-medium border p-3 text-left",
                  m3StateLayer,
                  m3FocusRing,
                )}
              >
                <SourceTypeIcon type={adapter.data_type} svg={adapter.icon_svg} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-on-surface truncate text-label-large">
                      {adapter.name}
                    </span>
                    <span className="bg-surface-container-highest text-on-surface-variant shrink-0 rounded-extra-small px-1.5 py-0.5 text-label-small">
                      v{adapter.version}
                    </span>
                    {adapter.update_available && (
                      <span className="shrink-0 rounded-small bg-primary-container px-2 py-0.5 text-label-small text-on-primary-container">
                        Update
                      </span>
                    )}
                  </div>
                  <div className="text-on-surface-variant mt-0.5 truncate text-body-small">
                    {adapter.description || adapter.data_type}
                  </div>
                  {adapter.author && (
                    <div className="text-outline mt-0.5 text-label-small">by {adapter.author}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Configure dialog */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/32">
            <div className="bg-surface-container-high w-full max-w-md rounded-extra-large p-6 shadow-md3-3">
              <div className="mb-4 flex items-center gap-3">
                <SourceTypeIcon type={selected.data_type} svg={selected.icon_svg} size="sm" />
                <h3 className="text-on-surface text-headline-small">{selected.name}</h3>
              </div>
              <ConfigureForm
                adapterId={selected.id}
                adapterName={selected.name}
                onDone={() => setSelectedAdapter(null)}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ConfigureForm({
  adapterId,
  adapterName,
  onDone,
}: {
  adapterId: string;
  adapterName: string;
  onDone: () => void;
}) {
  const navigate = useNavigate();

  const {
    data: fields,
    isLoading,
    error: queryError,
  } = useLibraryQuery({
    type: "adapters.config",
    input: { adapter_id: adapterId },
  });

  const createSource = useLibraryMutation("sources.create");
  const syncSource = useLibraryMutation("sources.sync");

  const [name, setName] = useState("");
  const nameId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Source name is required");
      return;
    }

    try {
      const config: Record<string, unknown> = {};
      for (const field of fields ?? []) {
        const val = values[field.key]?.trim() ?? "";
        if (field.required && !val) {
          setError(`${field.name} is required`);
          return;
        }
        if (!val && !field.required) continue;

        if (field.field_type === "integer" && val) {
          config[field.key] = parseInt(val, 10);
        } else if (field.field_type === "boolean") {
          config[field.key] = val === "true";
        } else {
          config[field.key] = val;
        }
      }

      const source = await createSource.mutateAsync({
        name: name.trim(),
        adapter_id: adapterId,
        config: config as any,
      });

      // Dispatch sync as a background job
      await syncSource.mutateAsync({
        source_id: source.id,
      });

      setResult(
        "Source created. Sync is running in the background — check the job manager for progress.",
      );
    } catch (e) {
      setError(String(e));
    }
  };

  if (isLoading) {
    return <div className="text-outline py-8 text-center text-body-medium">Loading...</div>;
  }

  if (queryError) {
    return (
      <div className="rounded-small bg-error-container p-3 text-body-small text-on-error-container">
        Failed to load config: {String(queryError)}
      </div>
    );
  }

  if (result) {
    const isError = result.startsWith("Sync failed");
    return (
      <div className="flex flex-col items-center py-6">
        <p className={`text-body-medium ${isError ? "text-error" : "text-on-surface"}`}>
          {isError ? "Something went wrong" : "Source added"}
        </p>
        <p className="text-outline mt-1 text-body-small">{result}</p>
        <Button
          aria-label="Done"
          title="Done"
          variant="filled"
          size="lg"
          onClick={() => {
            onDone();
            navigate("/sources");
          }}
          className="mt-4"
        >
          <Icon name="check" size={18} />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={nameId} className="text-on-surface-variant mb-1 block text-label-medium">
          Source name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g., My ${adapterName}`}
          className={fieldClassName}
        />
      </div>

      {fields?.map((field) => (
        <div key={field.key}>
          <label className="text-on-surface-variant mb-1 block text-label-medium">
            {field.name}
            {field.required && <span className="ml-1 text-error">*</span>}
          </label>
          {field.description && (
            <p className="text-on-surface-variant mb-1 text-body-small">{field.description}</p>
          )}
          <input
            type={field.secret ? "password" : "text"}
            value={values[field.key] ?? ""}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.default ? `Default: ${field.default}` : undefined}
            className={fieldClassName}
          />
        </div>
      ))}

      {error && (
        <div className="rounded-small bg-error-container p-2 text-body-small text-on-error-container">
          {error}
        </div>
      )}

      <div className="mt-1 flex justify-end gap-2">
        <Button aria-label="Cancel" title="Cancel" variant="text" size="lg" onClick={onDone}>
          <Icon name="close" size={18} />
        </Button>
        <Button variant="filled" size="lg" onClick={handleSubmit} disabled={createSource.isPending}>
          Add & sync
        </Button>
      </div>
    </div>
  );
}
