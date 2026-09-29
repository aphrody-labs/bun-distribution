"use client";

/**
 * Bouton flottant « Signaler une erreur » présent sur toutes les pages publiques
 * (îlot client → n'introduit aucune session côté serveur, cache préservé). Ouvre
 * une modale de signalement réservée aux membres **connectés** (compte Discord
 * lié) ; un anonyme est invité à se connecter. Chaque envoi crée un ticket
 * (`POST /api/reports`) visible dans /admin/signalements.
 *
 * Masqué sur le back-office (/admin) : l'équipe n'a pas à se signaler à elle-même.
 */
import { Chargement, CocheCercle, Croix, Drapeau } from "@/components/icones";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SignInDiscord } from "@/components/SignInDiscord";
import { REPORT_CATEGORIES, REPORT_MESSAGE_MAX } from "@/lib/report-types";
import { useMe } from "@/lib/use-me";
import { PlainField } from "@/components/editor/PlainField";

type Phase = "idle" | "sending" | "done" | "error";

export function ReportButton() {
	const pathname = usePathname();
	const me = useMe();
	const idCategorie = useId();
	const idMessage = useId();
	const [open, setOpen] = useState(false);
	const [category, setCategory] = useState<string>(REPORT_CATEGORIES[0].key);
	const [message, setMessage] = useState("");
	const [phase, setPhase] = useState<Phase>("idle");
	const [err, setErr] = useState<string | null>(null);
	const boutonRef = useRef<HTMLButtonElement>(null);
	const panneau = useRef<HTMLDivElement>(null);
	/** Fermeture automatique après un envoi réussi. */
	const cloture = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fermer = useCallback(() => {
		if (cloture.current) {
			clearTimeout(cloture.current);
			cloture.current = null;
		}
		setOpen(false);
		// Le focus revient sur la pastille qui a ouvert la modale : sans ce
		// retour, il retombe sur `<body>` avec la boîte qu'on vient de démonter,
		// et la tabulation repart du haut de la page.
		boutonRef.current?.focus();
	}, []);

	// Clavier : Échap referme, et Tab reste ENFERMÉ dans la boîte. Elle
	// s'annonce `aria-modal` alors que la tabulation en sortait librement vers
	// la page recouverte — un formulaire modal qu'on quitte sans le voir.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				fermer();
				return;
			}
			if (e.key !== "Tab" || !panneau.current) return;
			// La boîte ne rend que les contrôles de la phase courante : ce qui n'est
			// pas visible n'est pas dans le DOM, aucun filtre supplémentaire à faire.
			const cibles = panneau.current.querySelectorAll<HTMLElement>(
				"a[href], button:not([disabled]), select, textarea, input:not([type='hidden'])"
			);
			if (cibles.length === 0) return;
			const premier = cibles[0]!;
			const dernier = cibles[cibles.length - 1]!;
			if (e.shiftKey && document.activeElement === premier) {
				e.preventDefault();
				dernier.focus();
			} else if (!e.shiftKey && document.activeElement === dernier) {
				e.preventDefault();
				premier.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, fermer]);

	// Focus initial DANS la boîte à l'ouverture : sinon il reste sur la pastille,
	// derrière le voile, et le lecteur d'écran n'entre jamais dans le formulaire.
	useEffect(() => {
		if (!open) return;
		panneau.current?.querySelector<HTMLElement>("select, a[href], button")?.focus();
	}, [open]);

	// Le compte à rebours de fermeture automatique survivait au démontage : il
	// se déclenchait ensuite dans le vide, sur des références déjà nulles.
	useEffect(
		() => () => {
			if (cloture.current) clearTimeout(cloture.current);
		},
		[]
	);

	// Ne s'affiche pas dans le back-office admin.
	if (pathname?.startsWith("/admin")) return null;

	async function submit() {
		if (phase === "sending") return;
		if (message.trim().length < 5) {
			setErr("Décris un peu plus le problème (5 caractères min).");
			return;
		}
		setPhase("sending");
		setErr(null);
		try {
			const res = await fetch("/api/reports", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({
					path: pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/"),
					pageTitle: typeof document !== "undefined" ? document.title : null,
					category,
					message: message.trim(),
				}),
			});
			if (res.status === 401) {
				setPhase("error");
				setErr("Connecte-toi avec Discord pour envoyer un signalement.");
				return;
			}
			if (res.status === 429) {
				setPhase("error");
				setErr("Trop de signalements d'affilée. Réessaie dans quelques minutes.");
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setPhase("done");
			setMessage("");
			cloture.current = setTimeout(() => {
				cloture.current = null;
				setPhase("idle");
				// `fermer()` et non `setOpen(false)` : la boîte se referme toute
				// seule alors que le focus est DEDANS (sur le bouton d'envoi). Sans
				// le retour sur la pastille, il partait sur `<body>`.
				fermer();
			}, 1800);
		} catch {
			setPhase("error");
			setErr("Échec de l'envoi. Réessaie dans un instant.");
		}
	}

	return (
		<>
			{/* Bouton flottant */}
			<button
				ref={boutonRef}
				type="button"
				onClick={() => {
					setOpen(true);
					setPhase("idle");
					setErr(null);
				}}
				aria-expanded={open}
				aria-label="Signaler une erreur"
				// Pastille discrète, plus la barre orange à libellé : trois éléments
				// flottants (signalement, invitation Discord, assistant) se
				// disputaient le bas de l'écran sur toutes les pages. Le libellé
				// n'apparaît qu'au survol ; l'intitulé reste accessible par
				// `aria-label` et par le `title`.
				// `min-h-11 min-w-11` : 44 px de cible tactile. En `p-2.5` seul, le bouton
				// replié tombait à 46×42 — le doigt le rate une fois sur trois au coin de
				// l'écran, là où la prise est la moins sûre.
				className="group fab-secondary fixed bottom-4 left-4 z-40 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-white/12 bg-[rgba(10,10,10,0.8)] p-2.5 text-white/55 shadow-lg backdrop-blur-md transition-all hover:border-dbz-orange/50 hover:text-dbz-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60 md:bottom-6 md:left-6"
				title="Signaler une erreur"
			>
				<Drapeau className="h-4 w-4" />
				<span className="max-w-0 overflow-hidden whitespace-nowrap text-[13px] font-display font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:pr-1 group-hover:opacity-100 group-focus-visible:max-w-[10rem] group-focus-visible:opacity-100">
					Signaler une erreur
				</span>
			</button>

			{open && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Signaler une erreur"
					className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) fermer();
					}}
				>
					<div
						ref={panneau}
						className="w-full max-w-md overflow-hidden rounded-xl border border-dbz-orange/25 bg-dbz-card shadow-2xl"
					>
						{/* En-tête */}
						<div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
							<h2 className="flex items-center gap-2 font-saiyan text-lg uppercase tracking-widest text-dbz-orange">
								<Drapeau className="h-4 w-4" /> Signaler une erreur
							</h2>
							<button
								type="button"
								onClick={fermer}
								aria-label="Fermer"
								className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
							>
								<Croix className="h-4 w-4" />
							</button>
						</div>

						<div className="space-y-4 p-5">
							{phase === "done" ? (
								<div className="flex flex-col items-center gap-3 py-6 text-center">
									<CocheCercle className="h-10 w-10 text-green-400" />
									<p className="font-display text-base font-semibold text-white">
										Merci, c&apos;est envoyé !
									</p>
									<p className="text-sm text-white/50">
										L&apos;équipe verra ton signalement dans son tableau de bord.
									</p>
								</div>
							) : me && !me.authenticated ? (
								// Anonyme → invitation à se connecter.
								<div className="space-y-4 py-2 text-center">
									<p className="text-sm text-white/70">
										Connecte-toi avec Discord pour nous envoyer un signalement (on pourra te
										répondre et te tenir au courant).
									</p>
									<SignInDiscord className="inline-flex h-11 items-center justify-center rounded-full bg-dbz-orange px-6 font-display font-bold text-black transition-colors hover:bg-white">
										Se connecter avec Discord
									</SignInDiscord>
								</div>
							) : (
								<>
									<p className="text-xs text-white/50">
										Page concernée : <span className="font-mono text-white/70">{pathname}</span>
									</p>

									<div>
										<label
											htmlFor={idCategorie}
											className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-dbz-blue-light"
										>
											Type de problème
										</label>
										<select
											id={idCategorie}
											className="input w-full text-sm"
											value={category}
											onChange={(e) => setCategory(e.target.value)}
										>
											{REPORT_CATEGORIES.map((c) => (
												<option key={c.key} value={c.key}>
													{c.label}
												</option>
											))}
										</select>
									</div>

									<div>
										<label
											htmlFor={idMessage}
											className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-dbz-blue-light"
										>
											Décris le problème
										</label>
										<PlainField
											id={idMessage}
											value={message}
											onChange={setMessage}
											minRows={4}
											maxRows={10}
											maxLength={REPORT_MESSAGE_MAX}
											placeholder="Ex : l'image de Goku ne se charge pas, le lien vers la saga X est cassé, une info est fausse…"
										/>
									</div>

									{/* `role="alert"` : ce message apparaît APRÈS coup, en réponse à
									    un envoi. Sans région live, un utilisateur de lecteur d'écran
									    appuyait sur « Envoyer », n'entendait rien, et n'avait aucune
									    raison d'aller relire le formulaire pour découvrir « Trop de
									    signalements d'affilée » ou « Connecte-toi avec Discord ». */}
									{err && (
										<p role="alert" className="text-sm text-dbz-red">
											{err}
										</p>
									)}

									<button
										type="button"
										onClick={submit}
										disabled={phase === "sending"}
										className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-dbz-orange px-5 py-3 font-display font-bold text-black transition-colors hover:bg-white disabled:opacity-60"
									>
										{phase === "sending" ? (
											<>
												<Chargement className="h-4 w-4 animate-spin" /> Envoi…
											</>
										) : (
											"Envoyer le signalement"
										)}
									</button>
								</>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
