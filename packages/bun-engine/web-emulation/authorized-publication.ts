// SPDX-License-Identifier: Apache-2.0
import { join, relative, resolve } from "node:path";
import catalog from "./authorized-content.json";
import { qualificationSHA256, verifyQualification } from "./qualification";

export const authorizedGame = catalog.content.find(entry => entry.id === "inazuma-eleven-2-tempete-de-glace-fr")!;
export function authorizedPaths(root: string) {
  const directory = join(root, "build/web-emulation/authorized-content");
  return { directory, preparation: join(directory, `${authorizedGame.id}.receipt.json`), publication: join(directory, `${authorizedGame.id}.publication.json`), artifact: join(directory, authorizedGame.output!) };
}

export async function verifyAuthorizedInputs(root: string, privateReport: string) {
  if (!authorizedGame.member || !authorizedGame.archive || !authorizedGame.output) throw new Error("Authorized input pins are incomplete.");
  const paths = authorizedPaths(root);
  const preparation = await Bun.file(paths.preparation).json();
  if (preparation.schemaVersion !== 1 || preparation.kind !== "bun-engine-owner-authorized-content-preparation" || preparation.content?.id !== authorizedGame.id || preparation.content?.rights?.declaration !== authorizedGame.rights.declaration || preparation.artifact?.sha256 !== authorizedGame.member.sha256 || preparation.artifact?.bytes !== authorizedGame.member.bytes || preparation.artifact?.path !== authorizedGame.output || preparation.archive?.sha256 !== authorizedGame.archive.sha256) throw new Error("Prepared proprietary content receipt differs from the authorized catalog.");
  if (Bun.file(paths.artifact).size !== authorizedGame.member.bytes || await qualificationSHA256(paths.artifact) !== authorizedGame.member.sha256) throw new Error("Prepared authorized ROM changed.");
  const dist = join(root, "dist/web-emulation");
  const qualification = await verifyQualification(dist, "dust-nds", { root });
  const reportPath = resolve(root, privateReport);
  const reportRelative = relative(resolve(root, "build/web-emulation/private"), reportPath).replaceAll("\\", "/");
  if (!/^[a-f0-9-]+\/smoke\.json$/.test(reportRelative)) throw new Error("Select an existing private GPU report from build/web-emulation/private/<run>/smoke.json.");
  const report = await Bun.file(reportPath).json();
  const result = report[`dust-nds${qualification.variant === "threads" ? ":threads" : ""}`];
  if (!result || result.ok !== true || result.renderer !== "wgpu30-dust" || result.privateROM?.sha256 !== authorizedGame.member.sha256 || !Number.isSafeInteger(result.frames) || result.frames < 120 || result.lit !== true || !Number.isSafeInteger(result.gpu2d_submitted_frames) || result.gpu2d_submitted_frames < 1 || !Number.isSafeInteger(result.gpu3d_submitted_frames) || result.gpu3d_submitted_frames < 1 || !Array.isArray(result.errors) || result.errors.length || !Array.isArray(result.browserLog) || result.browserLog.length || result.presentation?.lit !== true || result.presentation?.evidence !== "cdp-canvas-screenshot-rgba" || !/^[a-f0-9]{64}$/.test(result.presentation?.hash ?? "") || !Number.isFinite(Date.parse(result.testedAt))) throw new Error("Authorized game requires a passing real-GPU private run with actual 2D/3D submissions and visible presentation.");
  const manifest = await Bun.file(join(dist, "dust-nds/manifest.json")).json();
  const selected = qualification.variant === "threads" ? manifest.variants?.threads : manifest;
  for (const path of ["dust-nds/manifest.json", `dust-nds/${selected.module}`, `dust-nds/${selected.wasm}`]) {
    if (result.artifacts?.[path] !== qualification.files[path] || result.artifacts?.[path] !== await qualificationSHA256(join(dist, path))) throw new Error("Authorized game GPU report does not match the currently qualified Dust artifacts.");
  }
  return { paths, qualification, reportPath, reportRelative: relative(root, reportPath).replaceAll("\\", "/"), preparationSHA256: await qualificationSHA256(paths.preparation), qualificationSHA256: await qualificationSHA256(join(dist, "dust-nds/qualification.json")), privateReportSHA256: await qualificationSHA256(reportPath) };
}

export async function readAuthorizedPublication(root: string) {
  const publication = await Bun.file(authorizedPaths(root).publication).json();
  if (publication.schemaVersion !== 1 || publication.kind !== "bun-engine-authorized-content-publication" || publication.id !== authorizedGame.id || typeof publication.privateReport !== "string") throw new Error("Invalid authorized publication receipt.");
  const verified = await verifyAuthorizedInputs(root, publication.privateReport);
  const expected = authorizedGame.member!;
  const reference = publication.reference;
  if (publication.preparationSHA256 !== verified.preparationSHA256 || publication.qualificationSHA256 !== verified.qualificationSHA256 || publication.privateReportSHA256 !== verified.privateReportSHA256 || publication.bucket !== "aphrody-assets" || reference?.sha256 !== expected.sha256 || reference?.bytes !== expected.bytes || reference?.checksumVerified !== true || reference?.objectKey !== `objects/sha256/${expected.sha256}` || reference?.url !== `https://assets.aphrody.app/objects/sha256/${expected.sha256}` || !Number.isFinite(Date.parse(publication.publishedAt))) throw new Error("Authorized publication receipt is stale or does not refer to the verified canonical asset object.");
  return publication;
}
