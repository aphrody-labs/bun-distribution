import {
	AdminPageHeader,
	Badge,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@rosegriffon/ui";
import {
	formatBytes,
	getAdvisors,
	getDatabaseInfo,
	listExtensions,
	listMigrations,
	listStorageBuckets,
	listTables,
} from "@rosegriffon/db/platform";
import { AlertTriangle, CheckCircle2, Database, HardDrive, Info, XCircle } from "lucide-react";

import { getStackHealth, pgQuery } from "@/lib/db/platform";

export const dynamic = "force-dynamic";

export const metadata = {
	description: "État de la pile Supabase auto-hébergée : services, schéma, sécurité, stockage.",
	title: "Infrastructure — Administration",
};

const LEVEL_STYLE = {
	error: { Icon: XCircle, className: "text-destructive", label: "Erreur" },
	info: { Icon: Info, className: "text-info", label: "Information" },
	warning: { Icon: AlertTriangle, className: "text-alerte", label: "Avertissement" },
} as const;

/**
 * Page « Infrastructure » de l'administration.
 *
 * Elle expose dans le navigateur ce que le serveur MCP offrait jusqu'ici au
 * seul agent : inventaire des tables, extensions, migrations, audit de
 * sécurité et stockage. Les requêtes viennent du module partagé
 * `@rosegriffon/db/platform`, si bien que l'agent et l'interface ne peuvent
 * pas diverger.
 *
 * Tout est en lecture seule : l'écriture de schéma reste réservée au jeton
 * d'administration du MCP (`apply_migration`), qui trace ce qu'il applique.
 */
export default async function InfrastructurePage() {
	const [health, dbInfo, tables, extensions, migrations, buckets, advisors] = await Promise.all([
		getStackHealth(),
		getDatabaseInfo(pgQuery),
		listTables(pgQuery),
		listExtensions(pgQuery),
		listMigrations(pgQuery),
		listStorageBuckets(pgQuery),
		getAdvisors(pgQuery, "all"),
	]);

	const totalRows = tables.reduce((sum, t) => sum + t.rows, 0);
	const sansRls = tables.filter((t) => !t.rlsEnabled).length;

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				icon={<Database className="size-5" />}
				title="Infrastructure"
				description="Pile Supabase auto-hébergée : services, schéma, sécurité et stockage."
			/>

			<Card>
				<CardHeader>
					<CardTitle>Services</CardTitle>
					<CardDescription>
						Les trois briques qui remplacent Supabase Cloud, sondées sur leur boucle locale.
						PostgreSQL {dbInfo.version} · base « {dbInfo.database} » · {dbInfo.sizePretty} ·{" "}
						{dbInfo.connections}/{dbInfo.maxConnections} connexions.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 sm:grid-cols-3">
					{health.map((service) => (
						<div
							key={service.name}
							className="flex items-start gap-3 rounded-lg border border-border p-4"
						>
							{service.ok ? (
								<CheckCircle2 className="size-5 shrink-0 text-succes" aria-hidden />
							) : (
								<XCircle className="size-5 shrink-0 text-destructive" aria-hidden />
							)}
							<div className="min-w-0">
								<p className="font-semibold text-foreground">{service.name}</p>
								<p className="text-xs text-muted-foreground">{service.role}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{service.ok
										? `HTTP ${service.status} · ${service.latencyMs} ms`
										: (service.error ?? `HTTP ${service.status}`)}
								</p>
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex flex-wrap items-center gap-2">
						Audit de sécurité
						{advisors.byLevel.error > 0 && (
							<Badge variant="destructive">{advisors.byLevel.error} à corriger</Badge>
						)}
						{advisors.byLevel.error === 0 && (
							<Badge className="bg-succes/15 text-succes">Aucune fuite détectée</Badge>
						)}
					</CardTitle>
					<CardDescription>
						Croise les droits et la RLS : une colonne accordée à « anon » mais verrouillée par une
						policy n'est pas une fuite. C'est ce contrôle qui a révélé le 11 août 2026 que les
						e-mails de tous les comptes étaient publics.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					{advisors.findings.length === 0 && (
						<p className="text-sm text-muted-foreground">Aucun constat.</p>
					)}
					{advisors.findings.map((finding) => {
						const style = LEVEL_STYLE[finding.level];
						return (
							<div
								key={`${finding.category}:${finding.object}`}
								className="flex items-start gap-3 rounded-lg border border-border p-3"
							>
								<style.Icon className={`mt-0.5 size-4 shrink-0 ${style.className}`} aria-hidden />
								<div className="min-w-0">
									<p className="font-mono text-sm break-all text-foreground">{finding.object}</p>
									<p className="text-xs text-muted-foreground">{finding.detail}</p>
								</div>
							</div>
						);
					})}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Tables</CardTitle>
					<CardDescription>
						{tables.length} tables · {totalRows.toLocaleString("fr-FR")} lignes estimées ·{" "}
						{sansRls} sans RLS. Les volumes viennent des statistiques du planificateur, pas d'un
						comptage exact.
					</CardDescription>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Table</TableHead>
								<TableHead className="text-right">Lignes</TableHead>
								<TableHead className="text-right">Taille</TableHead>
								<TableHead className="text-right">RLS</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{tables.slice(0, 40).map((table) => (
								<TableRow key={table.name}>
									<TableCell className="font-mono text-xs">{table.name}</TableCell>
									<TableCell className="text-right tabular-nums">
										{table.rows.toLocaleString("fr-FR")}
									</TableCell>
									<TableCell className="text-right text-muted-foreground">{table.size}</TableCell>
									<TableCell className="text-right">
										{table.rlsEnabled ? (
											<Badge className="bg-succes/15 text-succes">{table.policies}</Badge>
										) : (
											<Badge variant="outline" className="text-muted-foreground">
												non
											</Badge>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{tables.length > 40 && (
						<p className="mt-3 text-xs text-muted-foreground">
							Les 40 plus volumineuses sur {tables.length}.
						</p>
					)}
				</CardContent>
			</Card>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<HardDrive className="size-5 text-muted-foreground" aria-hidden />
							Stockage
						</CardTitle>
						<CardDescription>
							Fichiers servis par `rg-storage`, indexés dans `storage.objects`.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						{buckets.length === 0 && (
							<p className="text-sm text-muted-foreground">Aucun bucket.</p>
						)}
						{buckets.map((bucket) => (
							<div
								key={bucket.name}
								className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
							>
								<div className="flex items-center gap-2">
									<span className="font-mono text-sm text-foreground">{bucket.name}</span>
									{bucket.public && (
										<Badge variant="outline" className="text-muted-foreground">
											public
										</Badge>
									)}
								</div>
								<span className="text-xs text-muted-foreground">
									{bucket.objects.toLocaleString("fr-FR")} fichiers ·{" "}
									{formatBytes(Number(bucket.bytes))}
								</span>
							</div>
						))}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Extensions et migrations</CardTitle>
						<CardDescription>
							{extensions.length} extensions · {migrations.length} migrations enregistrées.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-wrap gap-1.5">
							{extensions.map((extension) => (
								<Badge key={extension.name} variant="outline" className="font-mono text-[11px]">
									{extension.name} {extension.version}
								</Badge>
							))}
						</div>
						{migrations.length > 0 && (
							<ul className="space-y-1 text-xs text-muted-foreground">
								{migrations.slice(0, 8).map((migration) => (
									<li key={migration.version} className="font-mono">
										{migration.version} {migration.name ?? ""}
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
