// SPDX-License-Identifier: Apache-2.0
import { buildSchema, graphql } from "graphql";
import type { Snapshot } from "./model.ts";

export const SDL = `
enum TimelineKind { episode movie manga age }
type TimelineEntry {
  key: ID!, kind: TimelineKind!, id: Int!, rank: Int,
  title: String!, titleJa: String, series: String, era: String!, eraLabel: String,
  number: Int, date: String, href: String!, api: String!,
  ageYear: Int, ageMonth: Int, ageDay: Int, orderIdx: Int,
  description: String, charactersInvolved: [String!]!, sourceRef: String, canon: Boolean
}
type Timeline { source: String!, generation: String!, fetchedAt: String!, mediaTotal: Int!, ageTotal: Int!, entries: [TimelineEntry!]! }
type Query { timeline: Timeline!, timelineEntry(key: ID!): TimelineEntry, timelineEntries(kind: TimelineKind, era: String, offset: Int = 0, limit: Int = 100): [TimelineEntry!]! }
`;
const schema = buildSchema(SDL);
export function query(
  snapshot: Snapshot,
  source: string,
  variables?: Record<string, unknown>,
  operationName?: string,
) {
  return graphql({
    schema,
    source,
    variableValues: variables,
    operationName,
    rootValue: {
      timeline: () => snapshot,
      timelineEntry: ({ key }: { key: string }) =>
        snapshot.entries.find((e) => e.key === key) ?? null,
      timelineEntries: ({
        kind,
        era,
        offset = 0,
        limit = 100,
      }: {
        kind?: string;
        era?: string;
        offset?: number;
        limit?: number;
      }) => {
        if (offset < 0 || limit < 1 || limit > 1000)
          throw new Error("offset >= 0 and limit 1..1000 required");
        return snapshot.entries
          .filter((e) => (!kind || e.kind === kind) && (!era || e.era === era))
          .slice(offset, offset + limit);
      },
    },
  });
}
