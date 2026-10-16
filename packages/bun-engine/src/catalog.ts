export type Support = "supported" | "experimental" | "blocked";

export interface GamePolicy {
  appId: string;
  name: string;
  support: Support;
  reason: string;
  requiresPublisherServices: boolean;
}

export const games: Record<string, GamePolicy> = {
  "4080220": {
    appId: "4080220",
    name: "EA SPORTS FC 27",
    support: "experimental",
    reason: "Windows publisher services and DirectX 12 compatibility must be qualified end to end",
    requiresPublisherServices: true,
  },
};

export function policyFor(appId: string): GamePolicy {
  return (
    games[appId] ?? {
      appId,
      name: "Steam app " + appId,
      support: "experimental",
      reason: "No verified compatibility policy is recorded",
      requiresPublisherServices: false,
    }
  );
}
