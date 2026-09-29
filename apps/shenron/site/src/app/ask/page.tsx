"use client";

import { useState, useEffect, useRef } from "react";
import { PageShell } from "@/components/kit";
import dynamic from "next/dynamic";
import { SITE_URL } from "@/lib/config";
import {
	Send,
	Sparkles,
	BookOpen,
	HelpCircle,
	RefreshCw,
	ChevronRight,
	Compass,
} from "lucide-react";

const KiCanvas = dynamic(() => import("@/components/site/KiCanvas").then((m) => m.KiCanvas), {
	ssr: false,
});

/**
 * Un extrait de source renvoyé par le RAG (`/api/chat`). Le champ `url` peut
 * manquer sur un chunk sans page d'atterrissage : il est donc optionnel ici, et
 * le rendu ne fabrique de lien que lorsqu'il est présent.
 */
interface SourceRag {
	kind?: string;
	url?: string | null;
	title?: string;
	snippet?: string;
}

interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	hits?: SourceRag[];
	mode?: string;
}

const PERSONAS = {
	whis: {
		id: "whis",
		name: "Whis",
		avatar: "/assets/personas/whis.png", // fallback local avatar
		icon: "🥋",
		role: "Ange-Guide & Mentor",
		accentColor: "from-cyan-400 to-amber-300",
		shadowColor: "shadow-cyan-500/10",
		glowBg: "rgba(34, 211, 238, 0.12)",
		borderColor: "border-cyan-500/20",
		bubbleBg: "bg-cyan-500/10 border-cyan-500/20 text-cyan-100",
		textColor: "text-cyan-300",
		placeholder: "Posez votre question à Whis, jeune disciple...",
		welcome:
			"Oh oh ! Bonjour, jeune disciple. J'ai réuni les archives de l'Univers 7 pour guider votre entraînement spirituel. Quelle curiosité s'empare de vous aujourd'hui ?",
		suggestions: [
			"Comment Goku a-t-il atteint le Super Saiyan ?",
			"Qui est le Grand Prêtre ?",
			"Quelle est la différence entre l'Ultra Instinct et l'Ultra Ego ?",
		],
		kiColor: 0x22d3ee,
		kiAccent: 0xfcd34d,
		density: 0.8,
	},
	beerus: {
		id: "beerus",
		name: "Beerus",
		avatar: "/assets/personas/beerus.png",
		icon: "🪐",
		role: "Dieu de la Destruction",
		accentColor: "from-purple-500 to-pink-500",
		shadowColor: "shadow-purple-500/10",
		glowBg: "rgba(168, 85, 247, 0.12)",
		borderColor: "border-purple-500/20",
		bubbleBg: "bg-purple-500/10 border-purple-500/20 text-purple-100",
		textColor: "text-purple-300",
		placeholder: "Parlez à Beerus... Soyez bref !",
		welcome:
			"Mmmh ? Encore un mortel insignifiant qui vient troubler ma sieste. Sois bref ou je pulvérise ton quadrant ! Et si tu as du pudding, c'est le moment.",
		suggestions: [
			"Quel est le pouvoir du Hakaï ?",
			"Qui est le plus fort entre Goku et Beerus ?",
			"Où se trouve la planète de Beerus ?",
		],
		kiColor: 0xa855f7,
		kiAccent: 0xec4899,
		density: 1.2,
	},
	shenron: {
		id: "shenron",
		name: "Shenron",
		avatar: "/assets/personas/shenron.png",
		icon: "🐉",
		role: "Dragon Sacré",
		accentColor: "from-emerald-500 to-amber-400",
		shadowColor: "shadow-emerald-500/10",
		glowBg: "rgba(16, 185, 129, 0.12)",
		borderColor: "border-emerald-500/20",
		bubbleBg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-200",
		textColor: "text-emerald-300",
		placeholder: "Exprimez votre vœu, mortel...",
		welcome:
			"Je suis Shenron. Tu as rassemblé les sept Dragon Balls. Formule ta question, mortel. Hâte-toi, ma puissance a des limites et mon temps est compté !",
		suggestions: [
			"Comment ont été créées les Dragon Balls ?",
			"Qui est le créateur du dragon Shenron ?",
			"Quelles sont les limites des vœux de Shenron ?",
		],
		kiColor: 0x10b981,
		kiAccent: 0xf59e0b,
		density: 0.9,
	},
	grandpretre: {
		id: "grandpretre",
		name: "Grand Prêtre",
		avatar: "/assets/personas/grandpretre.png",
		icon: "😇",
		role: "Guide Suprême des Univers",
		accentColor: "from-sky-300 to-blue-600",
		shadowColor: "shadow-sky-500/10",
		glowBg: "rgba(125, 211, 252, 0.12)",
		borderColor: "border-sky-500/20",
		bubbleBg: "bg-sky-500/10 border-sky-500/20 text-sky-100",
		textColor: "text-sky-300",
		placeholder: "Adressez-vous au Grand Prêtre, voyageur...",
		welcome:
			"Salutations. Sa Majesté le Roi de Tout m'a chargé d'observer les connaissances de cette dimension. Parlez de vos quêtes de vérité sans crainte.",
		suggestions: [
			"Qui est le Roi de Tout (Zeno) ?",
			"Combien y a-t-il d'univers au total ?",
			"Quel est le rôle du Grand Prêtre ?",
		],
		kiColor: 0x7dd3fc,
		kiAccent: 0x2563eb,
		density: 0.7,
	},
	kaio: {
		id: "kaio",
		name: "Maître Kaïo",
		avatar: "/assets/personas/kaio.png",
		icon: "🐒",
		role: "Roi Kaï du Nord",
		accentColor: "from-emerald-400 to-sky-400",
		shadowColor: "shadow-emerald-500/10",
		glowBg: "rgba(52, 211, 153, 0.12)",
		borderColor: "border-emerald-500/20",
		bubbleBg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-100",
		textColor: "text-emerald-300",
		placeholder: "Raconte une blague à Maître Kaïo...",
		welcome:
			"Ohoho ! Salut mon grand ! Tu as réussi à traverser le chemin du serpent pour venir me voir ? Raconte-moi une bonne blague, ou demande-moi tout sur les techniques secrètes !",
		suggestions: [
			"Qu'est-ce que le Genkidama ?",
			"Peux-tu m'expliquer le Kaio-ken ?",
			"Raconte-moi une blague !",
		],
		kiColor: 0x34d399,
		kiAccent: 0x38bdf8,
		density: 0.9,
	},
	enma: {
		id: "enma",
		name: "Enma Daïō",
		avatar: "/assets/personas/enma.png",
		icon: "👹",
		role: "Juge des Âmes",
		accentColor: "from-red-500 to-amber-600",
		shadowColor: "shadow-red-500/10",
		glowBg: "rgba(239, 68, 68, 0.12)",
		borderColor: "border-red-500/20",
		bubbleBg: "bg-red-500/10 border-red-500/20 text-red-100",
		textColor: "text-red-300",
		placeholder: "Quel dossier voulez-vous consulter ?",
		welcome:
			"Silence ! J'ai une montagne de dossiers d'âmes à tamponner aujourd'hui et Freezer recommence à s'agiter en enfer ! Soyez bref, je n'ai pas de temps à perdre.",
		suggestions: [
			"Où vont les âmes des méchants après la mort ?",
			"Que s'est-il passé avec le dossier de Raditz ?",
			"Comment fonctionne le tribunal d'Enma ?",
		],
		kiColor: 0xef4444,
		kiAccent: 0xd97706,
		density: 1.1,
	},
};

