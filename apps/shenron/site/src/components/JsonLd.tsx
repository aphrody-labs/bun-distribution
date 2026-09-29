import type { Thing, WithContext } from "schema-dts";
import { JsonLd as PortableJsonLd } from "@shenron/ui/server";

/** Shenron's typed Schema.org adapter for the portable JSON-LD renderer. */
export function JsonLd<T extends Thing>({ data }: { data: WithContext<T> }) {
	return <PortableJsonLd data={data as Record<string, unknown>} />;
}
