"use client";

import { useId, useEffect, useState } from "react";

const THEMES = [
	{ id: "theme-roy", label: "Roy", mode: "light", swatch: "#344E8C" },
	{ id: "theme-gaelle", label: "Gaëlle", mode: "light", swatch: "#B03519" },
	{ id: "theme-azalee-light", label: "Azalée clair", mode: "light", swatch: "#F2A93B" },
	{
		id: "theme-azalee-dark",
		label: "Azalée",
		mode: "dark",
		swatch: "#1C1B1F",
	},
	{
		id: "theme-achillea",
		label: "Achilléa",
		mode: "dark",
		swatch: "#6D00CE",
	},
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

export function ThemeSwitcher() {
	const groupName = useId();
	const [active, setActive] = useState<ThemeId>("theme-roy");

	useEffect(() => {
		const root = document.documentElement.parentElement;
		const container = document.querySelector("[data-design-system-root]") ?? root;
		if (!container) {
			return;
		}
		for (const t of THEMES) {
			container.classList.remove(t.id);
		}
		container.classList.add(active);
		container.classList.toggle(
			"dark",
			active === "theme-azalee-dark" || active === "theme-achillea"
		);
	}, [active]);

	return (
		<div
			role="radiogroup"
			aria-label="Choisir un thème"
			className="inline-flex items-center gap-1 rounded-full border-2 border-on-surface p-1 font-mono-ds text-[11px] uppercase tracking-[0.18em]"
		>
			{THEMES.map((t) => {
				const isActive = t.id === active;
				return (
					<label
						key={t.id}
						className={`group flex items-center gap-2 rounded-full px-3 py-1.5 transition-all motion-safe:duration-200 outline-hidden focus-within:ring-[3px] focus-within:ring-ring/50 ${
							isActive ? "bg-on-surface text-surface" : "text-on-surface hover:bg-on-surface/10"
						}`}
					>
						<input type="radio" name={groupName} value={t.id} checked={isActive} onChange={() => setActive(t.id)} className="sr-only" />
						<span
							className="inline-block size-2.5 rounded-full ring-1 ring-on-surface/40"
							style={{ background: t.swatch }}
							aria-hidden
						/>
						<span>{t.label}</span>
					</label>
				);
			})}
		</div>
	);
}
