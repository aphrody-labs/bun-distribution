import { inject, injectable } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	type CommandInteraction,
	EmbedBuilder,
	MessageFlags,
	PermissionsBitField,
} from "discord.js";
import os from "node:os";
import path from "node:path";
import { GuildOnly } from "~/guards/GuildOnly";
import { CommandsChannelOnly } from "~/guards/CommandsChannelOnly";
import { TrainingService } from "~/services/TrainingService";
import { SHENRON_THEME, SHENRON_SEPARATORS, renderProgressBar } from "~/lib/embeds";

export type TrainRunKind = "embed" | "rerank";

export interface TrainJob {
	id: string;
	kind: TrainRunKind;
	input: string;
	outDir: string;
	startedBy: string;
	startedAt: number;
	status: "running" | "succeeded" | "failed";
	exitCode: number | null;
	tail: string;
}

/** `$APHRODY_HOME`, else `~/.aphrody` (same root as the Rust `state_dir`). */
export function aphrodyStateDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.APHRODY_HOME?.trim() || path.join(os.homedir(), ".aphrody");
}

/** Default dbfr triples: `<state>/workspaces/dbfr/training/triples.jsonl`. */
export function defaultDbfrTriples(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(aphrodyStateDir(env), "workspaces", "dbfr", "training", "triples.jsonl");
}

/** argv for `aphrody train run`; the binary comes from `APHRODY_BIN` (default `aphrody`). */
export function buildTrainRunArgv(
	job: Pick<TrainJob, "id" | "kind" | "input" | "outDir">,
	env: NodeJS.ProcessEnv = process.env
): string[] {
	return [
		env.APHRODY_BIN?.trim() || "aphrody",
		"train",
		"run",
		"--kind",
		job.kind,
		"--id",
		job.id,
		"--input",
		job.input,
		"--out-dir",
		job.outDir,
	];
}

type Spawner = (argv: string[], env: Record<string, string | undefined>) => {
	exited: Promise<number>;
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
};

const bunSpawner: Spawner = (argv, env) => {
	const proc = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	return { exited: proc.exited, stdout: proc.stdout, stderr: proc.stderr };
};

/** Non-blocking `aphrody train run` jobs started from Discord, tracked in memory. */
export class TrainJobRunner {
	private readonly jobs = new Map<string, TrainJob>();

	constructor(
		private readonly spawner: Spawner = bunSpawner,
		private readonly env: NodeJS.ProcessEnv = process.env
	) {}

	start(kind: TrainRunKind, input: string | undefined, startedBy: string): TrainJob {
		const id = `shenron-${kind}-${Date.now().toString(36)}`;
		const job: TrainJob = {
			id,
			kind,
			input: input?.trim() || defaultDbfrTriples(this.env),
			outDir: path.join(aphrodyStateDir(this.env), "train", id),
			startedBy,
			startedAt: Date.now(),
			status: "running",
			exitCode: null,
			tail: "",
		};
		this.jobs.set(id, job);
		const proc = this.spawner(buildTrainRunArgv(job, this.env), {
			...this.env,
			APHRODY_AGENT_DOMAIN: "dbfr",
		});
		const append = async (stream: ReadableStream<Uint8Array> | null) => {
			if (!stream) return;
			const decoder = new TextDecoder();
			for await (const chunk of stream) {
				job.tail = (job.tail + decoder.decode(chunk, { stream: true })).slice(-1500);
			}
		};
		void Promise.all([append(proc.stdout), append(proc.stderr)]).catch(() => {});
		void (async () => {
			try {
				const code = await proc.exited;
				job.exitCode = code;
				job.status = code === 0 ? "succeeded" : "failed";
			} catch (error) {
				job.status = "failed";
				job.tail = `${job.tail}\n${String(error)}`.slice(-1500);
			}
		})();
		return job;
	}

	get(id: string): TrainJob | undefined {
		return this.jobs.get(id);
	}

	latest(): TrainJob | undefined {
		let last: TrainJob | undefined;
		for (const job of this.jobs.values()) if (!last || job.startedAt >= last.startedAt) last = job;
		return last;
	}
}

export const trainJobs = new TrainJobRunner();

function isAdmin(interaction: CommandInteraction): boolean {
	return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
}

