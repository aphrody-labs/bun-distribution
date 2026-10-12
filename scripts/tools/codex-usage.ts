#!/usr/bin/env bun
/** Report Codex quota, credits and active-repository graph facts. */

type CommandResult = { command: string; code: number; output: string };

const args = Bun.argv.slice(2);
const jsonOnly = args.includes("--json");
const repo = process.cwd();

async function run(command: string, commandArgs: string[]): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...commandArgs], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    command: [command, ...commandArgs].join(" "),
    code,
    output: `${stdout}\n${stderr}`.trim(),
  };
}

function numberAfter(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1].replace(/\s/g, "").replace(",", "."));
  }
}

function duration(text: string): string | undefined {
  return text
    .match(/(?:reset(?:ting|s| in)?|réinitialisation[^\n]*?dans)\s*:?\s*([^\n]+)/i)?.[1]
    ?.trim();
}

const [status, usage, credits, graph] = await Promise.all([
  run("codex", ["status"]),
  run("codex", ["usage"]),
  run("codex", ["credits"]),
  run("aphrody", ["graph", "--source", "graph:aphrody", "report"]),
]);
const codexText = [status.output, usage.output, credits.output].join("\n");
const remainingPercent = numberAfter(codexText, [
  /(\d+(?:[.,]\d+)?)\s*%\s*(?:remaining|restants?)/i,
]);
const creditBalance = numberAfter(codexText, [
  /(\d[\d\s.,]*)\s*(?:credits?|crédits?)/i,
  /(?:credits?|crédits?)\s*(?:remaining|restants?)\s*:?\s*(\d[\d\s.,]*)/i,
]);
const resetIn = duration(codexText);
const graphFacts = graph.output.match(
  /(?:nodes?|nœuds?)\s*[:=]?\s*([\d\s.,]+).*?(?:edges?|arêtes?)\s*[:=]?\s*([\d\s.,]+)/is,
);

const report = {
  repository: repo,
  quota: {
    remainingPercent,
    resetIn,
    hoursRemaining: remainingPercent === 0 ? 0 : undefined,
    note: "Les crédits et le pourcentage de quota ne permettent pas de convertir fidèlement en heures sans débit horaire observé.",
  },
  credits: { remaining: creditBalance },
  graph: {
    command: graph.command,
    nodes: graphFacts ? Number(graphFacts[1].replace(/[\s.,]/g, "")) : undefined,
    edges: graphFacts ? Number(graphFacts[2].replace(/[\s.,]/g, "")) : undefined,
    exitCode: graph.code,
  },
  commands: { status: status.code, usage: usage.code, credits: credits.code },
};

if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Dépôt actif : ${repo}`);
  console.log(
    `Quota restant : ${remainingPercent === undefined ? "inconnu" : `${remainingPercent}%`}`,
  );
  console.log(`Heures calculables : ${report.quota.hoursRemaining ?? "non calculable"}`);
  console.log(`Réinitialisation : ${resetIn ?? "inconnue"}`);
  console.log(`Crédits restants : ${creditBalance === undefined ? "inconnus" : creditBalance}`);
  console.log(`Graphe : ${report.graph.nodes ?? "?"} nœuds, ${report.graph.edges ?? "?"} arêtes`);
  if (status.code || usage.code || credits.code)
    console.log(
      "Note : la CLI Codex locale ne supporte pas toutes les commandes status/usage/credits.",
    );
}
