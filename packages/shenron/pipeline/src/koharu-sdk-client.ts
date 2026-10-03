/**
 * Client JSON Lines du binaire natif `koharu-sdk` (koharu-library/src/bin/koharu-sdk.rs).
 * Requêtes `{id,method,params}` sur stdin, réponses `{id,result}` ou `{id,error}` sur stdout ;
 * les lignes `{event,...}` sont des notifications asynchrones et sont ignorées.
 */

const MAX_BUFFER = 150_000_000;

type SdkResponse = { id?: number; result?: unknown; error?: unknown; event?: string };

export function formatSdkError(error: unknown): string {
	if (typeof error === "string") return error;
	if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
		return (error as { message: string }).message;
	}
	return JSON.stringify(error);
}

export class KoharuSdkClient {
	private readonly child: Bun.Subprocess<"pipe", "pipe", "inherit">;
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private readonly decoder = new TextDecoder();
	private buffer = "";
	private requestId = 0;
	private pending: Promise<unknown> = Promise.resolve();

	constructor(projectRoot: string, binary = "koharu-sdk") {
		this.child = Bun.spawn([binary, "--root", projectRoot], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
		this.reader = this.child.stdout.getReader();
	}

	/** Appels sérialisés : le SDK répond dans l'ordre, un seul appel en vol. */
	call(method: string, params: unknown = {}): Promise<unknown> {
		const next = this.pending.then(() => this.send(method, params));
		this.pending = next.catch(() => undefined);
		return next;
	}

	private async send(method: string, params: unknown): Promise<unknown> {
		const id = ++this.requestId;
		this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		await this.child.stdin.flush();
		for (;;) {
			const end = this.buffer.indexOf("\n");
			if (end >= 0) {
				const line = this.buffer.slice(0, end);
				this.buffer = this.buffer.slice(end + 1);
				if (!line.trim()) continue;
				const response = JSON.parse(line) as SdkResponse;
				if (response.event) continue;
				if (response.id !== id) throw new Error(`unexpected Koharu SDK response ID for ${method}`);
				if (response.error !== undefined) throw new Error(`Koharu SDK ${method}: ${formatSdkError(response.error)}`);
				if (!("result" in response)) throw new Error(`Koharu SDK ${method} returned no result`);
				return response.result;
			}
			const chunk = await this.reader.read();
			if (chunk.done) throw new Error(`Koharu SDK closed during ${method}`);
			this.buffer += this.decoder.decode(chunk.value, { stream: true });
			if (this.buffer.length > MAX_BUFFER) throw new Error("Koharu SDK response exceeds 150 MB");
		}
	}

	/** Ferme stdin (EOF : le SDK s'arrête) et attend la sortie du processus. */
	async close(): Promise<number> {
		this.child.stdin.end();
		this.reader.releaseLock();
		return await this.child.exited;
	}
}
