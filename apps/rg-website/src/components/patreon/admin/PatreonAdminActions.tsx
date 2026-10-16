"use client";

import { Button } from "@rosegriffon/ui";
import { Loader2, RefreshCw, Shuffle, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ExportSummary {
	exported: number;
	upserted: number;
	tiersExported: number;
	durationMs: number;
}

interface ReconcileSummary {
	byEmail: number;
	byDiscord: number;
	totalLegacy: number;
	stillPending: number;
}

export function PatreonAdminActions() {
	const [busy, setBusy] = useState<null | "export" | "reconcile" | "churn">(null);

	const runExport = async () => {
		setBusy("export");
		try {
			const res = await fetch("/api/admin/patreon/export", { method: "POST" });
			const json = (await res.json()) as {
				ok: boolean;
				summary?: ExportSummary;
				error?: string;
			};
			if (!json.ok) {
				toast.error(`Export Patreon échoué : ${json.error ?? "?"}`);
				return;
			}
			toast.success(
				`Export OK : ${json.summary?.exported} membres, ${json.summary?.tiersExported} tiers (${json.summary?.durationMs}ms)`
			);
		} catch (error) {
			toast.error(`Erreur réseau : ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setBusy(null);
			window.location.reload();
		}
	};

	const runReconcile = async () => {
		setBusy("reconcile");
		try {
			const res = await fetch("/api/admin/patreon/reconcile", {
				method: "POST",
			});
			const json = (await res.json()) as {
				ok: boolean;
				summary?: ReconcileSummary;
				error?: string;
			};
			if (!json.ok) {
				toast.error(`Reconcile échoué : ${json.error ?? "?"}`);
				return;
			}
			toast.success(
				`Reconcile OK : ${json.summary?.byEmail} via email, ${json.summary?.byDiscord} via Discord, ${json.summary?.stillPending} restants`
			);
		} catch (error) {
			toast.error(`Erreur réseau : ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setBusy(null);
			window.location.reload();
		}
	};

	const markChurnDefinitive = async () => {
		if (!confirm("Marquer churn définitif tous les non-réactivés depuis 90 jours ?")) {
			return;
		}
		setBusy("churn");
		try {
			const res = await fetch("/api/admin/patreon/cleanup", {
				body: JSON.stringify({ daysSincePending: 90 }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			const json = (await res.json()) as {
				ok: boolean;
				count?: number;
				error?: string;
			};
			if (!json.ok) {
				toast.error(`Cleanup échoué : ${json.error ?? "?"}`);
				return;
			}
			toast.success(`${json.count ?? 0} membres marqués churn`);
		} catch (error) {
			toast.error(`Erreur réseau : ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setBusy(null);
			window.location.reload();
		}
	};

	return (
		<section className="rounded-2xl border border-border bg-card p-6">
			<h2 className="mb-4 font-semibold text-foreground">Outils de migration</h2>
			<div className="flex flex-wrap gap-3">
				<Button onClick={runExport} disabled={busy !== null} variant="outline" className="gap-2">
					{busy === "export" ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<RefreshCw className="size-4" />
					)}
					Lancer export complet
				</Button>
				<Button onClick={runReconcile} disabled={busy !== null} variant="outline" className="gap-2">
					{busy === "reconcile" ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Shuffle className="size-4" />
					)}
					Réconciliation auto
				</Button>
				<Button
					onClick={markChurnDefinitive}
					disabled={busy !== null}
					variant="outline"
					className="gap-2 border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
				>
					{busy === "churn" ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<XCircle className="size-4" />
					)}
					Cleanup post-cutoff (90j)
				</Button>
			</div>
			<p className="mt-3 text-xs text-muted-foreground/70">
				Export : récupère tous les membres et tiers depuis l'API Patreon (max ~5 min). Reconcile :
				tente le match email puis Discord ID sur les pending.
			</p>
		</section>
	);
}
