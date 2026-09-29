import { Service } from "@/decorators";

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
/**
 * Scopes demandés au jeton. Les API correspondantes sont activées sur le projet
 * `rgfr-8927d` ; demander un scope dont l'API est désactivée ferait échouer l'échange
 * de jeton, donc cette liste et l'état du projet doivent rester alignés.
 */
const SCOPES = [
	"https://www.googleapis.com/auth/documents",
	"https://www.googleapis.com/auth/drive",
	"https://www.googleapis.com/auth/spreadsheets",
	"https://www.googleapis.com/auth/presentations",
	"https://www.googleapis.com/auth/forms.body",
].join(" ");

/**
 * Accès Google Docs / Drive avec un compte de service.
 *
 * Écrit à la main plutôt qu'avec `googleapis` : le SDK pèse plusieurs dizaines de Mio
 * pour deux appels REST, et le bot démarre déjà avec un arbre de dépendances copieux.
 * Ici, un JWT RS256 signé localement suffit à obtenir un jeton.
 *
 * Configuration (`apps/achillea-bot/.env`) :
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE  chemin du JSON de compte de service
 *   GOOGLE_SERVICE_ACCOUNT           …ou le JSON directement (prioritaire)
 *   GOOGLE_DRIVE_FOLDER_ID           dossier Drive où chercher les documents
 *
 * **Un compte de service ne peut pas créer de fichier dans un « Mon Drive »** : il n'a
 * pas de quota de stockage propre et Google répond `storageQuotaExceeded`. Il sait en
 * revanche écrire dans un document existant partagé avec lui. Les documents sont donc
 * créés une fois par un humain, puis retrouvés par nom (ou fixés par variable).
 *
 * Sans configuration, le service se déclare simplement indisponible : aucune
 * fonctionnalité du bot ne doit dépendre de la présence de ces secrets.
 */
@Service()
export class GoogleWorkspaceService {
	private cachedToken: { value: string; expiresAt: number } | null = null;

	get folderId(): string | null {
		return process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null;
	}

	/**
	 * Configuration présente ? Test volontairement sur les variables et non sur la
	 * lecture de la clé : `available` est consulté à chaud, il ne doit pas toucher au
	 * disque à chaque appel.
	 */
	get available(): boolean {
		return Boolean(
			process.env.GOOGLE_SERVICE_ACCOUNT?.trim() ||
			process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim()
		);
	}

	private async loadKey(): Promise<ServiceAccountKey | null> {
		try {
			const inline = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
			if (inline) return JSON.parse(inline) as ServiceAccountKey;

			const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();
			if (file) return (await Bun.file(file).json()) as ServiceAccountKey;
		} catch (error) {
			console.warn(
				"[GoogleWorkspace] clé de compte de service illisible :",
				(error as Error)?.message
			);
		}

		return null;
	}

	/** base64url d'une chaîne ou d'un buffer — sans `Buffer`, API Web uniquement. */
	private base64url(input: string | ArrayBuffer): string {
		const bytes =
			typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);

		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);

		return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	/** PEM PKCS#8 → ArrayBuffer, pour `crypto.subtle.importKey`. */
	private pemToBuffer(pem: string): ArrayBuffer {
		const body = pem
			.replace(/-----BEGIN [^-]+-----/g, "")
			.replace(/-----END [^-]+-----/g, "")
			.replace(/\s+/g, "");

		const binary = atob(body);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

		return bytes.buffer;
	}

	/** Jeton OAuth2, mis en cache jusqu'à une minute avant son expiration. */
	private async getAccessToken(): Promise<string | null> {
		if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
			return this.cachedToken.value;
		}

		const key = await this.loadKey();
		if (!key?.client_email || !key?.private_key) return null;

		const now = Math.floor(Date.now() / 1000);
		const header = { alg: "RS256", typ: "JWT" };
		const claims = {
			iss: key.client_email,
			scope: SCOPES,
			aud: TOKEN_URL,
			exp: now + 3600,
			iat: now,
		};

		const unsigned = `${this.base64url(JSON.stringify(header))}.${this.base64url(JSON.stringify(claims))}`;

		// WebCrypto : signature RS256 sans dépendre d'une API Node.
		const privateKey = await crypto.subtle.importKey(
			"pkcs8",
			this.pemToBuffer(key.private_key.replace(/\\n/g, "\n")),
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["sign"]
		);

		const signature = this.base64url(
			await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(unsigned))
		);

		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion: `${unsigned}.${signature}`,
			}),
		});

		if (!response.ok) {
			console.warn("[GoogleWorkspace] jeton refusé :", response.status, await response.text());
			return null;
		}

		const payload = (await response.json()) as { access_token: string; expires_in: number };
		this.cachedToken = {
			value: payload.access_token,
			expiresAt: Date.now() + payload.expires_in * 1000,
		};

		return payload.access_token;
	}

	private async call<T>(url: string, init: RequestInit = {}): Promise<T | null> {
		const token = await this.getAccessToken();
		if (!token) return null;

		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...init.headers,
			},
		});

		if (!response.ok) {
			console.warn(
				`[GoogleWorkspace] ${init.method ?? "GET"} ${url.split("?")[0]} → ${response.status}`,
				(await response.text()).slice(0, 300)
			);
			return null;
		}

		return (await response.json()) as T;
	}

	/** Cherche un document par nom dans le dossier configuré. */
	async findDocumentByName(name: string): Promise<string | null> {
		const folder = this.folderId;
		if (!folder) return null;

		const query = encodeURIComponent(
			`'${folder}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
		);
		const result = await this.call<{ files: Array<{ id: string }> }>(
			`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`
		);

		return result?.files?.[0]?.id ?? null;
	}

	/**
	 * Tente de créer un Google Doc dans le dossier configuré.
	 *
	 * Échoue par construction sur un « Mon Drive » (quota d'un compte de service) : le
	 * message d'erreur le dit alors explicitement, pour qu'on ne cherche pas un défaut
	 * de permission là où il n'y en a pas.
	 */
	async createDocument(name: string): Promise<string | null> {
		const folder = this.folderId;
		if (!folder) return null;

		const created = await this.call<{ id: string }>(
			"https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
			{
				method: "POST",
				body: JSON.stringify({
					name,
					mimeType: "application/vnd.google-apps.document",
					parents: [folder],
				}),
			}
		);

		if (!created?.id) {
			console.warn(
				`[GoogleWorkspace] création impossible de « ${name} ». Un compte de service n'a pas ` +
					"de quota Drive : crée le document à la main dans le dossier partagé (le nom doit " +
					"correspondre), ou renseigne son id dans GOOGLE_PLAYER_NOTES_DOC_ID."
			);
		}

		return created?.id ?? null;
	}

	/**
	 * Insère du texte au début du corps d'un document (index 1).
	 *
	 * Registre antichronologique : la dernière entrée est en haut, personne n'a à
	 * faire défiler pour voir ce qui vient d'arriver.
	 */
	async prependText(documentId: string, text: string): Promise<boolean> {
		const result = await this.call<unknown>(
			`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
			{
				method: "POST",
				body: JSON.stringify({
					requests: [{ insertText: { location: { index: 1 }, text } }],
				}),
			}
		);

		return result !== null;
	}

	/** URL publique d'un document (pour la renvoyer dans une réponse Discord). */
	documentUrl(documentId: string): string {
		return `https://docs.google.com/document/d/${documentId}/edit`;
	}
}