type PersonaId = keyof typeof PERSONAS;

export default function AskPage() {
	const [persona, setPersona] = useState<PersonaId>("whis");
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [activeSources, setActiveSources] = useState<SourceRag[]>([]);
	const [searchMode, setSearchMode] = useState<string>("");

	const messagesEndRef = useRef<HTMLDivElement>(null);
	const chatTheme = PERSONAS[persona];

	/**
	 * Numéro de la conversation en cours. Changer d'oracle (ou réinitialiser)
	 * l'incrémente : une réponse encore en vol quand on change d'interlocuteur
	 * était sinon recollée sous le nouveau message d'accueil, attribuée au
	 * mauvais persona.
	 */
	const conversation = useRef(0);

	// Initialisation des messages et de la session
	useEffect(() => {
		conversation.current += 1;
		setMessages([
			{
				id: "welcome",
				role: "assistant",
				content: chatTheme.welcome,
			},
		]);
		setActiveSources([]);
		setSearchMode("");
	}, [persona, chatTheme.welcome]);

	// Question passée en URL (`/ask?q=…`) — c'est la sortie « poser la question »
	// de la palette ⌘K. Elle est REPORTÉE dans le champ de saisie, une seule fois ;
	// c'est l'utilisateur qui l'envoie. Sans ce relais, la question tapée dans la
	// recherche était perdue à la navigation et il fallait la retaper. L'envoi
	// automatique est volontairement écarté : la question partirait sur la simple
	// ouverture d'un lien, sans que son auteur puisse la relire ni choisir son
	// oracle — et chaque appel coûte une recherche hybride plus un appel au modèle.
	const questionUrlReportee = useRef(false);
	useEffect(() => {
		if (questionUrlReportee.current) return;
		const q = new URLSearchParams(window.location.search).get("q")?.trim();
		if (!q) return;
		questionUrlReportee.current = true;
		setInput(q);
	}, []);

	// Scroll automatique — jamais au premier rendu : le seul message présent est
	// alors l'accueil, et faire défiler la page vers le bas de la colonne de chat
	// dès l'arrivée sur `/ask` masquait le titre et le sélecteur d'oracle.
	useEffect(() => {
		if (messages.length <= 1 && !isLoading) return;
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}, [messages, isLoading]);

	const handleSend = async (textToSend: string) => {
		if (!textToSend.trim() || isLoading) return;

		const userMsg = textToSend.trim();
		const userMsgId = Math.random().toString(36).substring(2);
		const conversationEnvoi = conversation.current;

		setInput("");
		setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: userMsg }]);
		setIsLoading(true);

		try {
			let sid = "";
			if (typeof window !== "undefined") {
				sid = localStorage.getItem("dbfr_chat_session") || "";
				if (!sid) {
					sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
					localStorage.setItem("dbfr_chat_session", sid);
				}
			}

			const url = `/api/chat?q=${encodeURIComponent(userMsg)}&persona=${persona}${sid ? `&session=${encodeURIComponent(sid)}` : ""}`;
			const res = await fetch(url);

			if (!res.ok) {
				throw new Error("Perturbation de l'autre monde détectée");
			}

			const data = await res.json();
			// La conversation a changé pendant l'attente → la réponse ne concerne
			// plus l'oracle affiché : on la jette au lieu de l'afficher sous lui.
			if (conversation.current !== conversationEnvoi) return;
			const botResponse = data.answer || "Même les dieux restent muets sur cette question...";

			// La colonne « Sources consultées » décrit la DERNIÈRE réponse. Ne la
			// remplir que lorsqu'il y a des extraits laissait ceux de la question
			// précédente affichés à côté d'un texte auquel ils n'avaient pas servi —
			// des sources attribuées à tort. Une réponse sans extrait la vide.
			const extraits: SourceRag[] = Array.isArray(data.hits) ? data.hits : [];
			setActiveSources(extraits);
			setSearchMode(extraits.length > 0 ? data.mode || "hybrid" : "");

			const botMsgId = Math.random().toString(36).substring(2);
			setMessages((prev) => [
				...prev,
				{
					id: botMsgId,
					role: "assistant",
					content: botResponse,
					hits: extraits,
					mode: data.mode,
				},
			]);
		} catch (err) {
			console.error(err);
			if (conversation.current !== conversationEnvoi) return;
			setMessages((prev) => [
				...prev,
				{
					id: `err-${Date.now()}`,
					role: "assistant",
					content:
						"Une perturbation cosmique bloque mes sens divins. Veuillez me reposer votre question dans un instant.",
				},
			]);
		} finally {
			setIsLoading(false);
		}
	};

	const clearHistory = () => {
		conversation.current += 1;
		try {
			// Safari en navigation privée refuse l'accès au stockage : la remise à
			// zéro de l'affichage ne doit pas dépendre de sa réussite.
			localStorage.removeItem("dbfr_chat_session");
		} catch {
			/* stockage indisponible — sans conséquence ici */
		}
		setMessages([
			{
				id: "welcome",
				role: "assistant",
				content: chatTheme.welcome,
			},
		]);
		setActiveSources([]);
		setSearchMode("");
	};

	return (
		<div className="flex-1 w-full min-h-[calc(100vh-4rem)] flex flex-col bg-dbz-bg relative overflow-hidden">
			{/* Arrière-plan thématique dynamique */}
			<div
				className="absolute inset-0 z-0 pointer-events-none transition-all duration-1000 ease-in-out opacity-20"
				style={{
					background: `radial-gradient(circle at 50% 30%, ${chatTheme.glowBg}, transparent 65%)`,
				}}
			/>

			{/* WebGPU Ki canvas background */}
			<div className="absolute inset-0 z-0 pointer-events-none opacity-20 transition-all duration-1000">
				<KiCanvas
					key={persona} // Force re-mount on swap to reset system preference resizing correctly
					color={chatTheme.kiColor}
					colorAccent={chatTheme.kiAccent}
					density={chatTheme.density}
					className="w-full h-full"
				/>
			</div>

			{/* Même colonne et même gouttière que le reste du site ; les classes de
			    disposition (deux colonnes à partir de `lg`) restent propres à cette
			    page, le shell ne porte que la largeur et le rythme. */}
			<PageShell
				width="wide"
				rhythm="tight"
				className="relative z-10 flex flex-1 flex-col gap-6 lg:flex-row"
			>
				{/* Colonne de Gauche : Sélecteur de Persona + Suggestions */}
				<div className="w-full lg:w-80 flex flex-col gap-6 shrink-0">
					{/* Titre */}
					<div className="dbz-panel p-6 bg-dbz-card/40 border border-white/5 backdrop-blur-md">
						<div className="flex items-center gap-2 mb-3">
							<Sparkles className="w-5 h-5 text-dbz-orange animate-pulse" />
							<span className="scouter-text text-xs text-dbz-orange font-bold">
								ORACLE CONNECTÉ
							</span>
						</div>
						<h1 className="text-3xl font-saiyan tracking-widest text-white mb-2">
							CONSEIL DES DIEUX
						</h1>
						<p className="text-xs text-zinc-400 leading-relaxed font-sans">
							Interrogez les entités les plus sages et puissantes de l'Univers 7. Leurs réponses
							s'appuient sur les archives sacrées du wiki.
						</p>
					</div>

					{/* Sélecteur */}
					<div className="dbz-panel p-4 bg-dbz-card/40 border border-white/5 backdrop-blur-md">
						<h2 className="text-xs uppercase tracking-[0.2em] text-zinc-400 font-bold mb-3 px-2 font-display">
							Choisir l'Oracle
						</h2>
						<div className="flex flex-col gap-2">
							{(Object.keys(PERSONAS) as PersonaId[]).map((pId) => {
								const p = PERSONAS[pId];
								const isSelected = persona === pId;
								return (
									<button
										key={pId}
										type="button"
										onClick={() => setPersona(pId)}
										// L'oracle actif n'était signalé que par la couleur du bouton.
										aria-pressed={isSelected}
										className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-300 ${
											isSelected
												? `bg-gradient-to-r ${p.accentColor} text-black font-semibold border-transparent shadow-lg ${p.shadowColor}`
												: "bg-black/30 border-white/5 text-zinc-300 hover:bg-white/5 hover:border-white/10"
										}`}
									>
										<span className="text-2xl">{p.icon}</span>
										<div className="flex-1 min-w-0">
											<p
												className={`text-sm font-display font-bold leading-tight ${isSelected ? "text-black" : "text-white"}`}
											>
												{p.name}
											</p>
											<p
												className={`text-[10px] truncate uppercase tracking-wider ${isSelected ? "text-black/70" : "text-zinc-500"}`}
											>
												{p.role}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					</div>

					{/* Suggestions */}
					<div className="dbz-panel p-5 bg-dbz-card/40 border border-white/5 backdrop-blur-md flex-1 hidden lg:flex flex-col">
						<div className="flex items-center gap-2 mb-4">
							<HelpCircle className="w-4 h-4 text-dbz-orange" />
							<h3 className="text-xs uppercase tracking-[0.2em] text-zinc-300 font-bold font-display">
								Questions suggérées
							</h3>
						</div>
						<div className="flex flex-col gap-3 flex-1">
							{chatTheme.suggestions.map((sug, i) => (
								<button
									key={i}
									onClick={() => handleSend(sug)}
									disabled={isLoading}
									className="group text-left p-3 rounded-xl bg-black/25 border border-white/5 hover:border-dbz-orange/40 text-xs text-zinc-300 hover:text-white transition-all duration-300 flex items-start gap-2 disabled:opacity-50 disabled:pointer-events-none"
								>
									<ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-dbz-orange/70 group-hover:text-dbz-orange transition-colors" />
									<span className="font-sans leading-relaxed">{sug}</span>
								</button>
							))}
						</div>
					</div>
				</div>

				{/* Colonne du Milieu : Chat principal */}
				<div className="flex-1 flex flex-col min-h-[500px] dbz-panel bg-black/40 border border-white/5 backdrop-blur-md overflow-hidden relative">
					{/* Sub-Header Chat */}
					<div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-xl relative">
								<span>{chatTheme.icon}</span>
								<span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-black" />
							</div>
							<div>
								<h2 className="text-sm font-display font-bold text-white flex items-center gap-1.5">
									{chatTheme.name}
								</h2>
								<p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
									{chatTheme.role}
								</p>
							</div>
						</div>

						<button
							type="button"
							onClick={clearHistory}
							// Le libellé disparaît sous 640 px : sans `aria-label`, le bouton
							// n'avait plus aucun nom accessible sur mobile. `cible-44` porte
							// la zone tactile à 44 px sans grossir le dessin.
							aria-label="Effacer la conversation"
							className="cible-44 p-2 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 text-zinc-400 hover:text-white transition-all text-xs flex items-center gap-1.5 font-display"
							title="Effacer la conversation"
						>
							<RefreshCw className="w-3.5 h-3.5" />
							<span className="hidden sm:inline">Réinitialiser</span>
						</button>
					</div>

					{/* Corps des messages */}
					<div className="flex-1 overflow-y-auto p-6 space-y-6 max-h-[600px] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
						{messages.map((msg) => (
							<div
								key={msg.id}
								className={`flex items-start gap-3 max-w-[85%] ${
									msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
								}`}
							>
								{msg.role === "assistant" && (
									<div className="w-8 h-8 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-base shrink-0 mt-0.5 select-none">
										{chatTheme.icon}
									</div>
								)}

								<div className="flex flex-col gap-1">
									<div
										className={`p-4 rounded-2xl text-sm leading-relaxed font-sans shadow-md ${
											msg.role === "user"
												? "bg-gradient-to-r from-amber-500 to-orange-600 text-black font-semibold rounded-tr-none"
												: `${chatTheme.bubbleBg} border rounded-tl-none`
										}`}
									>
										{msg.content}
									</div>
									{msg.hits && msg.hits.length > 0 && (
										<div className="flex items-center gap-1 px-1 mt-1 text-[9px] text-zinc-500">
											<BookOpen className="w-3 h-3 text-dbz-orange/60" />
											<span>
												RAG {msg.mode === "hybrid+rerank" ? "hybride + rerank" : "lexical"} ·{" "}
												{msg.hits.length} sources consultées
											</span>
										</div>
									)}
								</div>
							</div>
						))}

						{isLoading && (
							<div className="flex items-start gap-3 mr-auto max-w-[85%]">
								<div className="w-8 h-8 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-base shrink-0 select-none">
									{chatTheme.icon}
								</div>
								<div
									className={`p-4 rounded-2xl border rounded-tl-none ${chatTheme.bubbleBg} flex items-center gap-1.5`}
								>
									<span
										className={`w-2 h-2 rounded-full bg-current opacity-70 animate-bounce`}
										style={{ animationDelay: "0ms" }}
									/>
									<span
										className={`w-2 h-2 rounded-full bg-current opacity-70 animate-bounce`}
										style={{ animationDelay: "150ms" }}
									/>
									<span
										className={`w-2 h-2 rounded-full bg-current opacity-70 animate-bounce`}
										style={{ animationDelay: "300ms" }}
									/>
								</div>
							</div>
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Formulaire d'envoi */}
					<form
						onSubmit={(e) => {
							e.preventDefault();
							handleSend(input);
						}}
						className="p-4 border-t border-white/5 bg-white/[0.01] flex gap-3 items-center relative z-20"
					>
						<input
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							aria-label="Votre question sur l'univers Dragon Ball"
							placeholder={chatTheme.placeholder}
							disabled={isLoading}
							className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-dbz-orange/50 transition-all font-sans"
						/>
						<button
							type="submit"
							disabled={isLoading || !input.trim()}
							className={`h-11 px-5 rounded-xl bg-gradient-to-r ${chatTheme.accentColor} text-black font-bold text-sm flex items-center gap-2 hover:scale-[1.03] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none shadow-lg`}
						>
							<span className="hidden sm:inline">Interroger</span>
							<Send className="w-4 h-4" />
						</button>
					</form>
				</div>

				{/* Colonne de Droite : Sources / RAG Hits */}
				<div className="w-full lg:w-80 shrink-0">
					<div className="dbz-panel p-6 bg-dbz-card/40 border border-white/5 backdrop-blur-md h-full flex flex-col">
						<div className="flex items-center gap-2 mb-4">
							<BookOpen className="w-5 h-5 text-dbz-orange" />
							<h3 className="text-xs uppercase tracking-[0.2em] text-zinc-300 font-bold font-display">
								Sources consultées
							</h3>
						</div>

						{activeSources.length === 0 ? (
							<div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/5 rounded-2xl bg-black/20">
								<Compass className="w-8 h-8 text-zinc-600 mb-3" />
								<p className="text-xs text-zinc-500 font-sans">
									Posez une question lore pour voir les documents RAG consultés par l'Oracle en
									temps réel.
								</p>
							</div>
						) : (
							<div className="flex flex-col gap-3 flex-1 overflow-y-auto max-h-[520px] scrollbar-thin">
								<div className="flex items-center justify-between text-[10px] text-zinc-500 border-b border-white/5 pb-2">
									<span>MODE: {searchMode.toUpperCase()}</span>
									<span>
										{activeSources.filter((s) => s.kind !== "page_context").length} DOCUMENTS
									</span>
								</div>

								{activeSources
									.filter((s) => s.kind !== "page_context")
									.map((src, i) => {
										// Résolution en URL absolue. `src.url` peut manquer (chunk sans
										// page d'atterrissage) : lire `.startsWith` dessus faisait
										// tomber TOUTE la page sur une seule source mal formée. Le
										// domaine vient de `@/lib/config`, jamais réécrit en dur.
										const chemin = typeof src.url === "string" ? src.url.trim() : "";
										const fullUrl = !chemin
											? null
											: chemin.startsWith("http")
												? chemin
												: `${SITE_URL}${chemin.startsWith("/") ? "" : "/"}${chemin}`;
										// Sans URL exploitable, la carte reste affichée mais n'est plus
										// un lien : un `<a>` sans `href` n'est ni cliquable ni focusable.
										return (
											<a
												key={`${chemin || "sans-lien"}-${i}`}
												{...(fullUrl
													? { href: fullUrl, target: "_blank", rel: "noopener noreferrer" }
													: {})}
												className="block p-3 rounded-xl bg-black/25 border border-white/5 hover:border-dbz-orange/40 transition-all duration-300 group"
											>
												<div className="flex items-center justify-between mb-1.5">
													<span className="text-[9px] uppercase tracking-wider text-dbz-orange font-bold font-display bg-dbz-orange/10 px-2 py-0.5 rounded border border-dbz-orange/20">
														{src.kind === "character" ? "Perso" : src.kind}
													</span>
													<span className="text-[9px] text-zinc-500 font-sans">
														Source #{i + 1}
													</span>
												</div>
												<h4 className="text-xs font-bold text-white group-hover:text-dbz-orange transition-colors truncate">
													{src.title}
												</h4>
												<p className="text-[10px] text-zinc-400 mt-1 line-clamp-2 font-sans leading-relaxed">
													{src.snippet}
												</p>
											</a>
										);
									})}
							</div>
						)}
					</div>
				</div>
			</PageShell>
		</div>
	);
}
