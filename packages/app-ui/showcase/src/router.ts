// A hash router: `#/theme` selects a page. Hash routes work from file://, inside Tauri and behind any static host,
// and the D-pad Back key maps to `history.back()`.
import { useCallback, useSyncExternalStore } from "react";

export function parseRoute(hash: string): string {
  const path = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return path === "" ? "overview" : path.replace(/\/+$/, "");
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

/** The current route id and a navigate function. */
export function useRoute(): {
  route: string;
  navigate: (route: string) => void;
} {
  const route = useSyncExternalStore(
    subscribe,
    () => parseRoute(location.hash),
    () => "overview",
  );
  const navigate = useCallback((next: string) => {
    location.hash = `#/${next}`;
  }, []);
  return { route, navigate };
}
