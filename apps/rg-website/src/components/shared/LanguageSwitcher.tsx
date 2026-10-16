"use client";

import { DEFAULT_LOCALE_REGISTRY } from "@rosegriffon/i18n";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rosegriffon/ui";
import { Check, Languages } from "lucide-react";
import { useMemo } from "react";

import { type Language, useLanguage } from "@/components/providers/language-provider";

const LANGUAGES = DEFAULT_LOCALE_REGISTRY.locales
	.map(({ tag }) => tag)
	.filter((tag): tag is Language => tag === "fr" || tag === "en" || tag === "ja");

export function LanguageSwitcher() {
	const { language, setLanguage, t } = useLanguage();
	const displayNames = useMemo(
		() => new Intl.DisplayNames([language], { type: "language" }),
		[language]
	);
	const currentName = displayNames.of(language) ?? language;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-12 min-w-11 gap-1 px-2 md:h-10"
					title={`${t("ui.language.current")}: ${currentName}`}
					aria-label={`${t("ui.language.current")}: ${currentName}. ${t("ui.language.change")}`}
				>
					<Languages data-icon="inline-start" aria-hidden />
					<span className="text-xs font-black uppercase" aria-hidden="true">
						{language}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-48">
				<DropdownMenuLabel>{t("ui.language.label")}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{LANGUAGES.map((locale) => {
					const isActive = locale === language;
					return (
						<DropdownMenuItem
							key={locale}
							onSelect={() => setLanguage(locale)}
							aria-current={isActive ? "true" : undefined}
						>
							<span lang={locale} className="flex-1">
								{new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale}
							</span>
							{isActive && <Check data-icon="inline-end" aria-hidden />}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
