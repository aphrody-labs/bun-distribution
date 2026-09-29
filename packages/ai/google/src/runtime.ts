export type GoogleProject = "aphrody" | "rgfr";

export interface GoogleRuntime {
	project: GoogleProject;
	location: string;
	home: string;
	auth: string;
}

/** Resolve only public runtime configuration; never reads credentials. */
export function googleRuntime(env: Record<string, string | undefined> = process.env): GoogleRuntime {
	const configuredProject = env.APHRODY_VERTEX_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
	const project = configuredProject === "rgfr" || configuredProject === "rgfr-8927d"
		? "rgfr"
		: "aphrody";
	return {
		project,
		location: env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
		home: env.APHRODY_HOME ?? "~/.aphrody",
		auth: env.APHRODY_GCP_AUTH ?? "adc-or-secret-manager",
	};
}
