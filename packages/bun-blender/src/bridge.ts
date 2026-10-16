// Socket bridge to a running Blender with the `blender_mcp` add-on (core add-on of the aphrody
// Blender build, or the MIT-licensed aphrody-labs/mcp-for-blender add-on).
// Protocol: one JSON command `{type, params}` per request, one JSON reply `{status, result|message}`.

const HOST = Bun.env.BLENDER_MCP_HOST ?? "127.0.0.1";
const PORT = Number(Bun.env.BLENDER_MCP_PORT ?? 9876);

export interface LiveReply {
  status: "success" | "error";
  result?: unknown;
  message?: string;
}

export function sendLive(
  type: string,
  params: Record<string, unknown> = {},
  timeoutMs = 180_000,
): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const decoder = new TextDecoder();
  let text = "";
  let done = false;
  const finish = (fn: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fn();
  };
  const timer = setTimeout(
    () => finish(() => reject(new Error(`blender_mcp: no reply to ${type}`))),
    timeoutMs,
  );
  Bun.connect({
    hostname: HOST,
    port: PORT,
    socket: {
      open(socket) {
        socket.write(JSON.stringify({ type, params }));
      },
      data(socket, chunk) {
        text += decoder.decode(chunk, { stream: true });
        let reply: LiveReply;
        try {
          reply = JSON.parse(text) as LiveReply;
        } catch {
          return;
        }
        // Settle before end(): end() fires close() synchronously.
        finish(() =>
          reply.status === "success"
            ? resolve(reply.result)
            : reject(new Error(reply.message ?? `blender_mcp: ${type} failed`)),
        );
        socket.end();
      },
      close() {
        finish(() => reject(new Error("blender_mcp: connection closed")));
      },
      error(_socket, err) {
        finish(() => reject(err));
      },
    },
  }).catch((err: unknown) =>
    finish(() =>
      reject(
        new Error(
          `blender_mcp not reachable on ${HOST}:${PORT}: ${String(err)}`,
        ),
      ),
    ),
  );
  return promise;
}

export async function liveAvailable(): Promise<boolean> {
  try {
    await sendLive("ping", {}, 3000);
    return true;
  } catch {
    return false;
  }
}
