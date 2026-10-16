/**
 * Native Bun sub-microsecond precision benchmarking and hardware metrics.
 */

export interface BenchMetrics {
  readonly schema: "yolo.bench/1";
  readonly timestamp: string;
  readonly iterations: number;
  readonly wyhash: {
    readonly elapsedMs: number;
    readonly opsPerSec: number;
    readonly sample: string;
  };
  readonly crc32: {
    readonly elapsedMs: number;
    readonly opsPerSec: number;
    readonly sample: string;
  };
  readonly stringWidth: {
    readonly sample: string;
    readonly width: number;
    readonly stripped: string;
  };
}

export function runBenchMetrics(iterations: number = 500_000): BenchMetrics {
  const testBuffer = Buffer.from(
    "Aphrody YOLO Bun Industrial Engine Benchmark Data String",
  );

  // 1. Wyhash
  const t0 = Bun.nanoseconds();
  let lastHash = 0n;
  for (let i = 0; i < iterations; i++) {
    lastHash = Bun.hash.wyhash(testBuffer, BigInt(i));
  }
  const elapsedWyhash = Number(
    ((Bun.nanoseconds() - t0) / 1_000_000).toFixed(2),
  );

  // 2. CRC32
  const t1 = Bun.nanoseconds();
  let lastCrc = 0;
  for (let i = 0; i < iterations; i++) {
    lastCrc = Bun.hash.crc32(testBuffer, i);
  }
  const elapsedCrc = Number(((Bun.nanoseconds() - t1) / 1_000_000).toFixed(2));

  // 3. String width
  const sampleAnsi = "\x1b[32mYOLO\x1b[0m 🚀 \x1b[34mAntigravity Core\x1b[0m";
  const width = Bun.stringWidth(sampleAnsi);
  const stripped = Bun.stripANSI(sampleAnsi);

  return {
    schema: "yolo.bench/1",
    timestamp: new Date().toISOString(),
    iterations,
    wyhash: {
      elapsedMs: elapsedWyhash,
      opsPerSec: Math.round((iterations / (elapsedWyhash || 1)) * 1000),
      sample: lastHash.toString(16).slice(0, 8),
    },
    crc32: {
      elapsedMs: elapsedCrc,
      opsPerSec: Math.round((iterations / (elapsedCrc || 1)) * 1000),
      sample: String(lastCrc),
    },
    stringWidth: {
      sample: sampleAnsi,
      width,
      stripped,
    },
  };
}

export function renderBenchMarkdown(metrics: BenchMetrics): string {
  return [
    `# yolo bench: Native Bun Micro-Benchmark Suite`,
    "",
    `- **Timestamp:** ${metrics.timestamp}`,
    `- **Iterations:** ${metrics.iterations.toLocaleString()}`,
    "",
    `| Metric | Elapsed | Operations / sec | Sample |`,
    `| :--- | :--- | :--- | :--- |`,
    `| **Bun.hash.wyhash** | ${metrics.wyhash.elapsedMs} ms | ${metrics.wyhash.opsPerSec.toLocaleString()} ops/s | \`${metrics.wyhash.sample}\` |`,
    `| **Bun.hash.crc32** | ${metrics.crc32.elapsedMs} ms | ${metrics.crc32.opsPerSec.toLocaleString()} ops/s | \`${metrics.crc32.sample}\` |`,
    `| **Bun.stringWidth** | Instant | - | Width: ${metrics.stringWidth.width} |`,
  ].join("\n");
}
