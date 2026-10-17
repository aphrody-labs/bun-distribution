import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { FilledButton, LinearProgress, OutlinedTextField, TextButton, type TextFieldElement } from "./m3.ts";

interface RuntimeInfo {
  name: string;
  version: string;
  abi: string;
  target: string;
  rustc: string;
  git_rev: string;
  panic_recovery: boolean;
}

interface Stats {
  os: string;
  arch: string;
  timestamp_ms: number;
}

interface StatsResponse {
  runtime: RuntimeInfo;
  stats: Stats;
  hits: number;
}

interface BenchResult {
  message: string;
  latency_us: number;
}

type Outcome = { ok: true; result: BenchResult } | { ok: false; message: string };

// The server clamps the iteration count to the same bound (src/app.ts).
const MAX_ITERATIONS = 2_000_000_000;
const integer = new Intl.NumberFormat();

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function RuntimePanel() {
  const [data, setData] = useState<StatsResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const abort = new AbortController();
    getJson<StatsResponse>("/api/stats", abort.signal).then(setData, (reason: unknown) => {
      if (!abort.signal.aborted) setError(String(reason));
    });
    return () => abort.abort();
  }, []);

  let body: ReactNode = <p>Loading runtime…</p>;
  if (error !== undefined) body = <p className="error">{error}</p>;
  else if (data !== undefined) {
    body = (
      <dl>
        <dt>Runtime</dt>
        <dd>
          {data.runtime.name} {data.runtime.version}
        </dd>
        <dt>ABI</dt>
        <dd>{data.runtime.abi}</dd>
        <dt>Target</dt>
        <dd>{data.runtime.target}</dd>
        <dt>Panic recovery</dt>
        <dd>{data.runtime.panic_recovery ? "yes" : "no"}</dd>
        <dt>Requests counted</dt>
        <dd>{integer.format(data.hits)}</dd>
      </dl>
    );
  }
  return <Panel title="Runtime">{body}</Panel>;
}

// One sample per second over server-sent events; the browser reconnects by itself.
function LivePanel() {
  const [sample, setSample] = useState<Stats>();

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (event: MessageEvent<string>) => setSample(JSON.parse(event.data) as Stats);
    return () => source.close();
  }, []);

  return (
    <Panel title="Live stats">
      {sample === undefined ? (
        <p>Waiting for the first sample…</p>
      ) : (
        <dl>
          <dt>System</dt>
          <dd>
            {sample.os} {sample.arch}
          </dd>
          <dt>Sampled at</dt>
          <dd>{new Date(sample.timestamp_ms).toLocaleTimeString()}</dd>
        </dl>
      )}
    </Panel>
  );
}

// Native work on the runtime library. Aborting the request (Cancel, a new run, leaving the page) makes the
// server stop the worker.
function BenchmarkPanel() {
  const [iterations, setIterations] = useState("200000000");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const current = useRef<AbortController | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    current.current?.abort();
    const abort = new AbortController();
    current.current = abort;
    setRunning(true);
    setOutcome(undefined);
    try {
      const result = await getJson<BenchResult>(`/api/bench?n=${encodeURIComponent(iterations)}`, abort.signal);
      if (current.current === abort) setOutcome({ ok: true, result });
    } catch (reason) {
      if (current.current === abort) {
        setOutcome({
          ok: false,
          message: abort.signal.aborted ? "Cancelled." : String(reason),
        });
      }
    } finally {
      if (current.current === abort) {
        current.current = null;
        setRunning(false);
      }
    }
  }

  return (
    <Panel title="Native benchmark">
      <form onSubmit={run}>
        <OutlinedTextField
          label="Iterations"
          name="iterations"
          type="number"
          min="1"
          max={String(MAX_ITERATIONS)}
          step="1"
          required
          supportingText={`1 to ${integer.format(MAX_ITERATIONS)}`}
          value={iterations}
          onInput={event => setIterations((event.target as TextFieldElement).value)}
        />
        <div className="actions">
          <FilledButton type="submit" disabled={running}>
            Run native benchmark
          </FilledButton>
          {running && (
            <TextButton type="button" onClick={() => current.current?.abort()}>
              Cancel
            </TextButton>
          )}
        </div>
      </form>
      {running && <LinearProgress indeterminate aria-label="Running the native benchmark" />}
      <p className="result" aria-live="polite">
        {outcome?.ok === true && `${outcome.result.message} (${integer.format(outcome.result.latency_us)} µs)`}
        {outcome?.ok === false && <span className="error">{outcome.message}</span>}
      </p>
    </Panel>
  );
}

export function App() {
  return (
    <main>
      <h1>{document.title}</h1>
      <RuntimePanel />
      <LivePanel />
      <BenchmarkPanel />
    </main>
  );
}
