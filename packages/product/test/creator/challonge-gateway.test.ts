import { afterEach, expect, test } from "bun:test";

import {
  Gateway,
  GatewayFatalError,
} from "../../src/creator/commands/challonge/gateway.ts";

/**
 * Faux serveur Gateway Discord (WebSocket sur la boucle locale) : aucun accès réseau externe.
 * Il rejoue le protocole : HELLO, IDENTIFY -> READY, RESUME -> RESUMED, ACK de heartbeat, fermetures forcées.
 */
interface Frame {
  op: number;
  d?: any;
  s?: number | null;
  t?: string | null;
}

interface Script {
  /** Appelé pour chaque trame reçue du client ; `ack` répond à un heartbeat. */
  onFrame?: (
    frame: Frame,
    ws: Bun.ServerWebSocket<unknown>,
    connection: number,
  ) => void;
  /** Appelé à l'ouverture, après le HELLO. */
  onOpen?: (ws: Bun.ServerWebSocket<unknown>, connection: number) => void;
  ackHeartbeats?: boolean;
}

let server: ReturnType<typeof Bun.serve> | undefined;
let controller: AbortController | undefined;

afterEach(() => {
  controller?.abort();
  server?.stop(true);
  server = undefined;
  controller = undefined;
});

function startServer(script: Script) {
  const received: Frame[][] = [];
  let connections = 0;
  const url = (() => {
    server = Bun.serve<undefined>({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: undefined })) return undefined;
        return new Response("upgrade requis", { status: 426 });
      },
      websocket: {
        open(ws) {
          connections += 1;
          received.push([]);
          ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 40 } }));
          script.onOpen?.(ws, connections);
        },
        message(ws, message) {
          const frame = JSON.parse(String(message)) as Frame;
          received[connections - 1]!.push(frame);
          if (frame.op === 1 && script.ackHeartbeats !== false)
            ws.send(JSON.stringify({ op: 11 }));
          script.onFrame?.(frame, ws, connections);
        },
      },
    });
    return `ws://127.0.0.1:${server.port}`;
  })();
  return { url, received, connectionCount: () => connections };
}

const ready = (ws: Bun.ServerWebSocket<unknown>, url: string, seq = 1) =>
  ws.send(
    JSON.stringify({
      op: 0,
      s: seq,
      t: "READY",
      d: { session_id: "sess-1", resume_gateway_url: url, user: { id: "bot" } },
    }),
  );
const dispatch = (ws: Bun.ServerWebSocket<unknown>, seq: number, id: string) =>
  ws.send(
    JSON.stringify({ op: 0, s: seq, t: "INTERACTION_CREATE", d: { id } }),
  );

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs)
        return reject(new Error("délai dépassé en attendant la condition"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function gateway(
  url: string,
  extra: Partial<ConstructorParameters<typeof Gateway>[0]> & {
    events: string[];
  },
) {
  controller = new AbortController();
  const { events, ...options } = extra;
  const g = new Gateway({
    token: "TOKEN-secret-1234",
    getUrl: async () => url,
    onDispatch: (event, data) =>
      events.push(`${event}:${(data as { id?: string }).id ?? ""}`),
    random: () => 0,
    sleep: async () => undefined,
    signal: controller.signal,
    ...options,
  });
  return g.run();
}

test("IDENTIFY puis READY, heartbeats avec ACK et dispatch INTERACTION_CREATE", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame(frame, ws) {
      if (frame.op === 2) {
        ready(ws, srv.url);
        dispatch(ws, 2, "i1");
      }
    },
  });
  const running = gateway(srv.url, { events });
  await waitFor(() => events.includes("INTERACTION_CREATE:i1"));
  await waitFor(
    () => (srv.received[0] ?? []).filter((f) => f.op === 1).length >= 2,
  );

  const identify = srv.received[0]!.find((f) => f.op === 2)!;
  expect(identify.d.token).toBe("TOKEN-secret-1234");
  expect(identify.d.intents).toBe(1);
  expect(identify.d.properties.browser).toBe("creator-kit");
  // Le heartbeat porte le dernier numéro de séquence reçu.
  const beats = srv.received[0]!.filter((f) => f.op === 1);
  expect(beats.at(-1)!.d).toBe(2);
  expect(srv.connectionCount()).toBe(1);
  controller!.abort();
  await running;
});

test("fermeture 4000 : reconnexion avec RESUME (session_id, seq) et sans nouvel IDENTIFY", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame(frame, ws, connection) {
      if (frame.op === 2) {
        ready(ws, srv.url);
        dispatch(ws, 2, "i1");
        setTimeout(() => ws.close(4000, "coupure"), 30);
      }
      if (frame.op === 6 && connection === 2) {
        ws.send(JSON.stringify({ op: 0, s: 3, t: "RESUMED", d: {} }));
        dispatch(ws, 4, "i2");
      }
    },
  });
  const running = gateway(srv.url, { events });
  await waitFor(() => events.includes("INTERACTION_CREATE:i2"));

  expect(srv.connectionCount()).toBe(2);
  const first = srv.received[0]!.map((f) => f.op);
  expect(first).toContain(2);
  const second = srv.received[1]!;
  expect(second.some((f) => f.op === 2)).toBe(false);
  const resume = second.find((f) => f.op === 6)!;
  expect(resume.d).toEqual({
    token: "TOKEN-secret-1234",
    session_id: "sess-1",
    seq: 2,
  });
  controller!.abort();
  await running;
});

