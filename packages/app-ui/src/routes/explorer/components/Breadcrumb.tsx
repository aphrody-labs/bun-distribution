import { clsx } from "clsx";
import type { SdPath } from "@aphrody/drive-client";

interface BreadcrumbProps {
  path: SdPath;
  onNavigate: (path: SdPath) => void;
}

interface PathSegment {
  name: string;
  path: SdPath;
}

function parseSdPathSegments(sdPath: SdPath): PathSegment[] {
  if ("Physical" in sdPath) {
    const { device_slug, path } = sdPath.Physical;
    const parts = path.split("/").filter(Boolean);

    return parts.map((part, index) => ({
      name: part,
      path: {
        Physical: {
          device_slug,
          path: "/" + parts.slice(0, index + 1).join("/"),
        },
      },
    }));
  }

  if ("Cloud" in sdPath) {
    const { service, identifier, path } = sdPath.Cloud;
    const parts = path.split("/").filter(Boolean);

    return parts.map((part, index) => ({
      name: part,
      path: {
        Cloud: {
          service,
          identifier,
          path: parts.slice(0, index + 1).join("/"),
        },
      },
    }));
  }

  return [];
}

export function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  const segments = parseSdPathSegments(path);

  return (
    <div className="flex items-center gap-1 text-body-medium">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <div
            key={JSON.stringify(segment.path)}
            className="flex items-center gap-1"
          >
            {index > 0 && <span className="text-outline">/</span>}
            <button
              onClick={() => !isLast && onNavigate(segment.path)}
              disabled={isLast}
              className={clsx(
                isLast
                  ? "text-on-surface font-medium cursor-default"
                  : "text-on-surface-variant hover:text-on-surface cursor-pointer",
              )}
            >
              {segment.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
