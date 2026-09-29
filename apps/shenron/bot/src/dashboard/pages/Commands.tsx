import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	Lock,
	Power,
	RotateCcw,
	Shield,
	Slash,
	Trash2,
	UserMinus,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { RoleBadge, RoleSelect } from "../components/RoleSelect";

interface CommandLeaf {
	name: string;
	description: string;
	group: string;
}

interface PermissionRule {
	name: string;
	enabled: boolean;
	allowedRoles: string[];
	deniedRoles: string[];
	deniedUsers: string[];
}

const GLOBAL_KEY = "*";

export function Commands() {
	const qc = useQueryClient();

	const commands = useQuery({
		queryKey: ["bot", "commands", "expanded"],
		queryFn: () => api.get<{ commands: CommandLeaf[] }>("/bot/commands/expanded"),
		staleTime: 60_000,
	});

	const rules = useQuery({
		queryKey: ["commands", "permissions"],
		queryFn: () => api.get<{ rules: PermissionRule[] }>("/bot/commands/permissions"),
		staleTime: 30_000,
	});

	const upsert = useMutation({
		mutationFn: (rule: PermissionRule) => api.post("/bot/commands/permissions", rule),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["commands", "permissions"] }),
	});
	const remove = useMutation({
		mutationFn: (name: string) => api.post("/bot/commands/permissions/delete", { name }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["commands", "permissions"] }),
	});

	const ruleByName = useMemo(() => {
		const m = new Map<string, PermissionRule>();
		for (const r of rules.data?.rules ?? []) m.set(r.name, r);
		return m;
	}, [rules.data]);

	const groups = useMemo(() => {
		const list = commands.data?.commands ?? [];
		const m = new Map<string, CommandLeaf[]>();
		for (const c of list) {
			if (!m.has(c.group)) m.set(c.group, []);
			m.get(c.group)!.push(c);
		}
		return [...m.entries()]
			.map(([group, items]) => ({
				group,
				items: items.toSorted((a, b) => a.name.localeCompare(b.name)),
			}))
			.toSorted((a, b) => a.group.localeCompare(b.group));
	}, [commands.data]);

	const overriddenCount = ruleByName.size - (ruleByName.has(GLOBAL_KEY) ? 1 : 0);
	const globalRule = ruleByName.get(GLOBAL_KEY);

	if (commands.isLoading || rules.isLoading) {
		return <div className="text-zinc-500">Chargement des commandes…</div>;
	}

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<Slash className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Permissions des commandes</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					{commands.data?.commands.length ?? 0} commandes · {overriddenCount} règle
					{overriddenCount > 1 ? "s" : ""} active
					{overriddenCount > 1 ? "s" : ""}. Le owner et les membres avec la permission Discord{" "}
					<strong>Administrator</strong> bypassent toujours les règles.
				</p>
				<p className="mt-2 text-xs text-zinc-500">
					Cache bot 30 s. Lookup hiérarchique : règle exacte (<code>admin reload</code>) → joker du
					groupe (<code>admin *</code>) → joker global (<code>*</code>).
				</p>
			</div>

			<GlobalRuleCard
				rule={globalRule}
				onSet={(r) => upsert.mutate(r)}
				onUnset={() => remove.mutate(GLOBAL_KEY)}
				pending={upsert.isPending || remove.isPending}
			/>

			{groups.map(({ group, items }) => (
				<GroupSection
					key={group}
					group={group}
					items={items}
					ruleByName={ruleByName}
					onSet={(r) => upsert.mutate(r)}
					onUnset={(name) => remove.mutate(name)}
					pending={upsert.isPending || remove.isPending}
				/>
			))}
		</div>
	);
}

function GlobalRuleCard({
	rule,
	onSet,
	onUnset,
	pending,
}: {
	rule: PermissionRule | undefined;
	onSet: (rule: PermissionRule) => void;
	onUnset: () => void;
	pending: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="card p-0">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-zinc-900/40"
			>
				<Shield className="h-5 w-5 shrink-0 text-amber-400" />
				<div className="flex-1">
					<h3 className="font-semibold">Règle globale (joker *)</h3>
					<p className="text-xs text-zinc-500">
						S'applique à toute commande sans règle plus spécifique.
					</p>
				</div>
				{rule ? (
					<span className="badge badge-warning">active</span>
				) : (
					<span className="text-xs text-zinc-500">aucune</span>
				)}
				<ChevronDown
					className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div className="border-t border-zinc-800 p-4">
					<RuleEditor
						name={GLOBAL_KEY}
						label="Joker global"
						rule={rule}
						onSet={onSet}
						onUnset={onUnset}
						pending={pending}
					/>
				</div>
			)}
		</div>
	);
}

