const REDACTED = "[REDACTED]";

export function redactSensitive(value: string): string {
	return value
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
		.replace(/\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9._-]+\b/g, REDACTED)
		.replace(/\b(?:mfa\.[\w-]{20,}|[\w-]{20,}\.[\w-]{6}\.[\w-]{20,})\b/g, REDACTED)
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
		.replace(
			/([?&](?:code|token|access_token|refresh_token|secret|password|api_key)=)[^&\s]+/gi,
			`$1${REDACTED}`
		)
		.replace(
			/((?:access_token|refresh_token|client_secret|api_key|password)\s*[:=]\s*["']?)[^"',\s}]+/gi,
			`$1${REDACTED}`
		);
}

export function safeLogValue(value: unknown): string {
	if (value instanceof Error) return `${value.name}: ${redactSensitive(value.message)}`;
	if (typeof value === "string") return redactSensitive(value);
	try {
		return redactSensitive(JSON.stringify(value));
	} catch {
		return String(value);
	}
}
