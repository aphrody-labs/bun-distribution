// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from "node:path";
import { authorizedGame, authorizedPaths, readAuthorizedPublication } from "../../packages/bun-engine/web-emulation/authorized-publication";

/** Stage only publication metadata; large ROM objects belong to shared R2. */
export async function stageGamesContent(dist: string) {
  const root = resolve(import.meta.dir, "../..");
  const content: unknown[] = [];
  if (await Bun.file(authorizedPaths(root).publication).exists()) {
    const publication = await readAuthorizedPublication(root);
    content.push({ id: authorizedGame.id, title: authorizedGame.title, system: authorizedGame.system, rights: authorizedGame.rights, package: "game-dust-nds", sha256: publication.reference.sha256, bytes: publication.reference.bytes, objectKey: publication.reference.objectKey, url: `/games/content/${authorizedGame.id}` });
  }
  const manifest = { schemaVersion: 1, content };
  await Bun.write(join(dist, "games/content.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