function GroupSection({
	group,
	items,
	ruleByName,
	onSet,
	onUnset,
	pending,
}: {
	group: string;
	items: CommandLeaf[];
	ruleByName: Map<string, PermissionRule>;
	onSet: (rule: PermissionRule) => void;
	onUnset: (name: string) => void;
	pending: boolean;
}) {
	const [open, setOpen] = useState(false);
	const wildcardName = `${group} *`;
	const wildcardRule = ruleByName.get(wildcardName);
	const overridden = items.filter((c) => ruleByName.has(c.name)).length + (wildcardRule ? 1 : 0);
	const hasMultipleLeaves = items.length > 1 || items[0]?.name !== group;

	return (
		<div className="card p-0">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-zinc-900/40"
			>
				<Slash className="h-5 w-5 shrink-0 text-brand-400" />
				<div className="flex-1">
					<h3 className="font-semibold">/{group}</h3>
					<p className="text-xs text-zinc-500">
						{items.length} commande{items.length > 1 ? "s" : ""}
					</p>
				</div>
				<span className="badge">
					{overridden} / {items.length + (hasMultipleLeaves ? 1 : 0)}
				</span>
				<ChevronDown
					className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div className="space-y-3 border-t border-zinc-800 p-4">
					{hasMultipleLeaves && (
						<RuleEditor
							name={wildcardName}
							label={`Joker ${group} *`}
							description={`S'applique à toute sous-commande de /${group} sans règle exacte.`}
							rule={wildcardRule}
							onSet={onSet}
							onUnset={() => onUnset(wildcardName)}
							pending={pending}
						/>
					)}
					{items.map((c) => (
						<RuleEditor
							key={c.name}
							name={c.name}
							label={`/${c.name}`}
							description={c.description}
							rule={ruleByName.get(c.name)}
							onSet={onSet}
							onUnset={() => onUnset(c.name)}
							pending={pending}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function RuleEditor({
	name,
	label,
	description,
	rule,
	onSet,
	onUnset,
	pending,
}: {
	name: string;
	label: string;
	description?: string;
	rule: PermissionRule | undefined;
	onSet: (rule: PermissionRule) => void;
	onUnset: () => void;
	pending: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<PermissionRule>(() => ({
		name,
		enabled: rule?.enabled ?? true,
		allowedRoles: rule?.allowedRoles ?? [],
		deniedRoles: rule?.deniedRoles ?? [],
		deniedUsers: rule?.deniedUsers ?? [],
	}));

	const isOverridden = !!rule;
	const summary = summarizeRule(rule);

	function startEdit() {
		setDraft({
			name,
			enabled: rule?.enabled ?? true,
			allowedRoles: rule?.allowedRoles ?? [],
			deniedRoles: rule?.deniedRoles ?? [],
			deniedUsers: rule?.deniedUsers ?? [],
		});
		setEditing(true);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
			<div className="flex items-start gap-3">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<code className="text-sm font-medium">{label}</code>
						{isOverridden && (
							<span className={`badge ${rule?.enabled ? "badge-warning" : "badge-error"}`}>
								{rule?.enabled ? "règle active" : "désactivée"}
							</span>
						)}
					</div>
					{description && <p className="mt-0.5 text-xs text-zinc-400">{description}</p>}
					{summary && <p className="mt-1 text-xs text-zinc-500">{summary}</p>}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onClick={editing ? () => setEditing(false) : startEdit}
						className="btn btn-ghost px-2"
					>
						{editing ? "Fermer" : isOverridden ? "Modifier" : "Définir"}
					</button>
					{isOverridden && (
						<button
							type="button"
							onClick={onUnset}
							className="btn btn-ghost px-2 text-red-400"
							title="Supprimer la règle (retour au défaut)"
							disabled={pending}
						>
							<RotateCcw className="h-3 w-3" />
						</button>
					)}
				</div>
			</div>
			{editing && (
				<div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={draft.enabled}
							onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
							className="h-4 w-4 accent-brand-500"
						/>
						<Power className="h-4 w-4 text-zinc-500" />
						<span>
							Commande activée
							<span className="ml-1 text-xs text-zinc-500">
								(décocher → désactivée pour tout le monde sauf bypass)
							</span>
						</span>
					</label>

					<RoleListEditor
						label="Rôles autorisés"
						hint="Si non vide, le membre doit avoir au moins un de ces rôles."
						icon={<Shield className="h-4 w-4 text-emerald-400" />}
						roles={draft.allowedRoles}
						onChange={(roles) => setDraft({ ...draft, allowedRoles: roles })}
					/>

					<RoleListEditor
						label="Rôles interdits"
						hint="Si le membre a un de ces rôles, refus immédiat."
						icon={<Lock className="h-4 w-4 text-red-400" />}
						roles={draft.deniedRoles}
						onChange={(roles) => setDraft({ ...draft, deniedRoles: roles })}
					/>

					<UserIdListEditor
						label="Utilisateurs interdits"
						hint="ID Discord (snowflake 17-20 chiffres)."
						icon={<UserMinus className="h-4 w-4 text-red-400" />}
						users={draft.deniedUsers}
						onChange={(users) => setDraft({ ...draft, deniedUsers: users })}
					/>

					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => {
								onSet(draft);
								setEditing(false);
							}}
							disabled={pending}
							className="btn btn-primary"
						>
							Enregistrer
						</button>
						<button type="button" onClick={() => setEditing(false)} className="btn btn-ghost">
							Annuler
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function summarizeRule(rule: PermissionRule | undefined): string {
	if (!rule) return "";
	const parts: string[] = [];
	if (!rule.enabled) parts.push("désactivée");
	if (rule.allowedRoles.length > 0)
		parts.push(
			`${rule.allowedRoles.length} rôle${rule.allowedRoles.length > 1 ? "s" : ""} autorisé${rule.allowedRoles.length > 1 ? "s" : ""}`
		);
	if (rule.deniedRoles.length > 0)
		parts.push(
			`${rule.deniedRoles.length} rôle${rule.deniedRoles.length > 1 ? "s" : ""} interdit${rule.deniedRoles.length > 1 ? "s" : ""}`
		);
	if (rule.deniedUsers.length > 0)
		parts.push(
			`${rule.deniedUsers.length} user${rule.deniedUsers.length > 1 ? "s" : ""} interdit${rule.deniedUsers.length > 1 ? "s" : ""}`
		);
	return parts.join(" · ");
}

function RoleListEditor({
	label,
	hint,
	icon,
	roles,
	onChange,
}: {
	label: string;
	hint: string;
	icon: React.ReactNode;
	roles: string[];
	onChange: (roles: string[]) => void;
}) {
	const [pick, setPick] = useState("");
	return (
		<div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
			<div className="mb-2 flex items-center gap-2">
				{icon}
				<span className="text-sm font-medium">{label}</span>
				<span className="text-xs text-zinc-500">({roles.length})</span>
			</div>
			<p className="mb-2 text-xs text-zinc-500">{hint}</p>
			{roles.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-2">
					{roles.map((id) => (
						<span
							key={id}
							className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-xs"
						>
							<RoleBadge roleId={id} />
							<button
								type="button"
								onClick={() => onChange(roles.filter((r) => r !== id))}
								className="text-zinc-500 hover:text-red-400"
								title="Retirer"
							>
								<X className="h-3 w-3" />
							</button>
						</span>
					))}
				</div>
			)}
			<div className="flex items-center gap-2">
				<RoleSelect value={pick} onChange={setPick} className="flex-1" />
				<button
					type="button"
					onClick={() => {
						if (!pick || roles.includes(pick)) return;
						onChange([...roles, pick]);
						setPick("");
					}}
					disabled={!pick || roles.includes(pick)}
					className="btn btn-ghost"
				>
					Ajouter
				</button>
			</div>
		</div>
	);
}

function UserIdListEditor({
	label,
	hint,
	icon,
	users,
	onChange,
}: {
	label: string;
	hint: string;
	icon: React.ReactNode;
	users: string[];
	onChange: (users: string[]) => void;
}) {
	const [pick, setPick] = useState("");
	const valid = /^\d{17,20}$/.test(pick);
	return (
		<div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
			<div className="mb-2 flex items-center gap-2">
				{icon}
				<span className="text-sm font-medium">{label}</span>
				<span className="text-xs text-zinc-500">({users.length})</span>
			</div>
			<p className="mb-2 text-xs text-zinc-500">{hint}</p>
			{users.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-2">
					{users.map((id) => (
						<span
							key={id}
							className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 font-mono text-xs"
						>
							{id}
							<button
								type="button"
								onClick={() => onChange(users.filter((u) => u !== id))}
								className="text-zinc-500 hover:text-red-400"
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</span>
					))}
				</div>
			)}
			<div className="flex items-center gap-2">
				<input
					value={pick}
					onChange={(e) => setPick(e.target.value)}
					placeholder="ID Discord (17-20 chiffres)"
					className="input flex-1 font-mono text-xs"
				/>
				<button
					type="button"
					onClick={() => {
						if (!valid || users.includes(pick)) return;
						onChange([...users, pick]);
						setPick("");
					}}
					disabled={!valid || users.includes(pick)}
					className="btn btn-ghost"
				>
					Ajouter
				</button>
			</div>
		</div>
	);
}
