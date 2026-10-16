/**
 * YOLO Core Library (@aphrody/yolo-core)
 *
 * Modeled directly after Bun's core library architecture:
 * - sys: Hardware, system statistics, benchmarking, doctors, zero-copy hashing (wyhash, crc32, sha256)
 * - vfs: High-performance recursive scanner, source parser, home & checkout resolution
 * - vendor: Monorepo package inspector, Cargo workspace manager, Bun catalog generator, crate importer
 * - runtime: Native C ABI 1.4 bridge, process supervisor, readiness probes
 * - verify: Parallel quality gate graph scheduler and timing engine
 * - server: Native Bun.serve HTTP / REST / OpenAPI 3.1 micro-server
 * - tools: shared tool registry and host (served through the single aphrody-mcp)
 * - fleet: Remote host management, hardlink space deduplication, command safety engine
 * - scaffold: Stack project scaffolder, template substitution, feature injection
 * - curation: Awesome repository curation, mass identifier renaming
 * - coord: Sibling workspace coordination, advisory claim locks
 * - distribution: Artifact verification, release packaging
 *
 * 100% Native Bun. Zero external runtime npm dependencies.
 */

// Submodule namespaces
export * as sys from "./sys";
export * as vfs from "./vfs";
export * as vendor from "./vendor";
export * as runtime from "./runtime";
export * as verify from "./verify";
export * as server from "./server";
export * as mcp from "./tools/registry";
export {
  callTool,
  listTools,
  runToolHost,
  type HostResult,
} from "./tools/host";
export * as fleet from "./fleet";
export * as scaffold from "./scaffold";
export * as curation from "./curation";
export * as coord from "./coord";
export * as distribution from "./distribution";
export * as ledger from "./ledger";
export * as redis from "./redis";
export * as monitor from "./monitor";
export * as gemma4 from "./gemma4";
export * as host from "./host";
export * as units from "./units";
export * as pm from "./pm";
export * as python from "./python";
export {
  planPackageSync,
  syncPackages,
  type PackageSyncPlan,
  type PackageSyncResult,
  type PackageSyncOptions,
  type PackageManager,
} from "./pm";

// Direct flat exports of core capabilities
export {
  limiter,
  getSystemStats,
  type SystemStats,
  runBenchMetrics,
  renderBenchMarkdown,
  type BenchMetrics,
  collectDoctorReport,
  renderDoctorMarkdown,
  type DoctorReport,
  type DoctorComponent,
} from "./sys";

export {
  isCompiled,
  findRepoRoot,
  yoloHome,
  yoloVersion,
  findCheckout,
  parseTsSource,
  renderParseMarkdown,
  type TsParseResult,
  scanDirectory,
  formatBytes,
  renderScanMarkdown,
  renderScanTerminal,
  type ScanReport,
  type ScanOptions,
  type ExtensionStat,
  type FileEntry,
  auditPortability,
  renderPortabilityMarkdown,
  type PortabilityReport,
  type PortabilityIssue,
} from "./vfs";

export {
  inspectPackages,
  readVendorStatus,
  collectStatusReport,
  renderStatusMarkdown,
  resolveGitDir,
  type SubmoduleStatus,
  type VendorSourceStatus,
  type StatusReport,
  readWorkspaceCargo,
  type WorkspaceCargoSummary,
  generateBunCatalog,
  type BunApiDomain,
  type AutonomousGenerationReport,
  serializeToml,
  transformManifest,
} from "./vendor";

export {
  Runtime,
  sharedRuntime,
  closeSharedRuntime,
  system,
  processes,
  getRuntimeStatus,
  type RuntimeStatus,
} from "./runtime";

export {
  GATES,
  NOT_RUN_HEAVY,
  runGates,
  selectChanged,
  changedFiles,
  summarize,
  renderMarkdown,
  renderList,
  validateGraph,
  type Gate,
  type GateResult,
  type Report as VerifyReport,
  type Status as GateStatus,
  type NotRun,
} from "./verify";

export {
  createApiServer,
  buildOpenApiSpec,
  type ApiServerOptions,
} from "./server";

export {
  TOOLS,
  executeTool,
  ToolExecutionContext,
  ToolArgumentError,
  validateToolArguments,
  type ToolExecutionContextOptions,
  type ToolCallOptions,
  type ToolDefinition,
} from "./tools/registry";

export {
  parseFindLinks,
  estimateReclaim,
  spaceGate,
  parseDfSizeAvail,
  resolveMinFree,
  diskProbeCommand,
  diskDecision,
  scanLinks,
  type LinkRecord,
  type ReclaimEstimate,
  type SpaceGate,
  type DiskDecision,
} from "./fleet";

export {
  initLedgerDatabase,
  recordSession,
  recordAuditReport,
  recordBenchmark,
  recordQualityGate,
  recordRemediation,
  indexCodebaseFingerprints,
  summarizeLedger,
  recordAgentTelemetry,
  recordTrainingSample,
  type SessionRecord,
  type AuditReportRecord,
  type BenchmarkRecord,
  type QualityGateRecord,
  type RemediationRecord,
  type CodebaseFingerprintRecord,
  type AgentTelemetryRecord,
  type TrainingSampleRecord,
} from "./ledger";

export {
  NativeRedisClient,
  indexCodebaseToRedis,
  RedisVectorStore,
  RedisTrainDb,
  type RedisOptions,
  type IndexResult,
  type VectorDocument,
  type VectorSearchResult,
  type TrainInstruction,
  type TrainTriple,
} from "./redis";

export {
  GEMMA4_E2B_CONFIG,
  GEMMA4_E4B_CONFIG,
  GEMMA4_26B_A4B_MOE_CONFIG,
  GEMMA4_31B_CONFIG,
  GEMMA4_MODELS,
  GEMMA4_SPECIAL_TOKENS,
  getGemma4Config,
  estimateGemma4Memory,
  formatGemma4ChatPrompt,
  parseGemma4Response,
  cosineSimilarity,
  euclideanDistance,
  normalizeL2,
  generateDeterministicEmbedding,
  computeKVCacheFootprintBytes,
  UnifiedInferenceEngine,
  type Gemma4Config,
  type Gemma4Message,
  type InferenceBackend,
  type UnifiedInferenceRequest,
  type UnifiedInferenceResponse,
} from "./gemma4";

export {
  AgentWatcher,
  AutoSyncEngine,
  type AgentWatcherOptions,
  type InterceptedEvent,
  type EndpointStatus,
  type GitRepoState,
  type SyncCycleResult,
  type AutoSyncOptions,
} from "./monitor";
