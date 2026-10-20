import { verifyPayload } from "./verify-payload";

const [mode = Bun.env.BUN_OS_COMPOSITION === "desktop" ? "cosmic" : "health", ...args] = Bun.argv.slice(2);
const root = Bun.env.BUN_OS_ROOT ?? "/opt/bun-os";
const desktopCommands = [
  "cosmic-session",
  "cosmic-comp",
  "cosmic-panel",
  "cosmic-settings",
  "cosmic-settings-daemon",
  "cosmic-app-library",
  "cosmic-launcher",
  "cosmic-workspaces",
  "cosmic-notifications",
  "cosmic-bg",
  "cosmic-files",
  "cosmic-term",
];
const fullApplications = ["cosmic-edit", "cosmic-player", "cosmic-viewer", "cosmic-store"];

function requireDesktop() {
  const commands = Bun.env.BUN_OS_PROFILE === "full" ? [...desktopCommands, ...fullApplications] : desktopCommands;
  for (const command of commands) {
    if (!Bun.which(command)) throw new Error(`Missing COSMIC component: ${command}`);
  }
}

if (mode === "health") {
  const receipt = await verifyPayload(root);
  // During image construction BUN_OS_PROFILE is not set yet.
  if (Bun.env.BUN_OS_COMPOSITION === "desktop") requireDesktop();
  console.log(
    JSON.stringify({
      name: receipt.name,
      revision: receipt.runtime.revision,
      desktop: !!Bun.which("cosmic-session"),
    }),
  );
} else {
  let command: string[];
  if (mode === "cosmic") {
    requireDesktop();
    if (!Bun.env.WAYLAND_DISPLAY && !Bun.env.DISPLAY && Bun.env.COSMIC_BACKEND !== "kms") {
      throw new Error("COSMIC needs a mounted Wayland/X11 display, or an explicitly configured KMS seat");
    }
    // COSMIC's own session starts the compositor, panel, launcher and daemons.
    command = ["dbus-run-session", "--", "cosmic-session", "cosmic-comp", ...args];
  } else if (mode === "gamescope") {
    if (Bun.env.BUN_OS_COMPOSITION !== "gaming" || !Bun.which("gamescope"))
      throw new Error("Gamescope requires the gaming composition");
    if (!args.length)
      throw new Error(
        "gamescope requires an explicit session executable after --; no account or Steam session is provisioned automatically",
      );
    command = ["gamescope", "--", ...args];
  } else if (mode === "exec") {
    if (!args.length) throw new Error("exec requires an executable and its arguments");
    command = args;
  } else if (mode === "bun") {
    command = [process.execPath, ...args];
  } else {
    command = [process.execPath, mode, ...args];
  }
  const child = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const terminate = () => child.kill("SIGTERM");
  const interrupt = () => child.kill("SIGINT");
  process.on("SIGTERM", terminate);
  process.on("SIGINT", interrupt);
  const exitCode = await child.exited;
  process.off("SIGTERM", terminate);
  process.off("SIGINT", interrupt);
  process.exit(exitCode);
}
