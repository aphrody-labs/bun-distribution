/**
 * Notifications maison (`lib/toast.ts`).
 *
 * Écrit pour remplacer `sonner`, dont le `<Toaster>` devait rester monté dans le
 * layout racine : 64 Kio bruts sur CHAQUE page pour deux boutons présents
 * uniquement sur les fiches. Le module n'a pas de dépendance et ne monte rien
 * tant qu'aucun message n'est demandé — d'où ce test sur un DOM minimal plutôt
 * qu'un environnement navigateur complet.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

// ── DOM minimal : juste ce que `lib/toast.ts` touche ─────────────────────────
class FauxElement {
	tagName: string;
	children: FauxElement[] = [];
	attributs: Record<string, string> = {};
	style = { cssText: "", opacity: "", transform: "" };
	textContent = "";
	type = "";
	id = "";
	ecouteurs: Record<string, Array<() => void>> = {};
	parent: FauxElement | null = null;

	constructor(tag: string) {
		this.tagName = tag.toUpperCase();
	}
	get isConnected(): boolean {
		return this.parent !== null;
	}
	get firstElementChild(): FauxElement | undefined {
		return this.children[0];
	}
	setAttribute(k: string, v: string) {
		this.attributs[k] = v;
	}
	getAttribute(k: string): string | null {
		return this.attributs[k] ?? null;
	}
	appendChild(c: FauxElement) {
		c.parent = this;
		this.children.push(c);
		return c;
	}
	remove() {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((x) => x !== this);
		this.parent = null;
	}
	addEventListener(type: string, fn: () => void) {
		(this.ecouteurs[type] ??= []).push(fn);
	}
	declencher(type: string) {
		for (const fn of this.ecouteurs[type] ?? []) fn();
	}
	/** Concatène le texte de tout le sous-arbre. */
	get texte(): string {
		return [this.textContent, ...this.children.map((c) => c.texte)].filter(Boolean).join(" ");
	}
}

const originaux = {
	document: (globalThis as Record<string, unknown>).document,
	window: (globalThis as Record<string, unknown>).window,
	requestAnimationFrame: globalThis.requestAnimationFrame,
};

let body: FauxElement;
let reduit = false;

function installerDom() {
	body = new FauxElement("body");
	body.parent = new FauxElement("html"); // isConnected
	const doc = {
		body,
		createElement: (t: string) => new FauxElement(t),
		getElementById: (id: string) => trouver(body, id),
	};
	(globalThis as Record<string, unknown>).document = doc;
	(globalThis as Record<string, unknown>).window = {
		matchMedia: () => ({ matches: reduit }),
	};
	// Exécution synchrone : le test n'a pas de boucle de rendu.
	globalThis.requestAnimationFrame = ((fn: () => void) => {
		fn();
		return 0;
	}) as typeof globalThis.requestAnimationFrame;
}

function trouver(el: FauxElement, id: string): FauxElement | null {
	if (el.id === id) return el;
	for (const c of el.children) {
		const r = trouver(c, id);
		if (r) return r;
	}
	return null;
}

installerDom();
const { toast } = await import("../src/lib/toast");

const pile = () => trouver(body, "dbfr-toasts");

beforeEach(() => {
	reduit = false;
	installerDom();
});

afterAll(() => {
	(globalThis as Record<string, unknown>).document = originaux.document;
	(globalThis as Record<string, unknown>).window = originaux.window;
	globalThis.requestAnimationFrame = originaux.requestAnimationFrame;
});

describe("toast", () => {
	test("rien n'est monté tant qu'aucun message n'est demandé", () => {
		expect(pile()).toBeNull();
	});

	test("un succès crée la pile et une région live polie", () => {
		toast.success("Lien copié");
		const p = pile()!;
		expect(p).not.toBeNull();
		expect(p.children).toHaveLength(1);
		const t = p.children[0]!;
		expect(t.getAttribute("role")).toBe("status");
		expect(t.getAttribute("aria-live")).toBe("polite");
		expect(t.texte).toContain("Lien copié");
	});

	test("une erreur est annoncée de façon assertive", () => {
		toast.error("Copie impossible");
		const t = pile()!.children[0]!;
		expect(t.getAttribute("role")).toBe("alert");
		expect(t.getAttribute("aria-live")).toBe("assertive");
	});

	test("la description est rendue sous le titre", () => {
		toast.success("Ajouté à tes favoris", { description: "Connecte-toi pour les retrouver." });
		expect(pile()!.children[0]!.texte).toContain("Connecte-toi pour les retrouver.");
	});

	test("la pile ne dépasse jamais trois messages", () => {
		for (let i = 0; i < 6; i++) toast.info(`message ${i}`);
		const p = pile()!;
		expect(p.children).toHaveLength(3);
		// Ce sont les plus RÉCENTS qui restent.
		expect(p.texte).toContain("message 5");
		expect(p.texte).not.toContain("message 0");
	});

	test("le bouton de fermeture est nommé et retire le message", () => {
		toast.success("À fermer");
		const t = pile()!.children[0]!;
		const bouton = t.children.find((c) => c.tagName === "BUTTON")!;
		expect(bouton.getAttribute("aria-label")).toBe("Fermer la notification");
		bouton.declencher("click");
		// Sans reduced-motion, la suppression passe par une transition différée :
		// l'opacité tombe immédiatement, le nœud part après.
		expect(t.style.opacity).toBe("0");
	});

	test("sous prefers-reduced-motion, la fermeture est immédiate et sans transition", () => {
		reduit = true;
		toast.success("Sans animation");
		const p = pile()!;
		const t = p.children[0]!;
		expect(t.style.cssText).not.toContain("transition");
		t.children.find((c) => c.tagName === "BUTTON")!.declencher("click");
		expect(p.children).toHaveLength(0);
	});

	test("survoler suspend le compte à rebours sans supprimer le message", () => {
		toast.success("Message long", { description: "Assez long pour être lu." });
		const t = pile()!.children[0]!;
		t.declencher("pointerenter");
		expect(t.isConnected).toBe(true);
		t.declencher("pointerleave");
		expect(t.isConnected).toBe(true);
	});
});