function describeJob(job: TrainJob): string {
	const icon = job.status === "running" ? "🟠" : job.status === "succeeded" ? "🟢" : "🔴";
	const tail = job.tail.trim().slice(-900);
	return [
		`${icon} **Job \`${job.id}\`** — ${job.status}${job.exitCode === null ? "" : ` (code ${job.exitCode})`}`,
		`• Type : \`${job.kind}\``,
		`• Entrée : \`${job.input}\``,
		`• Sortie : \`${job.outDir}\``,
		`• Lancé par <@${job.startedBy}> <t:${Math.floor(job.startedAt / 1000)}:R>`,
		tail ? `\`\`\`\n${tail}\n\`\`\`` : "",
	]
		.filter(Boolean)
		.join("\n");
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly, CommandsChannelOnly)
@SlashGroup({
	name: "train",
	description: "Interface d'entraînement direct du RAG et des APIs de Dragon Ball FR",
})
@SlashGroup("train")
@injectable()
export class TrainCommands {
	constructor(@inject(TrainingService) private training: TrainingService) {}

	@Slash({
		name: "eval",
		description: "Lance une évaluation directe du RAG sur le banc de test gold (Recall, MRR, nDCG)",
	})
	async eval(
		@SlashChoice({ name: "Rapide (10 questions)", value: 10 })
		@SlashChoice({ name: "Échantillon moyen (25 questions)", value: 25 })
		@SlashChoice({ name: "Complet (toutes les questions)", value: 0 })
		@SlashOption({
			name: "echantillon",
			description: "Nombre de cas à tester (0 = tout le dataset)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
		})
		sample: number | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();
		const sampleSize = sample && sample > 0 ? sample : undefined;

		try {
			const metrics = await this.training.evaluateRag(sampleSize);

			const r1Pct = Math.round((metrics.recall[1] ?? 0) * 100);
			const r5Pct = Math.round((metrics.recall[5] ?? 0) * 100);
			const mrrPct = Math.round((metrics.mrr ?? 0) * 100);
			const ndcgPct = Math.round((metrics.ndcg ?? 0) * 100);

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.gold)
				.setAuthor({
					name: "SHENRON · ÉVALUATION DIRECTE DU RAG",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle(`🎯 Benchmarking Retrieval : ${metrics.cases} cas évalués`)
				.setDescription(
					[
						`*Mesure de la précision de récupération sur le banc de test doré de Dragon Ball FR.*`,
						"",
						SHENRON_SEPARATORS.solid,
						`**Recall@1 (Top 1 parfait) :** \`${renderProgressBar(r1Pct, 100, 8)}\``,
						`**Recall@5 (Dans le Top 5) :** \`${renderProgressBar(r5Pct, 100, 8)}\``,
						`**MRR (Rang moyen de succès) :** \`${mrrPct}%\``,
						`**nDCG@10 (Qualité de placement) :** \`${ndcgPct}%\``,
						SHENRON_SEPARATORS.solid,
						`⏱️ **Durée d'exécution :** \`${metrics.durationMs} ms\` (${Math.round(metrics.durationMs / (metrics.cases || 1))} ms/req)`,
						`⚡ **Sidecar Embeddings :** ${metrics.sidecarActive ? "🟢 En ligne (WASM/ONNX)" : "🟠 Repli Lexical BM25"}`,
					].join("\n")
				);

			if (metrics.misses.length > 0) {
				const missesLines = metrics.misses.slice(0, 4).map((m) => {
					return `• **« ${m.q} »** → Attendu: \`${m.expected.join(", ")}\` (Reçu: *${m.returnedTitle ?? "aucun"}*)`;
				});
				embed.addFields({
					name: `⚠️ Imprécisions détectées (${metrics.misses.length}/${metrics.cases})`,
					value: missesLines.join("\n").slice(0, 1024),
				});
			} else {
				embed.addFields({
					name: "🏆 Score Parfait",
					value: "Aucun miss détecté dans l'échantillon évalué. Toutes les entités canoniques ont été retrouvées !",
				});
			}

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({
				content: `❌ Échec de l'évaluation : ${e.message}`,
			});
		}
	}

	@Slash({
		name: "inspect-rag",
		description: "Inspection chirurgicale des scores, tokens et pondérations de vérité du RAG",
	})
	async inspectRag(
		@SlashOption({
			name: "question",
			description: "La question ou le terme à diagnostiquer",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		question: string,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		try {
			const diag = await this.training.inspectRag(question);

			const resultsLines = diag.results.map((r, i) => {
				const subjectBoost = r.isExactSubject ? " 🎯 [Sujet Exact +45%]" : "";
				const mult = r.truthMultiplier !== 1 ? ` · Poids vérité: ×${r.truthMultiplier.toFixed(1)}` : "";
				const rerank = r.rerankScore !== undefined ? ` · Rerank: ${r.rerankScore.toFixed(3)}` : "";
				const snip = r.snippet ? r.snippet.replace(/\s+/g, " ").slice(0, 130) : "";
				return `**[${i + 1}] [${r.kind.toUpperCase()}] ${r.title}** (Score: ${(r.score * 100).toFixed(1)}%)${subjectBoost}${mult}${rerank}\n> *${snip}*`;
			});

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.saiyanBlue)
				.setAuthor({
					name: "DIAGNOSTIC TECHNIQUE RAG · SHENRON",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle(`🔍 Analyse RAG : « ${diag.query.slice(0, 100)} »`)
				.setDescription(
					[
						`**Tokens FTS5 :** \`${diag.tokens.join("`, `") || "aucun"}\``,
						`**Mode d'exécution :** \`${diag.mode}\``,
						`**Temps de réponse :** \`${diag.durationMs} ms\``,
						`**Sidecar Embeddings :** ${diag.sidecarActive ? "🟢 Connecté" : "🟠 Non disponible"}`,
						"",
						SHENRON_SEPARATORS.solid,
						`**Top ${diag.results.length} résultats classés :**`,
						resultsLines.join("\n\n") || "*Aucun résultat retourné par le moteur.*",
					]
						.join("\n")
						.slice(0, 4096)
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({
				content: `❌ Échec du diagnostic : ${e.message}`,
			});
		}
	}

	@Slash({
		name: "inspect-canon",
		description: "Inspection de la doctrine de canonicité, détection de troll et preuves",
	})
	async inspectCanon(
		@SlashOption({
			name: "sujet",
			description: "Le sujet ou l'affirmation à inspecter (ex: Broly, Gine, SSJ4)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		sujet: string,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		try {
			const diag = await this.training.inspectCanon(sujet);
			if (!diag) {
				await interaction.editReply({ content: "⚠️ L'API Canon n'a pas pu être contactée." });
				return;
			}

			const embed = new EmbedBuilder()
				.setColor(diag.tier === "CANON_ABSOLU" ? 0x22c55e : diag.tier === "APOCRYPHE_FANON" ? 0xef4444 : 0xf59e0b)
				.setAuthor({
					name: "DIAGNOSTIC API CANON · SHENRON",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle(`⚖️ ${diag.tierLabel} : ${diag.query}`)
				.setDescription(
					[
						`**Nature détectée :** \`${diag.nature.toUpperCase()}\``,
						`**Autorité :** \`${diag.score}/100\``,
						`**Latence de résolution :** \`${diag.latencyMs} ms\``,
						"",
						SHENRON_SEPARATORS.solid,
						`**Verdict Doctrinal :** ${diag.verdict}`,
						"",
						diag.toriyamaQuote
							? `**Citations Toriyama :**\n> « ${diag.toriyamaQuote.text} »\n*— ${diag.toriyamaQuote.source} (${diag.toriyamaQuote.year ?? "s.d."})*`
							: "*Aucune citation directe d'Akira Toriyama attachée.*",
						"",
						SHENRON_SEPARATORS.solid,
						`📚 **Preuves rattachées :** \`${diag.referencesCount} références\`, \`${diag.planchesCount} databooks\`, \`${diag.fichesCount} fiches\``,
					].join("\n")
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
		}
	}

	@Slash({
		name: "inspect-manga",
		description: "Inspection de la recherche de dialogues dans les planches du manga",
	})
	async inspectManga(
		@SlashOption({
			name: "citation",
			description: "La citation ou réplique (ex: Kamehameha, Je suis Son Goku)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		citation: string,
		@SlashChoice({ name: "Dragon Ball original", value: "DB" })
		@SlashChoice({ name: "Dragon Ball Super", value: "DBS" })
		@SlashOption({
			name: "series",
			description: "Filtrer par série",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		series: string | undefined,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		try {
			const diag = await this.training.inspectManga(citation, { series });

			const planchesLines = diag.resultats.map((p, i) => {
				const snip = p.extrait.replace(/\s+/g, " ").trim();
				return `**[${i + 1}] ${p.series} — ${p.tome}, planche ${p.planche}** (Score: ${p.score.toFixed(1)})\n> *${snip}*\n🔗 [Consulter la planche](${p.href})`;
			});

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.orange)
				.setAuthor({
					name: "DIAGNOSTIC RECHERCHE MANGA · OCR",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle(`📖 Recherche de réplique : « ${citation} »`)
				.setDescription(
					[
						`**Planches correspondantes trouvées :** \`${diag.count}\``,
						`**Latence de recherche :** \`${diag.latencyMs} ms\``,
						"",
						SHENRON_SEPARATORS.solid,
						planchesLines.join("\n\n") || "*Aucune réplique exacte trouvée dans le manga numérisé.*",
					]
						.join("\n")
						.slice(0, 4096)
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
		}
	}

	@Slash({
		name: "inspect-frames",
		description: "Diagnostic de recherche visuelle et timecode d'épisode via capture d'écran",
	})
	async inspectFrames(
		@SlashOption({
			name: "image_url",
			description: "URL publique de l'image ou capture d'écran à analyser",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		imageUrl: string,
		interaction: CommandInteraction
	) {
		await interaction.deferReply();

		try {
			const diag = await this.training.inspectFrames(imageUrl);

			const matchesLines = diag.matches.map((m, i) => {
				return `**[${i + 1}] ${m.titre}** · Timecode: \`${m.timecode}\` (Similarité: ${m.similarity}%)\n🔗 [Voir la scène](${m.href})`;
			});

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.beerusPurple)
				.setAuthor({
					name: "DIAGNOSTIC RECHERCHE VISUELLE · FRAMES",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle(`🖼️ Analyse d'image`)
				.setThumbnail(imageUrl)
				.setDescription(
					[
						`**Correspondances identifiées :** \`${diag.count}\``,
						`**Parasites hors univers rejetés :** \`${diag.parasitesRejetes}\``,
						`**Latence :** \`${diag.latencyMs} ms\``,
						"",
						SHENRON_SEPARATORS.solid,
						matchesLines.join("\n\n") || "*Aucune scène Dragon Ball correspondante trouvée.*",
					]
						.join("\n")
						.slice(0, 4096)
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
		}
	}

	@Slash({
		name: "feedback",
		description: "Enregistrer une évaluation ou un retour d'entraînement pour améliorer les résultats",
	})
	async feedback(
		@SlashChoice({ name: "Moteur RAG (Recherche IA)", value: "rag" })
		@SlashChoice({ name: "API Canon (Doctrine)", value: "canon" })
		@SlashChoice({ name: "Recherche Manga (OCR)", value: "manga" })
		@SlashChoice({ name: "Recherche Frames (Images)", value: "frames" })
		@SlashOption({
			name: "type",
			description: "Brique concernée",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		type: "rag" | "canon" | "frames" | "manga",
		@SlashOption({
			name: "question",
			description: "La question ou le terme testé",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		question: string,
		@SlashChoice({ name: "⭐⭐⭐⭐⭐ (Parfait)", value: 5 })
		@SlashChoice({ name: "⭐⭐⭐⭐ (Bon)", value: 4 })
		@SlashChoice({ name: "⭐⭐⭐ (Moyen)", value: 3 })
		@SlashChoice({ name: "⭐⭐ (Imprécis)", value: 2 })
		@SlashChoice({ name: "⭐ (Faux / Hors-sujet)", value: 1 })
		@SlashOption({
			name: "note",
			description: "Note d'exactitude",
			type: ApplicationCommandOptionType.Integer,
			required: true,
		})
		rating: number,
		@SlashOption({
			name: "attendu",
			description: "Ce qui aurait dû être renvoyé (ex: fiche Son Goku, tome 22)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		expected: string | undefined,
		@SlashOption({
			name: "commentaire",
			description: "Détails ou explications supplémentaires",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		comment: string | undefined,
		interaction: CommandInteraction
	) {
		await this.training.recordFeedback({
			userId: interaction.user.id,
			userTag: interaction.user.username,
			type,
			query: question,
			rating,
			expected,
			comment,
		});

		await interaction.reply({
			content: `✅ **Retour d'entraînement enregistré !** Merci <@${interaction.user.id}> pour cette contribution à l'exactitude de Shenron.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	@Slash({
		name: "gold-add",
		description: "Ajouter une question au banc de test d'or (gold dataset) pour l'évaluation continue",
	})
	async goldAdd(
		@SlashOption({
			name: "question",
			description: "La question à ajouter au dataset",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		question: string,
		@SlashOption({
			name: "attendus",
			description: "Mots-clés ou titres attendus séparés par des virgules (ex: Gine, Saiyan)",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		expectedRaw: string,
		interaction: CommandInteraction
	) {
		const expected = expectedRaw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const ok = await this.training.addGoldCase(question, expected, interaction.user.id, interaction.user.username);
		if (ok) {
			await interaction.reply({
				content: `🏆 **Cas de test gold ajouté avec succès !**\n• Question : « ${question} »\n• Attendus : ${expected.map((e) => `« ${e} »`).join(", ")}\nIl sera inclus dans les prochains tests et CI.`,
			});
		} else {
			await interaction.reply({
				content: `❌ Impossible d'ajouter ce cas de test (paramètres invalides).`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	@Slash({
		name: "stats",
		description: "Afficher le tableau de bord des données d'entraînement et de la santé des APIs",
	})
	async stats(interaction: CommandInteraction) {
		await interaction.deferReply();

		try {
			const s = await this.training.getStats();
			const remoteRag = process.env.RAG_BACKEND === "aphrody";

			const embed = new EmbedBuilder()
				.setColor(SHENRON_THEME.kiGreen)
				.setAuthor({
					name: "TABLEAU DE BORD D'ENTRAÎNEMENT · SHENRON",
					iconURL: "https://dragonballfr.com/favicon.ico",
				})
				.setTitle("📊 Statistiques Moteur & Disponibilité")
				.setDescription(
					[
						`*Vue d'ensemble des données d'entraînement et de la santé des briques Dragon Ball FR.*`,
						"",
						SHENRON_SEPARATORS.solid,
						`📚 **Corpus RAG :** \`${s.totalChunks.toLocaleString()} chunks indexés\` (${remoteRag ? "Aphrody" : "FTS5 BM25"})`,
						`⚡ **Vecteurs denses :** \`${s.totalVectors.toLocaleString()} embeddings\` (${remoteRag ? "Aphrody" : "sqlite-vec"})`,
						`🎯 **Cas de test Gold :** \`${s.totalGoldCases} questions validées\``,
						`📝 **Feedbacks utilisateurs :** \`${s.totalFeedbacks} retours\` (\`${s.goldFeedbacks} gold\` · \`${s.pendingFeedbacks} en attente\`)`,
						"",
						SHENRON_SEPARATORS.solid,
						`**État des briques de production :**`,
						`• ${remoteRag ? "Embeddings Aphrody" : "Embeddings E5 (aphrody-shenron-embed)"} : ${s.sidecarStatus === "online" ? "🟢 Opérationnel" : "🔴 Hors-ligne"}`,
						`• API Site (Canon / Manga) : ${s.siteApiStatus === "online" ? "🟢 Opérationnel" : "🔴 Hors-ligne"}`,
						`• Bot Shenron (Port 5006) : ${s.botApiStatus === "online" ? "🟢 Opérationnel" : "🔴 Hors-ligne"}`,
					].join("\n")
				);

			await interaction.editReply({ embeds: [embed] });
		} catch (e: any) {
			await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
		}
	}

	@Slash({
		name: "run",
		description: "Admin: lance un entraînement embed/rerank (aphrody train run) en arrière-plan",
	})
	async run(
		@SlashChoice({ name: "Embeddings", value: "embed" })
		@SlashChoice({ name: "Reranker", value: "rerank" })
		@SlashOption({
			name: "type",
			description: "Type d'entraînement",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		kind: TrainRunKind,
		@SlashOption({
			name: "entree",
			description: "Fichier de triplets (défaut : workspace dbfr training/triples.jsonl)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		input: string | undefined,
		interaction: CommandInteraction
	) {
		if (!isAdmin(interaction)) {
			await interaction.reply({
				content: "❌ Commande réservée aux administrateurs.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		try {
			const job = trainJobs.start(kind, input, interaction.user.id);
			await interaction.reply({
				content: `🚀 Entraînement lancé.\n${describeJob(job)}\nSuivi : \`/train job id:${job.id}\``,
				flags: MessageFlags.Ephemeral,
			});
		} catch (e: any) {
			await interaction.reply({
				content: `❌ Lancement impossible : ${e?.message ?? e}`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	@Slash({ name: "job", description: "Admin: état d'un entraînement lancé via /train run" })
	async job(
		@SlashOption({
			name: "id",
			description: "Identifiant du job (défaut : le plus récent)",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		id: string | undefined,
		interaction: CommandInteraction
	) {
		if (!isAdmin(interaction)) {
			await interaction.reply({
				content: "❌ Commande réservée aux administrateurs.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const job = id ? trainJobs.get(id.trim()) : trainJobs.latest();
		await interaction.reply({
			content: job ? describeJob(job) : "Aucun job d'entraînement connu depuis le démarrage du bot.",
			flags: MessageFlags.Ephemeral,
		});
	}
}
