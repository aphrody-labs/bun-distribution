export type InfraApiClient = {
  baseUrl: string;
  request<T>(path: string, init?: RequestInit): Promise<T>;
};

/** Typed boundary for the HTTP API exposed by `aphrody-infra serve`. */
export function createInfraClient(
  baseUrl = "http://127.0.0.1:8787",
): InfraApiClient {
  return {
    baseUrl,
    async request<T>(path: string, init?: RequestInit) {
      const response = await fetch(new URL(path, `${baseUrl}/`), init);
      if (!response.ok)
        throw new Error(`Aphrody Infra API ${response.status} for ${path}`);
      return response.json() as Promise<T>;
    },
  };
}
