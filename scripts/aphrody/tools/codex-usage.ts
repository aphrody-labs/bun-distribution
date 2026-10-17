#!/usr/bin/env bun
/** Report Codex quota, credits and active-repository graph facts. */

type CommandResult = { command: string; code: number; output: string };

const args = Bun.argv.slice(2);
const jsonOnly = args.includes("--json");
const repo = process.cwd();
const creditsArgument = args.find(arg => arg.startsWith("--credits="))?.split("=", 2)[1];
const resetArgument = args.find(arg => arg.startsWith("--reset-in="))?.split("=", 2)[1];

async function run(command: string, commandArgs: string[]): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...commandArgs], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
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
    const value = match?.[1];
    if (value !== undefined) return Number(value.replace(/\s/g, "").replace(",", "."));
  }
}

function duration(text: string): string | undefined {
  return text.match(/(?:reset(?:ting|s| in)?|réinitialisation[^\n]*?dans)\s*:?\s*([^\n]+)/i)?.[1]?.trim();
}

function resetHours(text: string | undefined): number | undefined {
  if (!text) return;
  const days = text.match(/(\d+(?:[.,]\d+)?)\s*(?:j|d|days?)/i)?.[1];
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hours?)/i)?.[1];
  if (!days && !hours) return;
  return Number(days?.replace(",", ".") ?? 0) * 24 + Number(hours?.replace(",", ".") ?? 0);
}

const [status, usage, credits, graph] = await Promise.all([
  run("codex", ["status"]),
  run("codex", ["usage"]),
  run("codex", ["credits"]),
  run("aphrody", ["graph", "--source", "graph:aphrody", "report"]),
]);
const codexText = [status.output, usage.output, credits.output].join("\n");
const remainingPercent = numberAfter(codexText, [/(\d+(?:[.,]\d+)?)\s*%\s*(?:remaining|restants?)/i]);
const creditBalance =
  creditsArgument === undefined
    ? numberAfter(codexText, [
        /(\d[\d\s.,]*)\s*(?:credits?|crédits?)/i,
        /(?:credits?|crédits?)\s*(?:remaining|restants?)\s*:?\s*(\d[\d\s.,]*)/i,
      ])
    : Number(creditsArgument);
const resetIn = resetArgument ?? duration(codexText);
const resetHoursValue = resetHours(resetIn);
const graphFacts = graph.output.match(
  /(?:nodes?|nœuds?)\s*[:=]?\s*([\d\s.,]+).*?(?:edges?|arêtes?)\s*[:=]?\s*([\d\s.,]+)/is,
);
const graphNodes = graphFacts?.[1];
const graphEdges = graphFacts?.[2];

const report = {
  repository: repo,
  quota: {
    remainingPercent,
    resetIn,
    resetHours: resetHoursValue,
    hoursRemaining: remainingPercent === 0 ? 0 : undefined,
    note: "OpenAI documente une consommation variable selon modèle, raisonnement, entrées/sorties et outils; aucun taux fixe crédit/heure n'est documenté.",
  },
  credits: { remaining: creditBalance },
  graph: {
    command: graph.command,
    nodes: graphNodes === undefined ? undefined : Number(graphNodes.replace(/[\s.,]/g, "")),
    edges: graphEdges === undefined ? undefined : Number(graphEdges.replace(/[\s.,]/g, "")),
    exitCode: graph.code,
  },
  commands: { status: status.code, usage: usage.code, credits: credits.code },
};

if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Dépôt actif : ${repo}`);
  console.log(`Quota restant : ${remainingPercent === undefined ? "inconnu" : `${remainingPercent}%`}`);
  console.log(`Heures de quota consommables : ${report.quota.hoursRemaining ?? "non calculable"}`);
  console.log(`Temps avant réinitialisation : ${resetIn ?? "inconnu"} (${resetHoursValue ?? "?"} h)`);
  console.log(`Crédits restants : ${creditBalance === undefined ? "inconnus" : creditBalance}`);
  console.log(`Graphe : ${report.graph.nodes ?? "?"} nœuds, ${report.graph.edges ?? "?"} arêtes`);
  if (status.code || usage.code || credits.code)
    console.log("Note : la CLI Codex locale ne supporte pas toutes les commandes status/usage/credits.");
}
