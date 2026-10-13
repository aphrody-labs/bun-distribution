import { afterEach, describe, expect, test } from "bun:test";
import { DesktopError, DesktopSession } from "@aphrody/runtime-sdk/desktop";

const sessions: DesktopSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

test("desktop refuses a missing precompiled artifact before opening the runtime", async () => {
  await expect(
    DesktopSession.open({
      executable: "/__yolo_missing_desktop_artifact__",
      grants: [],
      allowedOrigins: [],
    }),
  ).rejects.toBeInstanceOf(DesktopError);
});

test("desktop startup preserves an already cancelled caller without spawning", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled before engine startup");
  controller.abort(reason);
  await expect(
    DesktopSession.open({
      executable: "/__yolo_missing_desktop_artifact__",
      grants: [],
      allowedOrigins: [],
      signal: controller.signal,
    }),
  ).rejects.toBe(reason);
});

// Requires the actual qualified native host. A skipped suite is not R3 rendering evidence.
const executable = process.env["YOLO_DESKTOP_TEST_BIN"];

const serve = (): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        `<!doctype html><html><head><title>Desktop R3 qualification</title>
<style>body{background:#eaddff;font:24px sans-serif;padding:48px;color:#21005d}
button{background:#6750a4;color:white;border:0;border-radius:20px;padding:16px}</style></head>
<body><h1>Native desktop R3</h1><button>Rendered system WebView</button>
<script>navigator.geolocation.getCurrentPosition(()=>{},()=>{});</script></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
  });

const open = async (
  origin: string,
  grants: ("window.create" | "window.control" | "window.observe")[],
): Promise<DesktopSession> => {
  const session = await DesktopSession.open({
    executable: executable!,
    grants,
    allowedOrigins: [origin],
  });
  sessions.push(session);
  return session;
};

const waitEvent = async (session: DesktopSession, kind: string, window: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  let sequence = 0;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- sondage séquentiel : chaque lot d'événements fixe le curseur du suivant
    const batch = await session.events(sequence);
    sequence = batch.sequence;
    if (batch.events.some((event) => event.kind === kind && event.window === window)) return;
    // oxlint-disable-next-line no-await-in-loop -- délai entre deux lectures séquentielles du sondage
    await Bun.sleep(25);
  }
  throw new Error(`missing native event ${kind} for ${window}`);
};

describe.skipIf(executable === undefined)("actual precompiled desktop system-WebView host", () => {
  test("native origin and grant denials do not open privileged pages", async () => {
    const server = serve();
    try {
      const denied = await open(server.url.origin, []);
      await expect(
        denied.createWindow({ url: String(server.url), title: "denied" }),
      ).rejects.toMatchObject({ code: "PermissionDenied" });
      const session = await open(server.url.origin, ["window.create", "window.observe"]);
      await expect(
        session.createWindow({ url: "https://example.test", title: "wrong origin" }),
      ).rejects.toMatchObject({ code: "PermissionDenied" });
      const window = await session.createWindow({ url: String(server.url), title: "R3 grants" });
      await expect(window.setTitle("undeclared mutation")).rejects.toMatchObject({
        code: "PermissionDenied",
      });
      await window.close();
      await expect(window.info()).rejects.toMatchObject({ code: "InvalidHandle" });
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test("real UI loading, native browser permission denial, events and destruction", async () => {
    const server = serve();
    try {
      const session = await open(server.url.origin, [
        "window.create",
        "window.control",
        "window.observe",
      ]);
      const window = await session.createWindow({
        url: String(server.url),
        title: "Native desktop R3",
        width: 640,
        height: 480,
      });
      await waitEvent(session, "load-finished", window.id);
      await waitEvent(session, "permission-denied", window.id);
      expect(await window.info()).toMatchObject({ visible: true });
      await window.resize(800, 600);
      await window.setTitle("Native desktop R3 qualified");
      await window.close();
      await waitEvent(session, "destroyed", window.id);
      await expect(window.info()).rejects.toMatchObject({ code: "InvalidHandle" });
      await session.close();
      await expect(session.events()).rejects.toMatchObject({ code: "SessionClosed" });
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test("in-flight create cancellation destroys its resource and session shutdown is idempotent", async () => {
    const server = serve();
    try {
      const session = await open(server.url.origin, ["window.create", "window.observe"]);
      const controller = new AbortController();
      const reason = new Error("cancelled native window creation");
      const pending = session.createWindow({
        url: String(server.url),
        title: "cancel me",
        signal: controller.signal,
      });
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      await waitEvent(session, "destroyed", "window-1");
      await Promise.all([session.close(), session.close()]);
    } finally {
      server.stop(true);
    }
  }, 30_000);
});
