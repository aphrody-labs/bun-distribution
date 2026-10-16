/**
 * Convenience re-exports from @aphrody/drive-client
 *
 * You can import from here OR directly from @aphrody/drive-client/hooks
 * Both work identically!
 */

// Re-export hooks from @aphrody/drive-client (no longer duplicated!)
export {
  SpacedriveProvider,
  useSpacedriveClient,
  useClient,
  useCoreQuery,
  useLibraryQuery,
  useCoreMutation,
  useLibraryMutation,
  useNormalizedQuery,
} from "@aphrody/drive-client/hooks";

// Export client type
export type { SpacedriveClient } from "@aphrody/drive-client";

// Export commonly used types for convenience
export type {
  Location,
  LocationsListOutput,
  LibraryInfo,
} from "@aphrody/drive-client";

// Export icon utilities
export { getDeviceIcon, getVolumeIcon } from "@aphrody/drive-client";
