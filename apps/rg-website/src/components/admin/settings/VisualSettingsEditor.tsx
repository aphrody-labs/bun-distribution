"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@rosegriffon/ui";
import { Loader2, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { updateSetting } from "@/app/admin/settings/actions";
import FusionBlock from "@/components/shared/FusionBlock";
import { absoluteUrl } from "@/lib/site-url";

export interface Setting { key: string; value: string; description?: string }
const getVal = (settings: Setting[], key: string, fallback: string) => settings.find((setting) => setting.key === key)?.value ?? fallback;

function Field({ label, settingKey, fallback, multiline = false, settings, initialSettings, loading, setLocal, save }: {
	label: string; settingKey: string; fallback: string; multiline?: boolean;
	settings: Setting[]; initialSettings: Setting[]; loading: string | null;
	setLocal: (key: string, value: string) => void; save: (key: string, value: string) => Promise<void>;
}) {
	const value = getVal(settings, settingKey, fallback);
	const changed = value !== getVal(initialSettings, settingKey, fallback);
	return <div className="space-y-2">
		<Label htmlFor={settingKey} className="text-lg">{label}</Label>
		<div className="flex gap-2">
			{multiline ? <Textarea id={settingKey} value={value} onChange={(event) => setLocal(settingKey, event.target.value)} className="min-h-24 text-lg" /> : <Input id={settingKey} value={value} onChange={(event) => setLocal(settingKey, event.target.value)} className="text-lg" />}
			<Button type="button" onClick={() => save(settingKey, value)} disabled={!changed || loading !== null} aria-label={`Enregistrer ${label}`}>
				{loading === settingKey ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
			</Button>
		</div>
	</div>;
}

export function VisualSettingsEditor({ settings: initialSettings }: { settings: Setting[] }) {
	const [settings, setSettings] = useState(initialSettings);
	const [savedSettings, setSavedSettings] = useState(initialSettings);
	const [loading, setLoading] = useState<string | null>(null);
	const setLocal = (key: string, value: string) => setSettings((current) => [...current.filter((setting) => setting.key !== key), { key, value }]);
	async function save(key: string, value: string) {
		setLoading(key);
		try {
			const result = await updateSetting(key, value);
			if (result.message.startsWith("Erreur")) toast.error(result.message);
			else {
				setSavedSettings((current) => [...current.filter((setting) => setting.key !== key), { key, value }]);
				toast.success("Paramètre enregistré");
			}
		} catch { toast.error("Impossible d'enregistrer ce paramètre"); }
		finally { setLoading(null); }
	}
	const fieldProps = { settings, initialSettings: savedSettings, loading, setLocal, save };
	return <Tabs defaultValue="rg" className="w-full space-y-6">
		<TabsList className="h-auto flex-wrap gap-2"><TabsTrigger value="rg" className="text-lg">Rose Griffon</TabsTrigger><TabsTrigger value="achillea" className="text-lg">Achilléa</TabsTrigger></TabsList>
		<TabsContent value="rg" className="grid gap-8 lg:grid-cols-2">
			<Card><CardHeader><CardTitle>Présentation du site</CardTitle><CardDescription>Contenu affiché sur la page d'accueil Rose Griffon.</CardDescription></CardHeader><CardContent className="space-y-5">
				<Field {...fieldProps} label="Titre" settingKey="home_intro_title" fallback="Qu'est-ce que Rose Griffon ?" />
				<Field {...fieldProps} label="Texte" settingKey="home_intro_text" fallback="Rose Griffon est une association française régie par la loi de 1901, ayant pour vocation de rassembler les principaux acteurs de la communauté Inazuma Eleven ainsi que l'ensemble des passionnés sous une même bannière." multiline />
				<Field {...fieldProps} label="Image (URL HTTPS ou chemin local)" settingKey="home_intro_image" fallback="/RG_screens_twitch_ethan.webp" />
			</CardContent></Card>
			<Card><CardHeader><CardTitle>Aperçu</CardTitle></CardHeader><CardContent><FusionBlock isImageLeft image={getVal(settings, "home_intro_image", "/RG_screens_twitch_ethan.webp")}><div className="space-y-4 p-4"><h2 className="text-2xl font-bold">{getVal(settings, "home_intro_title", "Qu'est-ce que Rose Griffon ?")}</h2><p className="text-lg">{getVal(settings, "home_intro_text", "")}</p></div></FusionBlock></CardContent></Card>
		</TabsContent>
		<TabsContent value="achillea"><Card className="max-w-3xl"><CardHeader><CardTitle>Informations publiques Achilléa</CardTitle><CardDescription>Valeurs exposées par l'API publique Achilléa.</CardDescription></CardHeader><CardContent className="space-y-5">
			<Field {...fieldProps} label="Description" settingKey="home_achillea_description" fallback="Le carrefour de l'esport Inazuma Eleven ! Gestion de clans, tournois, matchs classés, ranking communautaire et bot officiel." multiline />
			<Field {...fieldProps} label="Invitation Discord" settingKey="home_achillea_discord" fallback="https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055" />
			<Field {...fieldProps} label="Bannière" settingKey="home_achillea_image" fallback={absoluteUrl("/achillea/banniere.webp")} />
			<Field {...fieldProps} label="Lien du site" settingKey="home_achillea_link" fallback={absoluteUrl("/achillea")} />
		</CardContent></Card></TabsContent>
	</Tabs>;
}
