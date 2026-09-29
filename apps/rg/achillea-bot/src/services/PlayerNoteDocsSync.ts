import { Service } from "@/decorators";
import { PlayerNoteCategory, PlayerNoteSeverity } from "@/utils/enums";
import type { PlayerNoteRecord } from "./PlayerNoteService";

import { DataStore } from "./DataStore";
import { GoogleWorkspaceService } from "./GoogleWorkspaceService";

const DOC_NAME = "Achilléa — Registre des signalements joueurs";

const CATEGORY_LABELS: Record<PlayerNoteCategory, string> = {
	[PlayerNoteCategory.BEHAVIOR]: "Comportement",
	[PlayerNoteCategory.CHEATING]: "Triche suspectée",
	[PlayerNoteCategory.NO_SHOW]: "Absence / no-show",
	[PlayerNoteCategory.SCORE_DISPUTE]: "Litige de score",
	[PlayerNoteCategory.POSITIVE]: "Positif",
	[PlayerNoteCategory.OTHER]: "Autre",
};

const SEVERITY_LABELS: Record<PlayerNoteSeverity, string> = {
	[PlayerNoteSeverity.INFO]: "Info",
	[PlayerNoteSeverity.WARNING]: "Attention",
	[PlayerNoteSeverity.SERIOUS]: "Grave",
};

/**
 * Miroir des signalements dans un Google Doc du dossier Drive Achilléa.
 *
 * Le cadrage demandait « un document ou autre que les autres admin peuvent voir » :
 * la base reste la source de vérité (recherche, filtres, résolution), le document sert
 * de registre lisible par le staff qui vit dans Drive et pas dans le dashboard.
 *
 * Registre **append-only et antichronologique** : chaque évènement est inséré en tête.
 * Rien n'est réécrit — un document qu'on modifie en place se désynchronise au premier
 * échec réseau, alors qu'un journal qui ne fait qu'ajouter reste toujours cohérent.
 *
 * La synchronisation ne bloque jamais le dépôt d'un signalement : sans configuration
 * Google, ou en cas d'erreur d'API, la note existe quand même en base.
 */
@Service()
export class PlayerNoteDocsSync {
	constructor(
		private dataStore: DataStore,
		private google: GoogleWorkspaceService
	) {}

	/**
	 * Id du registre. Trois sources, dans l'ordre : la variable d'environnement (la
	 * plus fiable, un compte de service ne pouvant pas créer de fichier dans un « Mon
	 * Drive »), la valeur mémorisée en base, puis la recherche par nom dans le dossier.
	 */
	private async ensureDocument(): Promise<string | null> {
		if (!this.google.available || !this.google.folderId) return null;

		const pinned = process.env.GOOGLE_PLAYER_NOTES_DOC_ID?.trim();
		if (pinned) return pinned;

		try {
			const stored = await this.dataStore.get("playerNotesDocId");
			if (stored) return stored;
		} catch {
			// Clé absente (base antérieure à cette fonctionnalité) : on continue.
		}

		// Un document du même nom peut déjà exister (créé à la main par le staff) :
		// on le réutilise plutôt que d'en semer un second.
		const existing =
			(await this.google.findDocumentByName(DOC_NAME)) ??
			(await this.google.createDocument(DOC_NAME));

		if (existing) await this.dataStore.set("playerNotesDocId", existing);

		return existing;
	}

	async documentUrl(): Promise<string | null> {
		const id = await this.ensureDocument();
		return id ? this.google.documentUrl(id) : null;
	}

	/** Consigne un signalement. Renvoie l'URL du document, ou null si indisponible. */
	async appendNote(note: PlayerNoteRecord): Promise<string | null> {
		try {
			const documentId = await this.ensureDocument();
			if (!documentId) return null;

			const stamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
			const target = note.target?.displayName || note.target?.username || note.target?.id;
			const author = note.author?.displayName || note.author?.username || "inconnu";
			const tournament = note.tournament ? ` · ${note.tournament.name}` : "";

			const entry =
				`${stamp} — ${SEVERITY_LABELS[note.severity]} · ${CATEGORY_LABELS[note.category]}${tournament}\n` +
				`Joueur : ${target} (${note.target?.id})\n` +
				`Signalé par : ${author}\n` +
				`${note.content}\n\n`;

			const ok = await this.google.prependText(documentId, entry);

			return ok ? this.google.documentUrl(documentId) : null;
		} catch (error) {
			console.warn("[PlayerNoteDocsSync] signalement non consigné :", (error as Error)?.message);
			return null;
		}
	}

	/** Consigne le traitement d'un signalement (ligne de suivi, pas de réécriture). */
	async appendResolution(note: PlayerNoteRecord, resolved: boolean): Promise<void> {
		try {
			const documentId = await this.ensureDocument();
			if (!documentId) return;

			const stamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
			const actor = note.resolvedBy?.displayName || note.resolvedBy?.username || "staff";
			const target = note.target?.displayName || note.target?.username || note.target?.id;
			const verb = resolved ? "traité" : "rouvert";

			await this.google.prependText(
				documentId,
				`${stamp} — Signalement ${verb} par ${actor} (joueur : ${target})\n\n`
			);
		} catch (error) {
			console.warn("[PlayerNoteDocsSync] suivi non consigné :", (error as Error)?.message);
		}
	}
}
