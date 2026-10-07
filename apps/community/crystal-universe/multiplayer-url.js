// SPDX-License-Identifier: Apache-2.0
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function buildMultiplayerSocketUrl(location, room, configuredBase = "") {
  if (typeof room !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(room))
    throw new TypeError("Le nom de salle est invalide.");
  const page = new URL(location.href);
  if (page.protocol !== "http:" && page.protocol !== "https:")
    throw new TypeError("Le protocole de la page ne permet pas les WebSockets.");
  const socketProtocol = page.protocol === "https:" ? "wss:" : "ws:";
  const explicitBase = typeof configuredBase === "string" ? configuredBase.trim() : "";
  let socket;
  if (explicitBase) {
    socket = new URL(explicitBase, `${socketProtocol}//${page.host}`);
    if (
      (socket.protocol !== "ws:" && socket.protocol !== "wss:") ||
      socket.username ||
      socket.password ||
      socket.search ||
      socket.hash
    )
      throw new TypeError("L’adresse WebSocket configurée est invalide.");
  } else if (localHosts.has(page.hostname)) {
    socket = new URL(`${socketProtocol}//${page.hostname}:4320`);
  } else {
    socket = new URL(`${socketProtocol}//${page.host}`);
  }
  const prefix = socket.pathname.replace(/\/+$/, "");
  socket.pathname = `${prefix}/ws/${encodeURIComponent(room)}`;
  return socket.toString();
}
