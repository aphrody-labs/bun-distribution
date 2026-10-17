/**
 * Bun OS gamestream server: serves the WebGPU client, runs the WebSocket signalling and
 * supervises the WebRTC sender (`GAMESTREAM_SENDER`, JSON lines over stdin/stdout).
 *
 *   GAMESTREAM_HOST    bind address (default 127.0.0.1; the VPS binds the wg1 address)
 *   GAMESTREAM_PORT    HTTP/WebSocket port (default 8797)
 *   GAMESTREAM_SENDER  sender command line; without it the page reports "no sender"
 */
import type { ServerWebSocket, Subprocess } from "bun";
import page from "./client/index.html";
import type { ClientMessage, SenderInfo, SenderMessage, ServerMessage } from "./protocol.ts";

const hostname = Bun.env.GAMESTREAM_HOST ?? "127.0.0.1";
const port = Number(Bun.env.GAMESTREAM_PORT ?? 8797);
const senderCommand = Bun.env.GAMESTREAM_SENDER?.trim().split(/\s+/) ?? [];

interface Viewer {
  id: string;
}

let viewer: ServerWebSocket<Viewer> | null = null;
let senderInfo: SenderInfo | null = null;
let sender: Subprocess<"pipe", "pipe", "inherit"> | null = null;

function toViewer(message: ServerMessage): void {
  viewer?.send(JSON.stringify(message));
}

function toSender(message: Record<string, unknown>): void {
  if (!sender) return;
  sender.stdin.write(`${JSON.stringify(message)}\n`);
  sender.stdin.flush();
}

function onSenderMessage(message: SenderMessage): void {
  if (message.type === "ready") {
    const { type: _type, ...info } = message;
    senderInfo = info;
    console.log(`[gamestream] sender ready ${info.width}x${info.height}@${info.fps} ${info.codec}`);
    return;
  }
  if ("id" in message && message.id !== viewer?.data.id) return;
  const { id: _id, ...forward } = message as SenderMessage & { id?: string };
  toViewer(forward as ServerMessage);
}

async function readSender(stdout: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stdout) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) {
        try {
          onSenderMessage(JSON.parse(line) as SenderMessage);
        } catch {
          console.error(`[gamestream] invalid sender line: ${line.slice(0, 200)}`);
        }
      }
      newline = pending.indexOf("\n");
    }
  }
}

function spawnSender(): void {
  if (senderCommand.length === 0) return;
  const child = Bun.spawn(senderCommand, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  sender = child;
  void readSender(child.stdout);
  void child.exited.then(code => {
    console.error(`[gamestream] sender exited (${code}); restarting`);
    sender = null;
    senderInfo = null;
    toViewer({ type: "error", message: "sender restarted" });
    setTimeout(spawnSender, 1000);
  });
}

const server = Bun.serve({
  hostname,
  port,
  development: Bun.env.NODE_ENV !== "production",
  routes: {
    "/": page,
    "/healthz": () => Response.json({ ok: true, sender: senderInfo, viewer: viewer !== null }),
    "/ws": (req, srv) =>
      srv.upgrade(req, { data: { id: crypto.randomUUID() } })
        ? undefined
        : new Response("WebSocket upgrade expected", { status: 426 }),
  },
  websocket: {
    data: {} as Viewer,
    open(ws) {
      if (viewer) {
        toSender({ type: "stop", id: viewer.data.id });
        viewer.close(4000, "replaced by a new viewer");
      }
      viewer = ws;
      ws.send(
        JSON.stringify({
          type: "hello",
          sender: senderInfo,
        } satisfies ServerMessage),
      );
    },
    message(ws, raw) {
      if (ws !== viewer) return;
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      toSender({ ...message, id: ws.data.id });
    },
    close(ws) {
      if (ws !== viewer) return;
      toSender({ type: "stop", id: ws.data.id });
      viewer = null;
    },
  },
});

spawnSender();
console.log(`[gamestream] ${server.url} (sender: ${senderCommand.join(" ") || "none"})`);
