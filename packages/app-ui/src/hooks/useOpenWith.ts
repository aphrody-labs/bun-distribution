import { useQuery } from "@tanstack/react-query";
import { usePlatform, type OpenResult } from "../contexts/PlatformContext";
import { toast } from "@aphrody/m3-primitives";

export function useOpenWith(paths: string[]) {
  const platform = usePlatform();

  const { data: apps, isLoading } = useQuery({
    queryKey: ["openWith", ...paths],
    queryFn: async () => {
      if (!platform.getAppsForPaths) {
        return [];
      }
      return platform.getAppsForPaths(paths);
    },
    enabled: paths.length > 0 && !!platform.getAppsForPaths,
  });

  const openWithDefault = async (path: string) => {
    if (!platform.openPathDefault) {
      toast.error("Cannot open files here: this platform has no open handler");
      return;
    }

    try {
      const result = await platform.openPathDefault(path);
      handleOpenResult(result);
    } catch (e) {
      toast.error(`Could not open file: ${e}`);
    }
  };

  const openWithApp = async (path: string, appId: string) => {
    if (!platform.openPathWithApp) {
      toast.error("Cannot open files here: this platform has no open handler");
      return;
    }

    try {
      const result = await platform.openPathWithApp(path, appId);
      handleOpenResult(result);
    } catch (e) {
      toast.error(`Could not open file: ${e}`);
    }
  };

  const openMultipleWithApp = async (filePaths: string[], appId: string) => {
    if (!platform.openPathsWithApp) {
      toast.error("Cannot open files here: this platform has no open handler");
      return;
    }

    try {
      const results = await platform.openPathsWithApp(filePaths, appId);
      results.forEach(handleOpenResult);
    } catch (e) {
      toast.error(`Could not open files: ${e}`);
    }
  };

  return {
    apps: apps ?? [],
    isLoading,
    openWithDefault,
    openWithApp,
    openMultipleWithApp,
  };
}

function handleOpenResult(result: OpenResult) {
  switch (result.status) {
    case "success":
      // Silent success
      break;
    case "file_not_found":
      toast.error(
        `File not found: ${result.path}. Check that it was not moved or deleted.`,
      );
      break;
    case "app_not_found":
      toast.error(`Application not found: ${result.app_id}. Pick another app.`);
      break;
    case "permission_denied":
      toast.error(`Permission denied: ${result.path}. Check file permissions.`);
      break;
    case "platform_error":
      toast.error(`Could not open: ${result.message}`);
      break;
  }
}
