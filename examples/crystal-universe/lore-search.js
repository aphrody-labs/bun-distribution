// SPDX-License-Identifier: Apache-2.0
const series = {
  "": { queryPrefix: "", titlePrefix: null },
  manga: { queryPrefix: "", titlePrefix: null },
  dragonball: { queryPrefix: "Dragon Ball tome", titlePrefix: "Dragon Ball — tome " },
  dragonballsuper: {
    queryPrefix: "Dragon Ball Super",
    titlePrefix: "Dragon Ball Super — chapitre ",
  },
};

export function buildLoreSearchRequest(query, sourceId) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  const normalizedSource = typeof sourceId === "string" ? sourceId.trim() : "";
  if (normalizedQuery.length < 2 || normalizedQuery.length > 120)
    return { error: "La recherche doit contenir entre 2 et 120 caractères." };
  const selected = series[normalizedSource];
  if (!selected) return { error: "Le corpus sélectionné n'est pas disponible." };
  return {
    query: [selected.queryPrefix, normalizedQuery].filter(Boolean).join(" "),
    sourceId: normalizedSource ? "manga" : "",
    limit: selected.titlePrefix ? 25 : 8,
    titlePrefix: selected.titlePrefix,
  };
}

export function filterLoreSearchPayload(payload, sourceId) {
  const titlePrefix = series[sourceId]?.titlePrefix;
  if (!titlePrefix) return payload;
  const items = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.hits)
      ? payload.hits
      : [];
  return {
    ...payload,
    results: items.filter((item) => item?.title?.startsWith(titlePrefix)).slice(0, 8),
  };
}
