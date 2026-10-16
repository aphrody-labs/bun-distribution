// SPDX-License-Identifier: Apache-2.0
/**
 * WireGuard material of the kit. The private key is born on this PC (never in the repository, never sent), the team
 * only ever sees the public key. Anything that comes from outside (the access block, a ready-made .conf) is parsed
 * against a whitelist: WireGuard for Windows runs PostUp/PreUp scripts as SYSTEM, and a default route (/0) would
 * send all of Omar's traffic into the tunnel, so both are refused.
 */
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";

const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

export function isWgKey(value: string): boolean {
  return KEY_RE.test(value) && Buffer.from(value, "base64").length === 32;
}

/** X25519 private key as WireGuard writes it (clamped, base64). */
export function generatePrivateKey(
  entropy: Uint8Array = randomBytes(32),
): string {
  const raw = Buffer.from(entropy);
  if (raw.length !== 32) throw new Error("32 octets attendus");
  raw[0] = (raw[0] ?? 0) & 248;
  raw[31] = ((raw[31] ?? 0) & 127) | 64;
  return raw.toString("base64");
}

const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");

export function publicKeyOf(privateKey: string): string {
  if (!isWgKey(privateKey)) throw new Error("clé privée WireGuard invalide");
  const der = Buffer.concat([PKCS8_X25519, Buffer.from(privateKey, "base64")]);
  const jwk = createPublicKey(
    createPrivateKey({ key: der, format: "der", type: "pkcs8" }),
  ).export({
    format: "jwk",
  });
  if (!jwk.x) throw new Error("clé publique introuvable");
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateKeyPair(entropy?: Uint8Array): KeyPair {
  const privateKey = generatePrivateKey(entropy);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

export const TUNNEL_NAME_RE = /^[A-Za-z0-9_=+.-]{1,32}$/;

const CIDR_RE = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9A-Fa-f:]+)\/(\d{1,3})$/;
const ENDPOINT_RE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):\d{1,5}$/;

const INTERFACE_KEYS = new Set(["address", "mtu"]);
const PEER_KEYS = new Set([
  "publickey",
  "presharedkey",
  "endpoint",
  "allowedips",
  "persistentkeepalive",
]);

export interface WgSection {
  name: "Interface" | "Peer";
  entries: [key: string, value: string][];
}

export function parseWgText(text: string): WgSection[] {
  const sections: WgSection[] = [];
  let current: WgSection | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      const name =
        header[1] === "Interface"
          ? "Interface"
          : header[1] === "Peer"
            ? "Peer"
            : undefined;
      if (!name) throw new Error(`section WireGuard inconnue : [${header[1]}]`);
      current = { name, entries: [] };
      sections.push(current);
      continue;
    }
    const pair = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line);
    if (!pair)
      throw new Error(`ligne WireGuard illisible : ${line.slice(0, 40)}`);
    if (!current) {
      current = { name: "Interface", entries: [] };
      sections.push(current);
    }
    current.entries.push([pair[1]!, pair[2]!.trim()]);
  }
  return sections;
}

function checkCidrList(
  key: string,
  value: string,
  allowDefaultRoute: boolean,
): void {
  for (const part of value.split(",").map((item) => item.trim())) {
    const match = CIDR_RE.exec(part);
    if (!match) throw new Error(`${key} : adresse invalide « ${part} »`);
    if (!allowDefaultRoute && match[2] === "0")
      throw new Error(
        `${key} : « ${part} » enverrait tout ton trafic dans le tunnel (route par défaut), refusé : seul le réseau privé de l'équipe doit passer par là`,
      );
  }
}

