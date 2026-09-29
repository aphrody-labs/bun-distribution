"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
	Download,
	ExternalLink,
	Laptop,
	LoaderCircle,
	LogOut,
	ShieldCheck,
	Trash2,
	X,
} from "lucide-react";
import { SignOut } from "@/components/SignOut";
import { useT } from "@/components/T";
import { authClient } from "@/lib/auth-client";

type Props = { initial: { name: string; image: string; discordId: string } };

/**
 * Retour d'action. Le drapeau `erreur` sert à deux choses : annoncer l'échec en
 * `role="alert"` (un `role="status"` est poli et pouvait passer inaperçu) et le
 * peindre en rouge — jusqu'ici un échec s'affichait dans le même bandeau orange
 * qu'une réussite, donc indiscernable d'un « Profil enregistré ».
 */
type Avis = { texte: string; erreur: boolean };

type AccountSession = {
	id: string;
	token: string;
	createdAt: Date | string;
	updatedAt: Date | string;
	expiresAt: Date | string;
	ipAddress?: string | null;
	userAgent?: string | null;
};

const sessionDate = new Intl.DateTimeFormat("fr-FR", {
	dateStyle: "medium",
	timeStyle: "short",
});

function describeDevice(userAgent: string | null | undefined, inconnu: string) {
	if (!userAgent) return inconnu;
	const os = /Android/i.test(userAgent)
		? "Android"
		: /iPhone|iPad|iPod/i.test(userAgent)
			? "iOS"
			: /Windows/i.test(userAgent)
				? "Windows"
				: /Mac OS X|Macintosh/i.test(userAgent)
					? "macOS"
					: /Linux/i.test(userAgent)
						? "Linux"
						: inconnu;
	const browser = /Edg\//i.test(userAgent)
		? "Edge"
		: /Firefox\//i.test(userAgent)
			? "Firefox"
			: /Chrome\//i.test(userAgent)
				? "Chrome"
				: /Safari\//i.test(userAgent)
					? "Safari"
					: null;
	return browser ? `${browser} · ${os}` : os;
}

