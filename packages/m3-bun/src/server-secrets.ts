// SPDX-License-Identifier: Apache-2.0
// Secrets of an app's server (session and CSRF signing keys, API tokens): the environment first (containers, CI),
// then the OS credential store through `Bun.secrets` (Keychain, libsecret, Windows Credential Manager).

export interface M3SecretOptions {
  /** Credential store service (default `m3-bun`). */
  service?: string;
  /** Environment variable checked first (default: the name in upper snake case, `session-key` -> `SESSION_KEY`). */
  env?: string | false;
}

const envName = (name: string): string => name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();

/** The secret `name`: its environment variable, else the credential store entry; undefined when neither has it. */
export async function m3Secret(name: string, options: M3SecretOptions = {}): Promise<string | undefined> {
  const variable = options.env === false ? undefined : (options.env ?? envName(name));
  const fromEnv = variable ? Bun.env[variable] : undefined;
  if (fromEnv) return fromEnv;
  return (await Bun.secrets.get({ service: options.service ?? "m3-bun", name })) ?? undefined;
}

/**
 * The secret `name`, created on first use: 32 random bytes (base64url) stored in the credential store, so the key
 * survives restarts without ever being written to a file.
 */
export async function ensureSecret(name: string, options: M3SecretOptions & { bytes?: number } = {}): Promise<string> {
  const existing = await m3Secret(name, options);
  if (existing) return existing;
  const value = Buffer.from(crypto.getRandomValues(new Uint8Array(options.bytes ?? 32))).toString("base64url");
  try {
    await Bun.secrets.set({
      service: options.service ?? "m3-bun",
      name,
      value,
    });
  } catch (error) {
    const variable = options.env === false ? "" : ` or set ${options.env ?? envName(name)}`;
    throw new Error(`m3-bun: cannot store the secret ${name} in the OS credential store${variable}`, {
      cause: error,
    });
  }
  return value;
}
