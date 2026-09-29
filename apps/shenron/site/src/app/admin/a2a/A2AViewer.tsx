"use client";

// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from "react";

export interface Envelope {
	v?: number;
	ts: string;
	id: string;
	from: string;
	to: string;
	kind: "fact" | "ask" | "ack" | "ping" | "error";
	topic: string;
	body: string;
	re?: string;
}

export function A2AViewer() {
	const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
	const [loading, setLoading] = useState(true);
	const [sending, setSending] = useState(false);
	const [target, setTarget] = useState<string>("ocr");
	const [instruction, setInstruction] = useState("");
	const [kind, setKind] = useState<"ask" | "fact" | "ping">("ask");
	const [filterPeer, setFilterPeer] = useState<string>("all");
	const [lastStatus, setLastStatus] = useState<string | null>(null);

	const fetchEnvelopes = async () => {
		try {
			const res = await fetch("/api/a2a?envelopes=1");
			if (res.ok) {
				const data = await res.json();
				setEnvelopes(data.envelopes || []);
			}
		} catch (err) {
			console.error("Erreur récupération enveloppes A2A:", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchEnvelopes();
		const interval = setInterval(fetchEnvelopes, 3000);
		return () => clearInterval(interval);
	}, []);

	const handleSend = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!instruction.trim()) return;

		setSending(true);
		setLastStatus("Envoi en cours via protocole A2A...");
		try {
			const res = await fetch("/api/a2a", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: Date.now(),
					method: "message/send",
					params: {
						target,
						sourceAgent: "admin-ui",
						instruction,
						yolo: true,
					},
				}),
			});

			const data = await res.json();
			if (res.ok) {
				setLastStatus(`✓ Tâche transmise avec succès (${data?.result?.taskId ?? "OK"})`);
				setInstruction("");
				await fetchEnvelopes();
			} else {
				setLastStatus(`✗ Erreur : ${data?.error?.message ?? "Échec transmission"}`);
			}
		} catch (err: any) {
			setLastStatus(`✗ Erreur réseau : ${err?.message ?? err}`);
		} finally {
			setSending(false);
		}
	};

	const filteredEnvelopes = envelopes.filter((env) => {
		if (filterPeer === "all") return true;
		return env.from === filterPeer || env.to === filterPeer;
	});

	return (
		<div className="space-y-6">
			{/* En-tête Statut A2A */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				<div className="p-4 rounded-xl border border-border bg-card/60">
					<span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Protocole</span>
					<div className="text-xl font-bold mt-1 text-primary">A2A 1.0.0</div>
					<div className="text-xs text-muted-foreground mt-0.5">ai.json v1 • .coord Mailbox</div>
				</div>
				<div className="p-4 rounded-xl border border-border bg-card/60">
					<span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Hub Principal</span>
					<div className="text-xl font-bold mt-1 text-primary">Shenron Core</div>
					{/* mcp.dragonballfr.com a été retiré le 2026-09-25 (shenron-mcp fusionné
					    dans aphrody-mcp dragonball.*, sans hôte HTTP public). */}
					<div className="text-xs text-muted-foreground mt-0.5">aphrody-mcp (dragonball.*)</div>
				</div>
				<div className="p-4 rounded-xl border border-border bg-card/60">
					<span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Doctrine</span>
					<div className="text-xl font-bold mt-1 text-emerald-400">YOLO Zero-HITL</div>
					<div className="text-xs text-muted-foreground mt-0.5">Format Bimodal • #bot-admin</div>
				</div>
				<div className="p-4 rounded-xl border border-border bg-card/60">
					<span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Enveloppes Actives</span>
					<div className="text-xl font-bold mt-1 text-amber-400">{envelopes.length}</div>
					<div className="text-xs text-muted-foreground mt-0.5">Canal fichier & RPC unifié</div>
				</div>
			</div>

			{/* Formulaire d'envoi d'ordres A2A */}
			<div className="p-5 rounded-xl border border-border bg-card/40 space-y-4">
				<h3 className="font-semibold text-base flex items-center gap-2">
					<span>⚡ Console d'Ordres A2A (Dispatch Déterministe)</span>
				</h3>
				<form onSubmit={handleSend} className="space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
						<div>
							<label className="text-xs font-semibold text-muted-foreground block mb-1">Cible A2A</label>
							<select
								value={target}
								onChange={(e) => setTarget(e.target.value)}
								className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary"
							>
								<option value="ocr">ocr (état mesuré ou ordre en attente d'un worker)</option>
								<option value="translation">translation (état mesuré de la traduction)</option>
								<option value="rag">rag (recherche réelle, passages et URL)</option>
								<option value="subagents">subagents (ordre en attente de résultat)</option>
								<option value="codex">codex (ordre en attente de résultat)</option>
								<option value="agycli">agycli (ordre en attente de résultat)</option>
								<option value="claude">claude (ordre en attente de résultat)</option>
								<option value="local_model">local_model (ordre en attente d'un worker local)</option>
								<option value="broadcast">broadcast (Tous les pairs)</option>
							</select>
						</div>
						<div>
							<label className="text-xs font-semibold text-muted-foreground block mb-1">Nature de l'ordre</label>
							<select
								value={kind}
								onChange={(e) => setKind(e.target.value as any)}
								className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary"
							>
								<option value="ask">ask (Requête / Ordre de travail)</option>
								<option value="fact">fact (Information factuelle / Statut)</option>
								<option value="ping">ping (Sonde de vitalité heartbeat)</option>
							</select>
						</div>
						<div className="flex items-end">
							<button
								type="submit"
								disabled={sending || !instruction.trim()}
								className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
							>
								{sending ? "Transmission en cours..." : "🚀 Émettre l'Ordre A2A"}
							</button>
						</div>
					</div>
					<div>
						<textarea
							rows={2}
							value={instruction}
							onChange={(e) => setInstruction(e.target.value)}
							placeholder="Instruction technique à transmettre aux pairs A2A..."
							className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary"
						/>
					</div>
					{lastStatus && (
						<div className={`text-xs font-mono p-2 rounded ${lastStatus.startsWith("✓") ? "text-emerald-400 bg-emerald-950/40" : "text-amber-400 bg-amber-950/40"}`}>
							{lastStatus}
						</div>
					)}
				</form>
			</div>

			{/* Visualiseur de flux A2A UI */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="font-semibold text-base flex items-center gap-2">
						<span>📡 Flux des Enveloppes A2A (.coord)</span>
						<span className="text-xs text-muted-foreground">({filteredEnvelopes.length} messages)</span>
					</h3>
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">Filtrer par pair :</span>
						<select
							value={filterPeer}
							onChange={(e) => setFilterPeer(e.target.value)}
							className="bg-background border border-input rounded px-2 py-1 text-xs"
						>
							<option value="all">Tous les pairs</option>
							<option value="codex">codex</option>
							<option value="agycli">agycli</option>
							<option value="claude">claude</option>
							<option value="ocr">ocr</option>
							<option value="rag">rag</option>
							<option value="shenron-dragonball">shenron-dragonball</option>
						</select>
					</div>
				</div>

				{loading ? (
					<div className="text-sm text-muted-foreground py-8 text-center">Chargement des enveloppes A2A...</div>
				) : filteredEnvelopes.length === 0 ? (
					<div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-xl">
						Aucune enveloppe A2A enregistrée dans la boîte locale.
					</div>
				) : (
					<div className="space-y-2.5 font-mono text-xs">
						{filteredEnvelopes.map((env) => {
							const kindBorder =
								env.kind === "fact"
									? "border-l-4 border-l-emerald-500"
									: env.kind === "ask"
									? "border-l-4 border-l-amber-500"
									: env.kind === "ack"
									? "border-l-4 border-l-blue-500"
									: env.kind === "ping"
									? "border-l-4 border-l-purple-500"
									: "border-l-4 border-l-red-500";

							const badgeStyle =
								env.kind === "fact"
									? "text-emerald-400 bg-emerald-950/60 border-emerald-800/60"
									: env.kind === "ask"
									? "text-amber-400 bg-amber-950/60 border-amber-800/60"
									: env.kind === "ack"
									? "text-blue-400 bg-blue-950/60 border-blue-800/60"
									: env.kind === "ping"
									? "text-purple-400 bg-purple-950/60 border-purple-800/60"
									: "text-red-400 bg-red-950/60 border-red-800/60";

							return (
								<div
									key={env.id}
									className={`p-3.5 rounded-lg border border-border bg-[#0d1117] text-[#e6edf3] ${kindBorder} space-y-2`}
								>
									<div className="flex items-center justify-between flex-wrap gap-2 text-xs">
										<div className="flex items-center gap-2">
											<span className="font-bold text-[#79c0ff]">{env.from}</span>
											<span className="text-muted-foreground">→</span>
											<span className="font-bold text-[#79c0ff]/80">{env.to}</span>
											<span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${badgeStyle}`}>
												{env.kind}
											</span>
											<span className="text-muted-foreground/60 text-[10px]">({env.id})</span>
										</div>
										<span className="text-muted-foreground text-[11px]">
											{new Date(env.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
										</span>
									</div>

									{env.topic && <div className="font-semibold text-sm text-[#e6edf3]">{env.topic}</div>}

									{env.body && (
										<div className="text-xs text-[#8b949e] whitespace-pre-wrap break-words bg-[#161b22] p-2.5 rounded border border-[#21262d] max-h-48 overflow-y-auto">
											{env.body}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