export default function AccountSettings({ initial }: Props) {
	const router = useRouter();
	const deletionDialog = useRef<HTMLDialogElement>(null);
	const [name, setName] = useState(initial.name);
	const [image, setImage] = useState(initial.image);
	const t = useT();
	const appareil = (ua: string | null | undefined) => describeDevice(ua, t("settings.unknownDevice"));
	const [avis, setAvis] = useState<Avis | null>(null);
	const [busy, setBusy] = useState(false);
	const confirmer = (texte: string) => setAvis({ texte, erreur: false });
	const avertir = (texte: string) => setAvis({ texte, erreur: true });
	const [sessions, setSessions] = useState<AccountSession[] | null>(null);
	const [currentToken, setCurrentToken] = useState<string | null>(null);
	const [sessionsError, setSessionsError] = useState(false);
	const [revokingToken, setRevokingToken] = useState<string | null>(null);

	const loadSessions = useCallback(async () => {
		setSessionsError(false);
		const [sessionsResult, currentResult] = await Promise.all([
			authClient.listSessions(),
			authClient.getSession(),
		]);
		if (sessionsResult.error) {
			setSessionsError(true);
			setSessions([]);
			return;
		}
		setSessions(sessionsResult.data ?? []);
		setCurrentToken(currentResult.data?.session.token ?? null);
	}, []);

	useEffect(() => {
		void loadSessions();
	}, [loadSessions]);

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const avatar = image.trim();
		if (avatar) {
			try {
				if (new URL(avatar).protocol !== "https:") throw new Error("not https");
			} catch {
				avertir(t("settings.noticeAvatarUrl"));
				return;
			}
		}
		setBusy(true);
		setAvis(null);
		const result = await authClient.updateUser({
			name: name.trim(),
			// `undefined` signifiait « ne touche pas au champ » : vider la case
			// n'effaçait donc jamais l'avatar, alors que le message annonçait
			// « Profil enregistré ». `null` est la valeur d'effacement admise par
			// Better Auth (`image` y est déclaré nullable).
			image: avatar || null,
		});
		setBusy(false);
		if (result.error) avertir(t("settings.noticeSaveFailed"));
		else {
			confirmer(t("settings.noticeSaved"));
			router.refresh();
		}
	}

	async function revokeOthers() {
		setBusy(true);
		setAvis(null);
		const result = await authClient.revokeOtherSessions();
		setBusy(false);
		if (result.error) {
			avertir(t("settings.noticeCloseOthersFailed"));
			return;
		}
		confirmer(t("settings.noticeClosedOthers"));
		await loadSessions();
	}

	async function revokeOne(token: string) {
		setRevokingToken(token);
		setAvis(null);
		const result = await authClient.revokeSession({ token });
		setRevokingToken(null);
		if (result.error) {
			avertir(t("settings.noticeCloseFailed"));
			return;
		}
		setSessions((current) => current?.filter((session) => session.token !== token) ?? []);
		confirmer(t("settings.noticeClosed"));
	}

	async function deleteAccount() {
		setBusy(true);
		setAvis(null);
		const result = await authClient.deleteUser({ callbackURL: "/" });
		setBusy(false);
		if (result.error) {
			deletionDialog.current?.close();
			avertir(t("settings.noticeDeleteFailed"));
			return;
		}
		router.replace("/");
		router.refresh();
	}

	return (
		<div>
			<header className="mb-8">
				<p className="text-sm font-semibold text-dbz-orange">{t("settings.eyebrow")}</p>
				<h1 className="mt-2 font-saiyan text-5xl leading-none md:text-6xl">{t("settings.title")}</h1>
				<p className="mt-3 max-w-2xl text-white/55">{t("settings.lead")}</p>
			</header>
			{avis && (
				<p
					role={avis.erreur ? "alert" : "status"}
					className={`mb-5 rounded-xl border p-4 text-sm text-white ${
						avis.erreur
							? "border-red-400/40 bg-red-500/10"
							: "border-dbz-orange/40 bg-dbz-orange/10"
					}`}
				>
					{avis.texte}
				</p>
			)}
			<div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
				<section className="rounded-2xl border border-white/10 bg-[#171512] p-5 md:p-7">
					<h2 className="text-lg font-semibold">{t("settings.identityTitle")}</h2>
					<p className="mt-1 text-sm text-white/45">{t("settings.identityLead")}</p>
					<form onSubmit={save} className="mt-6 space-y-5">
						<label className="block text-sm font-medium text-white/75">
							{t("settings.nickname")}
							<input
								autoComplete="nickname"
								required
								minLength={2}
								maxLength={48}
								value={name}
								onChange={(event) => setName(event.target.value)}
								className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-white outline-none focus:border-dbz-orange focus:ring-2 focus:ring-dbz-orange/20"
							/>
						</label>
						<label className="block text-sm font-medium text-white/75">
							{t("settings.avatarUrl")}
							<input
								type="url"
								inputMode="url"
								autoComplete="url"
								maxLength={500}
								value={image}
								onChange={(event) => setImage(event.target.value)}
								placeholder="https://…"
								className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-white outline-none focus:border-dbz-orange focus:ring-2 focus:ring-dbz-orange/20"
							/>
						</label>
						<p className="text-xs text-white/35">
							{t("settings.discordId", { id: initial.discordId })}
						</p>
						<button
							disabled={busy || name.trim().length < 2}
							className="min-h-11 rounded-full bg-dbz-orange px-5 text-sm font-bold text-black hover:bg-yellow-300 disabled:opacity-50"
						>
							{busy ? t("settings.saving") : t("settings.save")}
						</button>
					</form>
				</section>
				<div className="space-y-5">
					<section className="rounded-2xl border border-white/10 bg-[#171512] p-5">
						<ShieldCheck className="h-5 w-5 text-dbz-orange" aria-hidden />
						<h2 className="mt-4 font-semibold">{t("settings.sessionsTitle")}</h2>
						<p className="mt-1 text-sm text-white/45">{t("settings.sessionsLead")}</p>
						{sessions === null ? (
							<div className="mt-5 flex items-center gap-2 text-sm text-white/45" role="status">
								<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
								{t("settings.sessionsLoading")}
							</div>
						) : sessionsError ? (
							<div className="mt-5 rounded-xl border border-red-400/20 bg-red-500/5 p-3">
								<p className="text-sm text-red-100/70">{t("settings.sessionsError")}</p>
								<button
									type="button"
									onClick={() => void loadSessions()}
									className="mt-2 text-xs font-semibold text-dbz-orange hover:text-yellow-200"
								>
									{t("settings.retry")}
								</button>
							</div>
						) : (
							<>
								{sessions.length === 0 && (
									<p className="mt-5 text-sm text-white/45">{t("settings.sessionsEmpty")}</p>
								)}
								<ul className="mt-5 space-y-2">
									{sessions.map((session) => {
										const isCurrent = session.token === currentToken;
										return (
											<li
												key={session.id}
												className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"
											>
												<Laptop className="mt-0.5 h-4 w-4 shrink-0 text-white/45" aria-hidden />
												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center gap-2">
														<p className="text-sm font-medium text-white/80">
															{appareil(session.userAgent)}
														</p>
														{isCurrent && (
															<span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
																{t("settings.currentSession")}
															</span>
														)}
													</div>
													<p className="mt-1 truncate text-xs text-white/35">
														{session.ipAddress || t("settings.unknownIp")}{" "}
														{t("settings.lastActivity", {
															date: sessionDate.format(new Date(session.updatedAt)),
														})}
													</p>
												</div>
												{!isCurrent && (
													<button
														type="button"
														onClick={() => void revokeOne(session.token)}
														disabled={revokingToken !== null || busy}
														aria-label={t("settings.closeSession", { device: appareil(session.userAgent) })}
														// 28 px au dessin : `.cible-44` porte la zone tactile à 44 px
														// sans grossir la croix ni décaler la ligne.
														className="cible-44 rounded-lg p-1.5 text-white/35 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40"
													>
														{revokingToken === session.token ? (
															<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
														) : (
															<X className="h-4 w-4" aria-hidden />
														)}
													</button>
												)}
											</li>
										);
									})}
								</ul>
							</>
						)}
						<button
							type="button"
							onClick={revokeOthers}
							disabled={busy || revokingToken !== null || (sessions?.length ?? 0) < 2}
							className="mt-5 min-h-11 w-full rounded-xl border border-white/15 px-4 text-sm font-semibold text-white/70 hover:border-dbz-orange hover:text-white disabled:opacity-50"
						>
							{t("settings.closeOthers")}
						</button>
					</section>
					<section className="rounded-2xl border border-white/10 bg-[#171512] p-5">
						<Download className="h-5 w-5 text-dbz-blue-light" aria-hidden />
						<h2 className="mt-4 font-semibold">{t("settings.dataTitle")}</h2>
						<p className="mt-1 text-sm text-white/45">{t("settings.dataLead")}</p>
						<a
							href="/api/account/export"
							download
							className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-white/70 hover:border-dbz-blue-light hover:text-white"
						>
							{t("settings.download")} <Download className="h-4 w-4" />
						</a>
					</section>
				</div>
			</div>
			<section className="mt-5 rounded-2xl border border-red-400/20 bg-red-950/10 p-5 md:p-7">
				<h2 className="font-semibold text-red-200">{t("settings.deleteTitle")}</h2>
				<p className="mt-1 max-w-2xl text-sm text-white/45">{t("settings.deleteLead")}</p>
				<button
					type="button"
					onClick={() => deletionDialog.current?.showModal()}
					disabled={busy}
					className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-red-400/40 px-5 text-sm font-semibold text-red-200 hover:bg-red-500/10"
				>
					<Trash2 className="h-4 w-4" />
					{t("settings.deleteCta")}
				</button>
			</section>
			<div className="mt-6 flex flex-wrap items-center gap-4">
				<SignOut className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-sm text-white/65 hover:text-white">
					<LogOut className="h-4 w-4" />
					{t("settings.signOut")}
				</SignOut>
				<Link
					href="/profil/me"
					className="inline-flex items-center gap-1 text-sm text-dbz-blue-light hover:text-dbz-orange"
				>
					{t("settings.publicProfile")} <ExternalLink className="h-3.5 w-3.5" />
				</Link>
			</div>
			<dialog
				ref={deletionDialog}
				aria-labelledby="delete-title"
				className="m-auto max-w-md rounded-2xl border border-red-400/30 bg-[#181311] p-0 text-white shadow-2xl backdrop:bg-black/75"
			>
				<div className="p-6">
					<Trash2 className="h-6 w-6 text-red-300" aria-hidden />
					<h2 id="delete-title" className="mt-4 text-xl font-semibold">
						{t("settings.deleteConfirmTitle")}
					</h2>
					<p className="mt-2 text-sm leading-relaxed text-white/55">
						{t("settings.deleteConfirmLead")}
					</p>
					<div className="mt-6 flex justify-end gap-3">
						<button
							type="button"
							onClick={() => deletionDialog.current?.close()}
							className="min-h-11 rounded-full px-4 text-sm text-white/65 hover:bg-white/5"
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							onClick={deleteAccount}
							disabled={busy}
							className="min-h-11 rounded-full bg-red-500 px-5 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50"
						>
							{busy ? t("settings.deleting") : t("settings.deleteButton")}
						</button>
					</div>
				</div>
			</dialog>
		</div>
	);
}
