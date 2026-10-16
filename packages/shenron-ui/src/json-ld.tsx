import type { ReactElement } from "react";

/** A serializable Schema.org document. The host owns its vocabulary and data. */
export type JsonLdData =
  Record<string, unknown> | readonly Record<string, unknown>[];

/**
 * Renders escaped JSON-LD without requiring a framework or an application data layer.
 * Escaping keeps editorial values from closing the inline script element.
 */
export function JsonLd({ data }: { data: JsonLdData }): ReactElement {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