/** Validate sections; `withPrivateKey` is true for a complete .conf. Returns the sections unchanged. */
export function validateWgSections(
  sections: WgSection[],
  withPrivateKey: boolean,
): WgSection[] {
  const interfaces = sections.filter((section) => section.name === "Interface");
  const peers = sections.filter((section) => section.name === "Peer");
  if (interfaces.length !== 1)
    throw new Error("le bloc doit contenir exactement une partie [Interface]");
  if (peers.length < 1)
    throw new Error(
      "le bloc ne contient aucun [Peer] (le serveur de l'équipe)",
    );
  for (const section of sections) {
    for (const [rawKey, value] of section.entries) {
      const key = rawKey.toLowerCase();
      if (section.name === "Interface" && key === "privatekey") {
        if (!withPrivateKey)
          throw new Error(
            "le bloc de l'équipe ne doit contenir aucune clé privée (PrivateKey)",
          );
        if (!isWgKey(value)) throw new Error("PrivateKey invalide");
        continue;
      }
      const allowed = section.name === "Interface" ? INTERFACE_KEYS : PEER_KEYS;
      if (!allowed.has(key))
        throw new Error(
          `réglage WireGuard refusé : ${rawKey} (scripts et réglages système interdits)`,
        );
      if (key === "address") checkCidrList("Address", value, true);
      else if (key === "allowedips") checkCidrList("AllowedIPs", value, false);
      else if (key === "publickey" || key === "presharedkey") {
        if (!isWgKey(value)) throw new Error(`${rawKey} invalide`);
      } else if (key === "endpoint") {
        if (!ENDPOINT_RE.test(value))
          throw new Error("Endpoint invalide (hôte:port attendu)");
      } else if (key === "persistentkeepalive" || key === "mtu") {
        if (!/^\d{1,5}$/.test(value)) throw new Error(`${rawKey} invalide`);
      }
    }
    if (
      section.name === "Interface" &&
      !section.entries.some(([key]) => key.toLowerCase() === "address")
    )
      throw new Error("[Interface] sans Address");
    if (section.name === "Peer") {
      for (const required of ["publickey", "endpoint", "allowedips"]) {
        if (!section.entries.some(([key]) => key.toLowerCase() === required))
          throw new Error(
            `[Peer] sans ${required === "publickey" ? "PublicKey" : required === "endpoint" ? "Endpoint" : "AllowedIPs"}`,
          );
      }
    }
  }
  if (
    withPrivateKey &&
    !interfaces[0]!.entries.some(([key]) => key.toLowerCase() === "privatekey")
  )
    throw new Error("[Interface] sans PrivateKey");
  return sections;
}

const render = (sections: WgSection[]): string =>
  `${sections
    .map(
      (section) =>
        `[${section.name}]\n${section.entries.map(([key, value]) => `${key} = ${value}`).join("\n")}`,
    )
    .join("\n\n")}\n`;

/** The team's block (what the generator prints for the app's empty tunnel) plus the local private key: a full wg-quick file. */
export function assembleConf(privateKey: string, block: string): string {
  if (!isWgKey(privateKey)) throw new Error("clé privée WireGuard invalide");
  const sections = validateWgSections(parseWgText(block), false);
  const interfaceSection = sections.find(
    (section) => section.name === "Interface",
  )!;
  interfaceSection.entries.unshift(["PrivateKey", privateKey]);
  // Interface first, then peers, whatever the order in the block.
  return render([
    interfaceSection,
    ...sections.filter((section) => section.name === "Peer"),
  ]);
}

/** Validate a complete .conf received from the team and return it normalised. */
export function normaliseConf(conf: string): string {
  return render(validateWgSections(parseWgText(conf), true));
}

/** The hub the tunnel talks to: first Peer's endpoint host (used only to say what is unreachable, never stored). */
export function peerEndpoint(
  conf: string,
): { host: string; port: number } | undefined {
  const peer = parseWgText(conf).find((section) => section.name === "Peer");
  const value = peer?.entries.find(
    ([key]) => key.toLowerCase() === "endpoint",
  )?.[1];
  const match = value ? /^(.*):(\d+)$/.exec(value) : null;
  return match
    ? { host: match[1]!.replace(/^\[|\]$/g, ""), port: Number(match[2]) }
    : undefined;
}
