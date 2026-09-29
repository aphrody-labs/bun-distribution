export function safeRequestPath(value: string): string {
	try {
		return new URL(value, "http://localhost").pathname;
	} catch {
		return "/invalid-request-target";
	}
}
