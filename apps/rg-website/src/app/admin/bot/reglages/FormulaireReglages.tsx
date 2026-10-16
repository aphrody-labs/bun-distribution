"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Save } from "lucide-react";

import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	Label,
	MultiSelect,
	NativeSelect,
	NativeSelectOption,
	Switch,
	Textarea,
} from "@rosegriffon/ui";
import {
	LIBELLES_LIEU_ANNONCE,
	LIBELLES_LIEU_BIENVENUE,
	LIBELLES_SECTIONS,
	LIEUX_ANNONCE,
	LIEUX_BIENVENUE,
	manquesParSection,
	type ModificationReglages,
	type ReglagesCommunaute,
	type SectionReglages,
} from "@rosegriffon/types/bot";

import type { RoleGuilde, SalonGuilde } from "@/lib/bot/serveur";

interface Props {
	guildId: string;
	initiaux: ReglagesCommunaute;
	salons: SalonGuilde[];
	roles: RoleGuilde[];
	/** Renseigné quand aucun bot n'a pu fournir l'annuaire. */
	erreurAnnuaire: string | null;
	/** Le rôle `admin` seul peut rétablir les défauts (c'est une suppression). */
	peutReinitialiser: boolean;
}

type EtatSection = { statut: "repos" | "envoi" | "ok" | "erreur"; message: string | null };

const REPOS: EtatSection = { statut: "repos", message: null };

/**
 * Formulaire des réglages de communauté.
 *
 * ── UN ENREGISTREMENT PAR SECTION, ET C'EST DÉLIBÉRÉ ───────────────────────
 * Un seul bouton « enregistrer » en bas de page enverrait le document ENTIER.
 * Or ces réglages ont deux écrivains : le staff peut très bien déplacer le
 * salon de tickets depuis Discord pendant que cette page est ouverte. Un envoi
 * global réécrirait alors sa modification avec la valeur lue à l'ouverture,
 * sans que personne ne s'en aperçoive.
 *
 * Chaque section envoie donc un `PATCH` qui ne porte QUE sa propre section, et
 * le serveur fusionne. On ne peut pas écraser ce qu'on n'a pas touché.
 */
