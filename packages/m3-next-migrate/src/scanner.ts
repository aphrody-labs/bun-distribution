// SPDX-License-Identifier: Apache-2.0
// Filesystem traversal and writes are serialized to bound I/O and preserve preflight/order guarantees.
// oxlint-disable no-await-in-loop
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export function isSourceProjectConfig(name: string): boolean {
  return /^(?:package\.json|(?:bun|package|yarn|pnpm).*lock.*|tsconfig(?:\..+)?\.json|next-env\.d\.ts|(?:next|postcss|tailwind|vite)\.config\..+)$/.test(
    name,
  );
}

export interface ScanStats {
  totalFiles: number;
  clientComponents: number;
  serverComponents: number;
  serverActions: number;
  navigationUsages: number;
  linkUsages: number;
  imageUsages: number;
  fontUsages: number;
  dynamicUsages: number;
  headersUsages: number;
  formUsages: number;
  apiRoutes: number;
  metadataCount: number;
  generateMetadataCount: number;
  m3CandidateCount: number;
  m3DetectedComponents: string[];
  layouts: string[];
  pages: string[];
  envVars: string[];
  files: Array<{
    path: string;
    isClient: boolean;
    hasServerAction: boolean;
    features: string[];
  }>;
}

export async function scanNextDirectory(targetPath: string): Promise<ScanStats> {
  const stats: ScanStats = {
    totalFiles: 0,
    clientComponents: 0,
    serverComponents: 0,
    serverActions: 0,
    navigationUsages: 0,
    linkUsages: 0,
    imageUsages: 0,
    fontUsages: 0,
    dynamicUsages: 0,
    headersUsages: 0,
    formUsages: 0,
    apiRoutes: 0,
    metadataCount: 0,
    generateMetadataCount: 0,
    m3CandidateCount: 0,
    m3DetectedComponents: [],
    layouts: [],
    pages: [],
    envVars: [],
    files: [],
  };

  const envSet = new Set<string>();
  const m3ComponentSet = new Set<string>();

  async function walk(currentPath: string) {
    const s = await stat(currentPath);
    if (!s.isDirectory()) {
      if (
        /\.(tsx|jsx|ts|js)$/.test(currentPath) &&
        !currentPath.includes("node_modules") &&
        !currentPath.includes(".next")
      ) {
        await analyzeFile(currentPath);
      }
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        isSourceProjectConfig(entry.name)
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (/\.(tsx|jsx|ts|js)$/.test(entry.name)) {
        await analyzeFile(fullPath);
      }
    }
  }

  async function analyzeFile(filePath: string) {
    stats.totalFiles++;
    const content = await Bun.file(filePath).text();
    const features: string[] = [];
    const rel = relative(targetPath, filePath).replace(/\\/g, "/");

    const isClient = /['"]use client['"]/.test(content);
    const hasServerAction = /['"]use server['"]/.test(content);

    if (isClient) {
      stats.clientComponents++;
      features.push("use client");
    } else {
      stats.serverComponents++;
    }

    if (hasServerAction) {
      stats.serverActions++;
      features.push("use server");
    }

    // App Router Layouts & Pages
    if (/(^|\/)layout\.(tsx|jsx|js|ts)$/.test(rel)) {
      stats.layouts.push(rel);
      features.push("layout");
    }

    if (/(^|\/)page\.(tsx|jsx|js|ts)$/.test(rel)) {
      stats.pages.push(rel);
      features.push("page");
    }

    if (filePath.includes("route.ts") || filePath.includes("route.js")) {
      stats.apiRoutes++;
      features.push("API Route");
    }

    if (/from\s+['"]next\/navigation['"]/.test(content)) {
      stats.navigationUsages++;
      features.push("next/navigation");
    }

    if (/from\s+['"]next\/link['"]/.test(content)) {
      stats.linkUsages++;
      features.push("next/link");
    }

    if (/from\s+['"]next\/image['"]/.test(content)) {
      stats.imageUsages++;
      features.push("next/image");
    }

    if (/from\s+['"]next\/font\/(google|local)['"]/.test(content)) {
      stats.fontUsages++;
      features.push("next/font");
    }

    if (/from\s+['"]next\/dynamic['"]/.test(content)) {
      stats.dynamicUsages++;
      features.push("next/dynamic");
    }

    if (/from\s+['"]next\/headers['"]/.test(content)) {
      stats.headersUsages++;
      features.push("next/headers");
    }

    if (/from\s+['"]next\/form['"]/.test(content)) {
      stats.formUsages++;
      features.push("next/form");
    }

    // Metadata detections
    if (/export\s+const\s+metadata(?::\s*Metadata)?\s*=\s*/.test(content)) {
      stats.metadataCount++;
      features.push("metadata");
    }

    if (/export\s+(?:async\s+)?function\s+generateMetadata\b/.test(content)) {
      stats.generateMetadataCount++;
      features.push("generateMetadata");
    }

    // M3 candidate UI components: Button, Input, Card, Badge, Tooltip, Collapsible
    const m3Matches = content.match(/components\/ui\/(button|input|card|badge|tooltip|collapsible)/g);
    if (m3Matches) {
      stats.m3CandidateCount++;
      m3Matches.forEach(m => {
        const comp = m.split("/").pop();
        if (comp) m3ComponentSet.add(comp);
      });
      features.push("m3-candidate");
    }

    const envMatches = content.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g);
    for (const match of envMatches) {
      envSet.add(match[1]);
    }

    stats.files.push({
      path: filePath,
      isClient,
      hasServerAction,
      features,
    });
  }

  await walk(targetPath);
  stats.envVars = Array.from(envSet);
  stats.m3DetectedComponents = Array.from(m3ComponentSet);
  return stats;
}
