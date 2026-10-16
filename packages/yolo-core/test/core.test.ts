import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { probeNativeTooling } from "@aphrody/runtime-sdk/tooling";
import {
  sys,
  vfs,
  vendor,
  runtime,
  verify,
  fleet,
  scaffold,
  curation,
  coord,
  distribution,
  scanDirectory,
  parseTsSource,
  buildOpenApiSpec,
  createApiServer,
  TOOLS,
  GATES,
} from "../../core/src/index";

const rootDir = resolve(import.meta.dir, "../../../docs/aphrody");

describe("YOLO Core Library (@aphrody/yolo-core)", () => {
  describe("sys module (Hardware, Benchmarking, Diagnostics)", () => {
    it("should collect hardware and system stats", () => {
      const stats = sys.getSystemStats();
      expect(stats.os).toBe(process.platform);
      expect(stats.arch).toBe(process.arch);
      expect(stats.cpuCores).toBeGreaterThan(0);
      expect(stats.totalMemoryBytes).toBeGreaterThan(0);
      expect(stats.freeMemoryBytes).toBeGreaterThan(0);
    });

    it("should run microbenchmarks with sub-microsecond precision", () => {
      const bench = sys.runBenchMetrics(100);
      expect(bench.iterations).toBe(100);
      expect(bench.wyhash.opsPerSec).toBeGreaterThan(0);
      expect(bench.crc32.opsPerSec).toBeGreaterThan(0);

      const md = sys.renderBenchMarkdown(bench);
      expect(md).toContain("# yolo bench: Native Bun Micro-Benchmark Suite");
      expect(md).toContain("Bun.hash.wyhash");
    });

    it("should collect doctor diagnostics report", () => {
      const doc = sys.collectDoctorReport();
      expect(doc.schema).toBe("yolo.doctor/1");
      expect(doc.bunVersion).toBe(Bun.version);
      expect(doc.stack.bun.version).toBe(Bun.version);
      expect(Array.isArray(doc.components)).toBe(true);

      const md = sys.renderDoctorMarkdown(doc);
      expect(md).toContain("# yolo doctor:");
    });
  });

  describe("vfs module (Scanning, Parsing, Path Resolution)", () => {
    it("should resolve yolo home and checkout roots", () => {
      const home = vfs.yoloHome();
      expect(typeof home).toBe("string");
      expect(home.length).toBeGreaterThan(0);

      const checkout = vfs.findCheckout(rootDir);
      expect(checkout).toBe(rootDir);
    });

    it("should format bytes into human-readable strings", () => {
      expect(vfs.formatBytes(0)).toBe("0 B");
      expect(vfs.formatBytes(1024)).toBe("1.0 KB");
      expect(vfs.formatBytes(1048576)).toBe("1.00 MB");
      expect(vfs.formatBytes(1073741824)).toBe("1.00 GB");
    });

    // Parsing goes through the optional native tooling provider (libyolo_tooling).
    it.skipIf(!probeNativeTooling().available)(
      "should parse TypeScript source and extract AST/wyhash metrics",
      async () => {
        const filePath = resolve(rootDir, "packages/engine/core/src/index.ts");
        const parsed = await parseTsSource(filePath);
        expect(parsed.path).toBe(filePath);
        expect(parsed.checksum).toBeDefined();
        expect(parsed.checksum.length).toBeGreaterThan(0);
        expect(parsed.exports.length).toBeGreaterThan(0);
        expect(parsed.lines).toBeGreaterThan(50);
        expect(parsed.bytes).toBeGreaterThan(500);
      },
    );

    it("should perform parallel recursive directory scan", async () => {
      const report = await scanDirectory(
        resolve(rootDir, "packages/engine/core/src/sys"),
        {
          exts: ["ts"],
        },
      );
      expect(report.schema).toBe("yolo.scan/1");
      expect(report.totalFiles).toBeGreaterThan(0);
      expect(report.totalLines).toBeGreaterThan(0);
      expect(report.treeFingerprint.length).toBeGreaterThan(0);
    });

    it("should audit environment portability and verify zero hardcoded paths", async () => {
      const report = await vfs.auditPortability(
        resolve(rootDir, "packages/engine/core"),
      );
      expect(report.schema).toBe("yolo.portability/1");
      expect(report.auditedFiles).toBeGreaterThan(10);
      expect(report.ok).toBe(true);
      expect(report.totalIssues).toBe(0);

      const md = vfs.renderPortabilityMarkdown(report);
      expect(md).toContain("# yolo audit --portability: PASS");
    });
  });

  describe("vendor module (Workspace Cargo, TOML, Catalog)", () => {
    it("should serialize TOML data structures correctly", () => {
      const data = {
        name: "test-package",
        version: "1.0.0",
        features: ["std", "alloc"],
      };
      const toml = vendor.serializeToml(data);
      expect(toml).toContain('name = "test-package"');
      expect(toml).toContain('version = "1.0.0"');
      expect(toml).toContain('features = ["std", "alloc"]');
    });

    it("should read workspace Cargo.toml with native Bun.TOML parser", async () => {
      const cargoSummary = await vendor.readWorkspaceCargo(rootDir);
      expect(cargoSummary).not.toBeNull();
      expect(cargoSummary?.members.length).toBeGreaterThan(0);
      expect(cargoSummary?.resolver).toBeDefined();
    });

    it("should inspect package manifests and submodules", async () => {
      const statuses = await vendor.inspectPackages(rootDir);
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);
    });

    it("should read vendor status from vendor.toml and vendor.lock", async () => {
      const vendorStatus = await vendor.readVendorStatus(rootDir);
      expect(vendorStatus).not.toBeNull();
      expect(Array.isArray(vendorStatus?.sources)).toBe(true);
      expect(vendorStatus?.sources.length).toBeGreaterThan(0);
    });
  });

  describe("runtime module (Native Bridge & Supervision)", () => {
    it("should inspect runtime status without panicking", () => {
      const status = runtime.getRuntimeStatus();
      expect(typeof status.installed).toBe("boolean");
      expect(typeof status.target).toBe("string");
    });
  });

  describe("verify module (Quality Gate Graph Scheduler)", () => {
    it("should declare canonical repository quality gates", () => {
      expect(GATES.length).toBe(11);
      const gateIds = GATES.map((g) => g.id);
      expect(gateIds).toContain("whitespace");
      expect(gateIds).toContain("typecheck");
      expect(gateIds).toContain("lint");
      expect(gateIds).toContain("fmt-check");
      expect(gateIds).toContain("test");
      expect(gateIds).toContain("rust-fmt");
      expect(gateIds).toContain("docs");
      expect(gateIds).toContain("import-check");
      expect(gateIds).toContain("python-lint");
      expect(gateIds).toContain("python-native");
      expect(gateIds).toContain("python-test");
    });

    it("should validate that gate graph has no cyclic dependencies", () => {
      expect(() => verify.validateGraph(GATES)).not.toThrow();
    });

    it("should list heavy gates that are run separately via yolo ship", () => {
      expect(verify.NOT_RUN_HEAVY.length).toBeGreaterThan(0);
      const heavyIds = verify.NOT_RUN_HEAVY.map((g) => g.id);
      expect(heavyIds).toContain("clippy");
      expect(heavyIds).toContain("test-crates");
      expect(heavyIds).toContain("check-workspace");
    });
  });

  describe("server module (HTTP / REST / OpenAPI 3.1)", () => {
    it("should build valid OpenAPI 3.1.0 specification", () => {
      const spec = buildOpenApiSpec("1.0.0", Bun.version);
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.info.title).toContain("YOLO");
      expect(spec.paths["/health"]).toBeDefined();
      expect(spec.paths["/api/tools"]).toBeDefined();
      expect(spec.paths["/api/status"]).toBeDefined();
    });

    it("should start and stop native Bun HTTP server cleanly", async () => {
      const testServer = createApiServer({
        port: 0,
        hostname: "127.0.0.1",
        rootDir,
      });
      expect(testServer.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${testServer.port}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");

      testServer.stop(true);
    });
  });

  describe("mcp module (Model Context Protocol 2024-11-05)", () => {
    it("should register core agent tools", () => {
      expect(TOOLS.length).toBeGreaterThanOrEqual(3);
      const toolNames = TOOLS.map((t) => t.name);
      expect(toolNames).toContain("yolo_status");
      expect(toolNames).toContain("yolo_scan");
      expect(toolNames).toContain("yolo_bench");
    });
  });

  describe("fleet module (Space Deduplication & Remote Fleet)", () => {
    it("should calculate hardlink space reclaim estimates", () => {
      const records = [
        { dev: "1", ino: "100", nlink: 2, blocks: 10 },
        { dev: "1", ino: "100", nlink: 2, blocks: 10 },
        { dev: "1", ino: "101", nlink: 1, blocks: 6 },
      ];
      const estimate = fleet.estimateReclaim(records);
      expect(estimate.inodes).toBe(2);
      expect(estimate.freedBytes).toBeGreaterThan(0);
    });

    it("should evaluate disk thresholds and safety decisions", () => {
      const dfStdout = "  1000000000   400000000\n";
      const decisionOk = fleet.diskDecision(dfStdout, 0.2);
      expect(decisionOk.ok).toBe(true);

      const decisionLow = fleet.diskDecision(dfStdout, 0.5);
      expect(decisionLow.ok).toBe(false);
    });
  });

  describe("scaffold module (Stack Scaffolder & Templates)", () => {
    it("should sanitize identifiers properly", () => {
      expect(scaffold.toIdent("my-awesome-app")).toBe("my_awesome_app");
      expect(scaffold.toIdent("@scope/app-123")).toBe("scope_app_123");
      expect(scaffold.toIdent("123test")).toBe("app_123test");
    });

    it("should load stack manifest from templates/stack.toml", async () => {
      const manifest = await scaffold.loadStack(rootDir);
      expect(manifest.meta).toBeDefined();
      expect(manifest.meta["name"]).toBeDefined();
      expect(manifest.template).toBeDefined();
      expect(manifest.template["base"]).toBeDefined();
    });
  });

  describe("curation module (Awesome Bun Curation & Renaming)", () => {
    it("should parse markdown sections and entries", () => {
      const sampleMarkdown = `
# Awesome Bun

## Web Frameworks
- [Hono](https://github.com/honojs/hono) - Fast, lightweight web framework
- [Elysia](https://github.com/elysiajs/elysia) - Ergonomic web framework for Bun
`;
      const sections = curation.parseAwesome(sampleMarkdown);
      expect(sections.length).toBeGreaterThan(0);
      const fwSection = sections.find((s) =>
        s.title.includes("Web Frameworks"),
      );
      expect(fwSection).toBeDefined();
      expect(fwSection?.entries.length).toBe(2);
      expect(fwSection?.entries[0]?.name).toBe("Hono");
    });
  });

  describe("coord module (Control Plane Bridge)", () => {
    it("should resolve aphrody root directory and check PATH tools", () => {
      const root = coord.aphrodyRoot();
      expect(typeof root).toBe("string");
      expect(root.length).toBeGreaterThan(0);

      const tools = coord.aphrodyTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.map((t) => t.name)).toEqual(["aphrody-infra"]);
    });
  });

  describe("distribution module (Artifact Target Resolution)", () => {
    it("should detect current host target architecture", () => {
      const target = distribution.hostTarget();
      expect(Object.values(distribution.SUPPORTED_TARGETS)).toContain(target);

      const mockManifest: distribution.ArtifactManifest = {
        schema: 1,
        name: "yolo_runtime",
        version: "1.0.0",
        target,
        abi: "1.4.0",
        compatibility: { abiMajor: 1 },
        toolchain: "rustc",
        files: { "libyolo_runtime.so": { bytes: 100, sha256: "00" } },
        capabilities: [],
      };
      const libFile = distribution.libraryFileName(mockManifest);
      expect(libFile).toBe("libyolo_runtime.so");
    });
  });
});
