export {};

const text = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

const first = (await (await fetch("/api/stats")).json()) as {
  runtime: { name: string; version: string; abi: string; target: string };
};
text("runtime").textContent =
  `${first.runtime.name} ${first.runtime.version} (ABI ${first.runtime.abi}, ${first.runtime.target})`;

const events = new EventSource("/api/events");
events.onmessage = event => {
  text("stats").textContent = JSON.stringify(JSON.parse(event.data), null, 2);
};

text("bench").addEventListener("click", async () => {
  text("bench-result").textContent = "running…";
  const result = await (await fetch("/api/bench?n=200000000")).json();
  text("bench-result").textContent = JSON.stringify(result, null, 2);
});