export function FormulaireReglages({
	guildId,
	initiaux,
	salons,
	roles,
	erreurAnnuaire,
	peutReinitialiser,
}: Props) {
	const [reglages, setReglages] = useState<ReglagesCommunaute>(initiaux);
	const [etats, setEtats] = useState<Record<string, EtatSection>>({});
	const [reinitialisation, demarrerReinitialisation] = useTransition();

	const manques = useMemo(() => manquesParSection(reglages), [reglages]);

	const optionsSalons = useMemo(
		() => salons.filter((s) => !s.categorie).map((s) => ({ label: `#${s.nom}`, value: s.id })),
		[salons]
	);
	const optionsCategories = useMemo(
		() => salons.filter((s) => s.categorie).map((s) => ({ label: s.nom, value: s.id })),
		[salons]
	);
	const optionsRoles = useMemo(
		() => roles.map((r) => ({ label: `@${r.nom}`, value: r.id })),
		[roles]
	);

	const enregistrer = useCallback(
		async (section: SectionReglages, patch: ModificationReglages) => {
			setEtats((etat) => ({ ...etat, [section]: { statut: "envoi", message: null } }));
			try {
				const reponse = await fetch(
					`/api/admin/bot/reglages?guild=${encodeURIComponent(guildId)}`,
					{
						method: "PATCH",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch),
					}
				);
				const charge = (await reponse.json()) as {
					reglages?: ReglagesCommunaute;
					error?: string;
					details?: { champ: string; message: string }[];
					profilsPrevenus?: string[];
				};
				if (!reponse.ok) {
					const detail = charge.details?.map((d) => `${d.champ} : ${d.message}`).join(" · ");
					throw new Error(detail || charge.error || `HTTP ${reponse.status}`);
				}
				if (charge.reglages) {
					setReglages(charge.reglages);
				}
				const prevenus = charge.profilsPrevenus ?? [];
				setEtats((etat) => ({
					...etat,
					[section]: {
						statut: "ok",
						message:
							prevenus.length === 2
								? "Enregistré, les deux bots ont rechargé."
								: prevenus.length === 1
									? `Enregistré. Un seul bot a rechargé (${prevenus[0]}) — l'autre était arrêté, il lira la nouvelle valeur à son démarrage.`
									: "Enregistré en base. Aucun bot n'a pu être prévenu : ils liront la nouvelle valeur d'ici une minute.",
					},
				}));
			} catch (erreur) {
				setEtats((etat) => ({
					...etat,
					[section]: {
						statut: "erreur",
						message: erreur instanceof Error ? erreur.message : String(erreur),
					},
				}));
			}
		},
		[guildId]
	);

	const reinitialiser = useCallback(() => {
		demarrerReinitialisation(async () => {
			const reponse = await fetch(`/api/admin/bot/reglages?guild=${encodeURIComponent(guildId)}`, {
				method: "DELETE",
			});
			if (reponse.ok) {
				const charge = (await reponse.json()) as { reglages: ReglagesCommunaute };
				setReglages(charge.reglages);
				setEtats({});
			}
		});
	}, [guildId]);

	return (
		<div className="space-y-6">
			{erreurAnnuaire && (
				<Card className="border-alerte/40 bg-alerte/5">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<AlertTriangle className="size-4 text-alerte" aria-hidden />
							Annuaire indisponible
						</CardTitle>
						<CardDescription>
							Aucun bot n&apos;a pu fournir la liste des salons et des rôles ({erreurAnnuaire}).
							Les sélecteurs sont vides : démarre un des deux services plutôt que de saisir des
							identifiants à la main — un flocon de dix-huit chiffres ne se relit pas.
						</CardDescription>
					</CardHeader>
				</Card>
			)}

			{/* ── Niveaux ──────────────────────────────────────────────────────── */}
			<SectionCarte
				section="niveaux"
				manques={manques.niveaux}
				etat={etats.niveaux ?? REPOS}
				onEnregistrer={() =>
					enregistrer("niveaux", {
						niveaux: {
							actif: reglages.niveaux.actif,
							annonce: reglages.niveaux.annonce,
							salonAnnonce: reglages.niveaux.salonAnnonce,
							palierAnnonce: reglages.niveaux.palierAnnonce,
							annoncerRang: reglages.niveaux.annoncerRang,
							salonsExclus: reglages.niveaux.salonsExclus,
							rolesExclus: reglages.niveaux.rolesExclus,
							gain: reglages.niveaux.gain,
						},
					})
				}
			>
				<Interrupteur
					id="niveaux-actif"
					libelle="Système de niveaux actif"
					aide="Coupé, aucun message ne rapporte d'expérience."
					valeur={reglages.niveaux.actif}
					onChange={(actif) =>
						setReglages((r) => ({ ...r, niveaux: { ...r.niveaux, actif } }))
					}
				/>

				<div className="grid gap-4 sm:grid-cols-2">
					<Champ
						id="niveaux-annonce"
						libelle="Annonce des montées de niveau"
						aide="« Aucune » est le défaut : sur deux mille membres, annoncer dans le salon du message rend chaque salon illisible."
					>
						<NativeSelect
							id="niveaux-annonce"
							className="w-full"
							value={reglages.niveaux.annonce}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									niveaux: {
										...r.niveaux,
										annonce: evenement.target.value as (typeof LIEUX_ANNONCE)[number],
									},
								}))
							}
						>
							{LIEUX_ANNONCE.map((lieu) => (
								<NativeSelectOption key={lieu} value={lieu}>
									{LIBELLES_LIEU_ANNONCE[lieu]}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Champ>

					{reglages.niveaux.annonce === "salon" && (
						<Champ id="niveaux-salon" libelle="Salon d'annonce">
							<SelecteurSalon
								id="niveaux-salon"
								options={optionsSalons}
								valeur={reglages.niveaux.salonAnnonce}
								onChange={(salonAnnonce) =>
									setReglages((r) => ({ ...r, niveaux: { ...r.niveaux, salonAnnonce } }))
								}
							/>
						</Champ>
					)}

					<Champ
						id="niveaux-palier"
						libelle="N'annoncer que les niveaux multiples de"
						aide="À 5, on ne fête que les paliers ronds. 1 rétablit l'annonce à chaque niveau."
					>
						<Input
							id="niveaux-palier"
							type="number"
							min={1}
							max={100}
							value={reglages.niveaux.palierAnnonce}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									niveaux: {
										...r.niveaux,
										palierAnnonce: Number(evenement.target.value) || 1,
									},
								}))
							}
						/>
					</Champ>
				</div>

				<Interrupteur
					id="niveaux-rang"
					libelle="Annoncer aussi les changements de rang"
					aide="Normal → Expérimenté → Héros → BASARA : trois fois dans une vie de membre."
					valeur={reglages.niveaux.annoncerRang}
					onChange={(annoncerRang) =>
						setReglages((r) => ({ ...r, niveaux: { ...r.niveaux, annoncerRang } }))
					}
				/>

				<div className="grid gap-4 sm:grid-cols-3">
					<Champ id="gain-min" libelle="Gain minimum par message">
						<Input
							id="gain-min"
							type="number"
							min={0}
							max={1000}
							value={reglages.niveaux.gain.minimum}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									niveaux: {
										...r.niveaux,
										gain: { ...r.niveaux.gain, minimum: Number(evenement.target.value) || 0 },
									},
								}))
							}
						/>
					</Champ>
					<Champ id="gain-max" libelle="Gain maximum par message">
						<Input
							id="gain-max"
							type="number"
							min={0}
							max={1000}
							value={reglages.niveaux.gain.maximum}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									niveaux: {
										...r.niveaux,
										gain: { ...r.niveaux.gain, maximum: Number(evenement.target.value) || 0 },
									},
								}))
							}
						/>
					</Champ>
					<Champ
						id="gain-delai"
						libelle="Délai anti-spam (secondes)"
						aide="Sans lui, quinze messages d'un mot rapportent quinze fois plus qu'un vrai échange."
					>
						<Input
							id="gain-delai"
							type="number"
							min={0}
							max={3600}
							value={reglages.niveaux.gain.delaiSecondes}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									niveaux: {
										...r.niveaux,
										gain: {
											...r.niveaux.gain,
											delaiSecondes: Number(evenement.target.value) || 0,
										},
									},
								}))
							}
						/>
					</Champ>
				</div>

				<Champ
					id="niveaux-salons-exclus"
					libelle="Salons qui ne rapportent aucune expérience"
					aide="Journaux, vitrines, salons de bots."
				>
					<MultiSelect
						options={optionsSalons}
						selected={reglages.niveaux.salonsExclus}
						onChange={(salonsExclus) =>
							setReglages((r) => ({ ...r, niveaux: { ...r.niveaux, salonsExclus } }))
						}
						placeholder="Aucun salon exclu"
					/>
				</Champ>

				<Champ id="niveaux-roles-exclus" libelle="Rôles qui ne gagnent pas d'expérience">
					<MultiSelect
						options={optionsRoles}
						selected={reglages.niveaux.rolesExclus}
						onChange={(rolesExclus) =>
							setReglages((r) => ({ ...r, niveaux: { ...r.niveaux, rolesExclus } }))
						}
						placeholder="Aucun rôle exclu"
					/>
				</Champ>
			</SectionCarte>

			{/* ── Tickets ──────────────────────────────────────────────────────── */}
			<SectionCarte
				section="tickets"
				manques={manques.tickets}
				etat={etats.tickets ?? REPOS}
				onEnregistrer={() =>
					enregistrer("tickets", {
						tickets: {
							actif: reglages.tickets.actif,
							mode: reglages.tickets.mode,
							salonPanneau: reglages.tickets.salonPanneau,
							salonHistorique: reglages.tickets.salonHistorique,
							categorieSupport: reglages.tickets.categorieSupport,
							rolesStaff: reglages.tickets.rolesStaff,
							rolesDirection: reglages.tickets.rolesDirection,
						},
					})
				}
			>
				<Interrupteur
					id="tickets-actif"
					libelle="Tickets d'assistance actifs"
					valeur={reglages.tickets.actif}
					onChange={(actif) =>
						setReglages((r) => ({ ...r, tickets: { ...r.tickets, actif } }))
					}
				/>

				<div className="grid gap-4 sm:grid-cols-2">
					<Champ
						id="tickets-mode"
						libelle="Forme d'un ticket"
						aide="Un serveur est plafonné à 500 salons, jamais aux fils : « fil » est le défaut."
					>
						<NativeSelect
							id="tickets-mode"
							className="w-full"
							value={reglages.tickets.mode}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									tickets: { ...r.tickets, mode: evenement.target.value as "fil" | "salon" },
								}))
							}
						>
							<NativeSelectOption value="fil">Fil privé</NativeSelectOption>
							<NativeSelectOption value="salon">Salon dans une catégorie</NativeSelectOption>
						</NativeSelect>
					</Champ>

					<Champ id="tickets-panneau" libelle="Salon du panneau d'ouverture">
						<SelecteurSalon
							id="tickets-panneau"
							options={optionsSalons}
							valeur={reglages.tickets.salonPanneau}
							onChange={(salonPanneau) =>
								setReglages((r) => ({ ...r, tickets: { ...r.tickets, salonPanneau } }))
							}
						/>
					</Champ>

					<Champ id="tickets-historique" libelle="Salon d'historique des fermetures">
						<SelecteurSalon
							id="tickets-historique"
							options={optionsSalons}
							valeur={reglages.tickets.salonHistorique}
							onChange={(salonHistorique) =>
								setReglages((r) => ({ ...r, tickets: { ...r.tickets, salonHistorique } }))
							}
						/>
					</Champ>

					{reglages.tickets.mode === "salon" && (
						<Champ id="tickets-categorie" libelle="Catégorie Support">
							<SelecteurSalon
								id="tickets-categorie"
								options={optionsCategories}
								valeur={reglages.tickets.categorieSupport}
								onChange={(categorieSupport) =>
									setReglages((r) => ({ ...r, tickets: { ...r.tickets, categorieSupport } }))
								}
							/>
						</Champ>
					)}
				</div>

				<Champ
					id="tickets-staff"
					libelle="Rôles de prise en charge"
					aide="Ils voient les tickets ordinaires."
				>
					<MultiSelect
						options={optionsRoles}
						selected={reglages.tickets.rolesStaff}
						onChange={(rolesStaff) =>
							setReglages((r) => ({ ...r, tickets: { ...r.tickets, rolesStaff } }))
						}
						placeholder="Aucun rôle"
					/>
				</Champ>

				<Champ
					id="tickets-direction"
					libelle="Rôles de direction"
					aide="Ils voient EN PLUS les tickets sensibles (signalements)."
				>
					<MultiSelect
						options={optionsRoles}
						selected={reglages.tickets.rolesDirection}
						onChange={(rolesDirection) =>
							setReglages((r) => ({ ...r, tickets: { ...r.tickets, rolesDirection } }))
						}
						placeholder="Aucun rôle"
					/>
				</Champ>
			</SectionCarte>

			{/* ── Modération ───────────────────────────────────────────────────── */}
			<SectionCarte
				section="moderation"
				manques={manques.moderation}
				etat={etats.moderation ?? REPOS}
				onEnregistrer={() =>
					enregistrer("moderation", {
						moderation: {
							actif: reglages.moderation.actif,
							salonJournal: reglages.moderation.salonJournal,
						},
					})
				}
			>
				<Interrupteur
					id="moderation-actif"
					libelle="Publier les sanctions dans un salon"
					aide="Coupé, les sanctions restent consignées dans admin_audit_log — elles ne sont simplement plus publiées."
					valeur={reglages.moderation.actif}
					onChange={(actif) =>
						setReglages((r) => ({ ...r, moderation: { ...r.moderation, actif } }))
					}
				/>
				<Champ
					id="moderation-salon"
					libelle="Salon du journal de modération"
					aide="Avertissements, exclusions, expulsions et bannissements y paraissent au moment où ils sont pris. Réserve-le au staff : il nomme les membres sanctionnés et leurs motifs."
				>
					<SelecteurSalon
						id="moderation-salon"
						options={optionsSalons}
						valeur={reglages.moderation.salonJournal}
						onChange={(salonJournal) =>
							setReglages((r) => ({ ...r, moderation: { ...r.moderation, salonJournal } }))
						}
					/>
				</Champ>
			</SectionCarte>

			{/* ── Accueil ──────────────────────────────────────────────────────── */}
			<SectionCarte
				section="accueil"
				manques={manques.accueil}
				etat={etats.accueil ?? REPOS}
				onEnregistrer={() =>
					enregistrer("accueil", {
						accueil: {
							actif: reglages.accueil.actif,
							lieu: reglages.accueil.lieu,
							salon: reglages.accueil.salon,
							texte: reglages.accueil.texte,
							roleArrivee: reglages.accueil.roleArrivee,
							carte: reglages.accueil.carte,
						},
					})
				}
			>
				<Interrupteur
					id="accueil-actif"
					libelle="Message de bienvenue actif"
					valeur={reglages.accueil.actif}
					onChange={(actif) =>
						setReglages((r) => ({ ...r, accueil: { ...r.accueil, actif } }))
					}
				/>

				<div className="grid gap-4 sm:grid-cols-2">
					<Champ id="accueil-lieu" libelle="Où souhaiter la bienvenue">
						<NativeSelect
							id="accueil-lieu"
							className="w-full"
							value={reglages.accueil.lieu}
							onChange={(evenement) =>
								setReglages((r) => ({
									...r,
									accueil: {
										...r.accueil,
										lieu: evenement.target.value as (typeof LIEUX_BIENVENUE)[number],
									},
								}))
							}
						>
							{LIEUX_BIENVENUE.map((lieu) => (
								<NativeSelectOption key={lieu} value={lieu}>
									{LIBELLES_LIEU_BIENVENUE[lieu]}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Champ>

					{reglages.accueil.lieu === "salon" && (
						<Champ id="accueil-salon" libelle="Salon d'accueil">
							<SelecteurSalon
								id="accueil-salon"
								options={optionsSalons}
								valeur={reglages.accueil.salon}
								onChange={(salon) =>
									setReglages((r) => ({ ...r, accueil: { ...r.accueil, salon } }))
								}
							/>
						</Champ>
					)}

					<Champ
						id="accueil-role"
						libelle="Rôle posé à l'arrivée"
						aide="Distribué automatiquement à tout le monde : c'est la surface la plus large qui existe."
					>
						<SelecteurSalon
							id="accueil-role"
							options={optionsRoles}
							valeur={reglages.accueil.roleArrivee}
							onChange={(roleArrivee) =>
								setReglages((r) => ({ ...r, accueil: { ...r.accueil, roleArrivee } }))
							}
							videLibelle="Aucun rôle"
						/>
					</Champ>
				</div>

				<Champ
					id="accueil-texte"
					libelle="Texte du message"
					aide="{membre} → la mention, {serveur} → le nom du serveur, {compte} → le nombre de membres. Vide = le texte par défaut du bot."
				>
					<Textarea
						id="accueil-texte"
						rows={3}
						maxLength={1000}
						value={reglages.accueil.texte ?? ""}
						onChange={(evenement) =>
							setReglages((r) => ({
								...r,
								accueil: {
									...r.accueil,
									texte: evenement.target.value.trim() === "" ? null : evenement.target.value,
								},
							}))
						}
					/>
				</Champ>

				<Interrupteur
					id="accueil-carte"
					libelle="Joindre la carte image d'accueil"
					valeur={reglages.accueil.carte}
					onChange={(carte) => setReglages((r) => ({ ...r, accueil: { ...r.accueil, carte } }))}
				/>
			</SectionCarte>

			{/* ── Suggestions ──────────────────────────────────────────────────── */}
			<SectionCarte
				section="suggestions"
				manques={manques.suggestions}
				etat={etats.suggestions ?? REPOS}
				onEnregistrer={() =>
					enregistrer("suggestions", {
						suggestions: {
							actif: reglages.suggestions.actif,
							salon: reglages.suggestions.salon,
						},
					})
				}
			>
				<Interrupteur
					id="suggestions-actif"
					libelle="Boîte à suggestions ouverte"
					valeur={reglages.suggestions.actif}
					onChange={(actif) =>
						setReglages((r) => ({ ...r, suggestions: { ...r.suggestions, actif } }))
					}
				/>
				<Champ
					id="suggestions-salon"
					libelle="Salon de dépôt"
					aide="Sans salon, la boîte reste fermée : une commande publique qui publie ne s'ouvre pas toute seule."
				>
					<SelecteurSalon
						id="suggestions-salon"
						options={optionsSalons}
						valeur={reglages.suggestions.salon}
						onChange={(salon) =>
							setReglages((r) => ({ ...r, suggestions: { ...r.suggestions, salon } }))
						}
					/>
				</Champ>
			</SectionCarte>

			{/* ── Jetons Kizuna ────────────────────────────────────────────────── */}
			<SectionCarte
				section="kizuna"
				manques={manques.kizuna}
				etat={etats.kizuna ?? REPOS}
				onEnregistrer={() =>
					enregistrer("kizuna", {
						kizuna: {
							actif: reglages.kizuna.actif,
							salonAnnonce: reglages.kizuna.salonAnnonce,
						},
					})
				}
			>
				<Interrupteur
					id="kizuna-actif"
					libelle="Monnaie de communauté active"
					valeur={reglages.kizuna.actif}
					onChange={(actif) => setReglages((r) => ({ ...r, kizuna: { ...r.kizuna, actif } }))}
				/>
				<Champ
					id="kizuna-salon"
					libelle="Salon d'annonce des recrutements remarquables"
					aide="Facultatif : sans salon, les recrutements Héros et BASARA ne sont simplement pas annoncés."
				>
					<SelecteurSalon
						id="kizuna-salon"
						options={optionsSalons}
						valeur={reglages.kizuna.salonAnnonce}
						onChange={(salonAnnonce) =>
							setReglages((r) => ({ ...r, kizuna: { ...r.kizuna, salonAnnonce } }))
						}
					/>
				</Champ>
			</SectionCarte>

			{peutReinitialiser && (
				<Card className="border-destructive/40">
					<CardHeader>
						<CardTitle className="text-base">Rétablir les défauts</CardTitle>
						<CardDescription>
							Efface TOUS les réglages de ce serveur : salons, rôles de prise en charge,
							exclusions d&apos;expérience. Le bot repart de zéro et ne publie plus nulle part.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button variant="destructive" onClick={reinitialiser} disabled={reinitialisation}>
							{reinitialisation ? (
								<Loader2 className="size-4 animate-spin" aria-hidden />
							) : (
								<RotateCcw className="size-4" aria-hidden />
							)}
							Rétablir les défauts
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

// ─── Briques d'interface ────────────────────────────────────────────────────

function SectionCarte({
	section,
	manques,
	etat,
	onEnregistrer,
	children,
}: {
	section: SectionReglages;
	manques: string[];
	etat: EtatSection;
	onEnregistrer: () => void;
	children: React.ReactNode;
}) {
	const libelle = LIBELLES_SECTIONS[section];
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle className="flex items-center gap-2 text-base">
							{libelle.titre}
							{manques.length > 0 && (
								<Badge variant="outline" className="border-alerte/50 text-alerte">
									à configurer
								</Badge>
							)}
						</CardTitle>
						<CardDescription className="mt-1">{libelle.role}</CardDescription>
					</div>
					<Button size="sm" onClick={onEnregistrer} disabled={etat.statut === "envoi"}>
						{etat.statut === "envoi" ? (
							<Loader2 className="size-4 animate-spin" aria-hidden />
						) : etat.statut === "ok" ? (
							<Check className="size-4" aria-hidden />
						) : (
							<Save className="size-4" aria-hidden />
						)}
						Enregistrer
					</Button>
				</div>
				{manques.length > 0 && (
					<p className="mt-2 flex items-start gap-2 text-xs text-alerte">
						<AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
						Il manque {manques.join(", ")}.
					</p>
				)}
				{etat.message && (
					<p
						className={`mt-2 text-xs ${etat.statut === "erreur" ? "text-destructive" : "text-succes"}`}
					>
						{etat.message}
					</p>
				)}
			</CardHeader>
			<CardContent className="space-y-5">{children}</CardContent>
		</Card>
	);
}

function Champ({
	id,
	libelle,
	aide,
	children,
}: {
	id: string;
	libelle: string;
	aide?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{libelle}</Label>
			{children}
			{aide && <p className="text-xs text-muted-foreground">{aide}</p>}
		</div>
	);
}

function Interrupteur({
	id,
	libelle,
	aide,
	valeur,
	onChange,
}: {
	id: string;
	libelle: string;
	aide?: string;
	valeur: boolean;
	onChange: (valeur: boolean) => void;
}) {
	return (
		<div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
			<div className="min-w-0">
				<Label htmlFor={id} className="cursor-pointer">
					{libelle}
				</Label>
				{aide && <p className="mt-1 text-xs text-muted-foreground">{aide}</p>}
			</div>
			<Switch id={id} checked={valeur} onCheckedChange={onChange} />
		</div>
	);
}

/**
 * Sélecteur d'un salon ou d'un rôle, avec une option « aucun » explicite.
 *
 * La chaîne vide vaut `null` : sans cette traduction, désélectionner enverrait
 * `""`, que le schéma refuse (il attend un flocon ou `null`) — et le staff
 * lirait « identifiant Discord attendu » sur un champ qu'il vient justement de
 * vider.
 */
function SelecteurSalon({
	id,
	options,
	valeur,
	onChange,
	videLibelle = "Aucun",
}: {
	id: string;
	options: { label: string; value: string }[];
	valeur: string | null;
	onChange: (valeur: string | null) => void;
	videLibelle?: string;
}) {
	return (
		<NativeSelect
			id={id}
			className="w-full"
			value={valeur ?? ""}
			onChange={(evenement) => onChange(evenement.target.value === "" ? null : evenement.target.value)}
		>
			<NativeSelectOption value="">{videLibelle}</NativeSelectOption>
			{options.map((option) => (
				<NativeSelectOption key={option.value} value={option.value}>
					{option.label}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}
