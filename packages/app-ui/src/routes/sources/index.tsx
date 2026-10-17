import { useNavigate } from "react-router-dom";
import { useLibraryQuery } from "../../contexts/SpacedriveContext";
import { useTabManager } from "../../components/TabManager/useTabManager";
import { SourceCard } from "../../components/Sources/SourceCard";
import { TopBarPortal, TopBarItem } from "../../TopBar";
import { Button, CircleButton, Icon } from "@aphrody/m3-primitives";
import { SearchBar } from "@aphrody/m3-primitives";

export function SourcesHome() {
  const navigate = useNavigate();
  const { createTab } = useTabManager();
  const {
    data: sourcesRaw,
    isLoading,
    error,
  } = useLibraryQuery({
    type: "sources.list",
    input: { data_type: null },
  });
  const sources = sourcesRaw as any[] | undefined;

  return (
    <>
      <TopBarPortal
        left={
          <>
            <TopBarItem id="back" label="Back" priority="high">
              <CircleButton icon="arrow_back" title="Back" onClick={() => navigate(-1)} />
            </TopBarItem>
            <TopBarItem id="title" label="Title" priority="high">
              <h1 className="text-on-surface text-title-large">Sources</h1>
            </TopBarItem>
          </>
        }
        right={
          <>
            <TopBarItem id="search" label="Search" priority="high">
              <SearchBar
                placeholder="Search sources..."
                value=""
                onChange={() => {}}
                onClear={() => {}}
                className="w-64"
              />
            </TopBarItem>
            <TopBarItem id="add-source" label="Add source" priority="high">
              <CircleButton icon="add" onClick={() => createTab("Adapters", "/sources/adapters")} title="Add source" />
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

        {error && (
          <div className="bg-error-container rounded-medium p-4">
            <p className="text-body-medium text-on-error-container">Failed to load sources: {String(error)}</p>
          </div>
        )}

        {sources && sources.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-on-surface-variant text-body-medium">No sources: add one to start syncing</p>
            <p className="text-outline mt-1 text-body-small">Add a data source to get started</p>
            <Button
              variant="filled"
              size="lg"
              onClick={() => createTab("Adapters", "/sources/adapters")}
              className="mt-4"
            >
              <Icon name="add" size={18} />
              Add source
            </Button>
          </div>
        )}

        {sources && sources.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map(source => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