test("pas d'ACK : connexion zombie fermée puis reprise", async () => {
  const events: string[] = [];
  const srv = startServer({
    ackHeartbeats: false,
    onFrame(frame, ws, connection) {
      if (frame.op === 2) ready(ws, srv.url);
      if (frame.op === 6 && connection >= 2) {
        ws.send(JSON.stringify({ op: 0, s: 2, t: "RESUMED", d: {} }));
        dispatch(ws, 3, "after-zombie");
      }
    },
  });
  const running = gateway(srv.url, { events });
  await waitFor(() => events.includes("INTERACTION_CREATE:after-zombie"), 6000);
  expect(srv.connectionCount()).toBeGreaterThanOrEqual(2);
  expect(srv.received[1]!.some((f) => f.op === 6)).toBe(true);
  controller!.abort();
  await running;
});

test("opcode 7 (Reconnect) : reprise de session", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame(frame, ws, connection) {
      if (frame.op === 2) {
        ready(ws, srv.url);
        ws.send(JSON.stringify({ op: 7, d: null }));
      }
      if (frame.op === 6 && connection === 2) {
        ws.send(JSON.stringify({ op: 0, s: 2, t: "RESUMED", d: {} }));
        dispatch(ws, 3, "resumed");
      }
    },
  });
  const running = gateway(srv.url, { events });
  await waitFor(() => events.includes("INTERACTION_CREATE:resumed"));
  expect(srv.received[1]!.find((f) => f.op === 6)!.d.session_id).toBe("sess-1");
  controller!.abort();
  await running;
});

test("opcode 9 d=false : nouvel IDENTIFY (la session est abandonnée)", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame(frame, ws, connection) {
      if (frame.op === 2 && connection === 1) {
        ready(ws, srv.url);
        ws.send(JSON.stringify({ op: 9, d: false }));
      }
      if (frame.op === 2 && connection === 2) {
        ready(ws, srv.url, 1);
        dispatch(ws, 2, "fresh");
      }
    },
  });
  const running = gateway(srv.url, { events });
  await waitFor(() => events.includes("INTERACTION_CREATE:fresh"));
  expect(srv.received[1]!.some((f) => f.op === 2)).toBe(true);
  expect(srv.received[1]!.some((f) => f.op === 6)).toBe(false);
  controller!.abort();
  await running;
});

test("opcode 9 d=true : tentative de RESUME", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame(frame, ws, connection) {
      if (frame.op === 2) {
        ready(ws, srv.url);
        ws.send(JSON.stringify({ op: 9, d: true }));
      }
      if (frame.op === 6 && connection === 2) {
        ws.send(JSON.stringify({ op: 0, s: 2, t: "RESUMED", d: {} }));
        dispatch(ws, 3, "back");
      }
    },
  });
  const running = gateway(srv.url, { events });
  await waitFor(() => events.includes("INTERACTION_CREATE:back"));
  controller!.abort();
  await running;
});

test("code 4004 (token refusé) : arrêt définitif, sans reconnexion", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame: (frame, ws) =>
      frame.op === 2 && ws.close(4004, "Authentication failed"),
  });
  await expect(gateway(srv.url, { events })).rejects.toBeInstanceOf(
    GatewayFatalError,
  );
  await Bun.sleep(100);
  expect(srv.connectionCount()).toBe(1);
});

test("code 4014 (intents non autorisés) : message en français", async () => {
  const events: string[] = [];
  const srv = startServer({
    onFrame: (frame, ws) =>
      frame.op === 2 && ws.close(4014, "Disallowed intents"),
  });
  const error = await gateway(srv.url, { events }).catch((e: Error) => e);
  expect(error).toBeInstanceOf(GatewayFatalError);
  expect((error as GatewayFatalError).code).toBe(4014);
  expect((error as Error).message).toContain("intents");
});

test("la connexion initiale utilise v=10 et encoding=json", async () => {
  const events: string[] = [];
  let seen = "";
  server = Bun.serve<undefined>({
    port: 0,
    fetch(req, s) {
      seen = req.url;
      return s.upgrade(req, { data: undefined })
        ? undefined
        : new Response("x", { status: 426 });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 10_000 } }));
      },
      message: () => undefined,
    },
  });
  const running = gateway(`ws://127.0.0.1:${server.port}`, { events });
  await waitFor(() => seen !== "");
  expect(new URL(seen.replace("http", "ws")).searchParams.get("v")).toBe("10");
  expect(new URL(seen.replace("http", "ws")).searchParams.get("encoding")).toBe(
    "json",
  );
  controller!.abort();
  await running;
});
