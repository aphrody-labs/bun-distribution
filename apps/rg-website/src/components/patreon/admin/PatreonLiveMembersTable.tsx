"use client";

import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronDown, ChevronRight, ExternalLink, MapPin, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";

import type { LiveMember } from "@/lib/patreon/live";

type StatusFilter = "all" | "active" | "former" | "declined" | "former_paid" | "no_status";

interface Props {
  members: LiveMember[];
  tierOptions: string[];
}

interface StatusCfg {
  label: string;
  cls: string;
}
const STATUS_ACTIVE: StatusCfg = {
  cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  label: "Actif",
};
const STATUS_DECLINED: StatusCfg = {
  cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  label: "Décliné",
};
const STATUS_FORMER: StatusCfg = {
  cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  label: "Ancien",
};
const STATUS_LABEL: Record<string, StatusCfg> = {
  active_patron: STATUS_ACTIVE,
  declined_patron: STATUS_DECLINED,
  former_patron: STATUS_FORMER,
};

function formatEur(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents === 0) {
    return "—";
  }
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  try {
    return format(new Date(iso), "d MMM yyyy", { locale: fr });
  } catch {
    return "—";
  }
}

function formatAddress(addr: LiveMember["address"]): string | null {
  if (!addr) {
    return null;
  }
  const candidates: (string | null | undefined)[] = [
    addr.addressee,
    addr.line_1,
    addr.line_2,
    [addr.postal_code, addr.city].filter(Boolean).join(" "),
    addr.state,
    addr.country,
  ];
  const parts = candidates.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function PatreonLiveMembersTable({ members, tierOptions }: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tier, setTier] = useState<string>("all");
  const [withAddress, setWithAddress] = useState(false);
  const [withDiscord, setWithDiscord] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return members.filter((m) => {
      if (status !== "all") {
        if (status === "active" && m.patron_status !== "active_patron") {
          return false;
        }
        if (status === "former" && m.patron_status !== "former_patron") {
          return false;
        }
        if (status === "declined" && m.patron_status !== "declined_patron") {
          return false;
        }
        if (
          status === "former_paid" &&
          !(
            (m.patron_status === "former_patron" || m.patron_status === "declined_patron") &&
            m.lifetime_support_cents > 0
          )
        ) {
          return false;
        }
        if (status === "no_status" && m.patron_status !== null) {
          return false;
        }
      }
      if (tier !== "all" && !m.tier_titles.includes(tier)) {
        return false;
      }
      if (withAddress && !m.address) {
        return false;
      }
      if (withDiscord && !m.discord_user_id) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        (m.full_name ?? "").toLowerCase().includes(needle) ||
        (m.email ?? "").toLowerCase().includes(needle) ||
        (m.discord_user_id ?? "").toLowerCase().includes(needle) ||
        (m.patreon_user_id ?? "").toLowerCase().includes(needle)
      );
    });
  }, [members, q, status, tier, withAddress, withDiscord]);

  const counts = useMemo(() => {
    let active = 0;
    let former = 0;
    let declined = 0;
    let formerPaid = 0;
    let totalLifetime = 0;
    for (const m of members) {
      if (m.patron_status === "active_patron") {
        active++;
      } else if (m.patron_status === "former_patron") {
        former++;
      } else if (m.patron_status === "declined_patron") {
        declined++;
      }
      if (
        (m.patron_status === "former_patron" || m.patron_status === "declined_patron") &&
        m.lifetime_support_cents > 0
      ) {
        formerPaid++;
      }
      totalLifetime += m.lifetime_support_cents;
    }
    return { active, declined, former, formerPaid, totalLifetime };
  }, [members]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge className={STATUS_ACTIVE.cls}>{counts.active} actifs</Badge>
        <Badge className={STATUS_FORMER.cls}>{counts.former} anciens</Badge>
        <Badge className={STATUS_DECLINED.cls}>{counts.declined} déclinés</Badge>
        <Badge variant="outline">{counts.formerPaid} anciens ayant déjà payé</Badge>
        <span className="text-muted-foreground">LTV total : {formatEur(counts.totalLifetime)}</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher : nom, email, Discord ID, Patreon ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="active">Actifs</SelectItem>
            <SelectItem value="former">Anciens</SelectItem>
            <SelectItem value="declined">Déclinés</SelectItem>
            <SelectItem value="former_paid">Ont déjà payé (LTV {">"} 0)</SelectItem>
            <SelectItem value="no_status">Sans statut</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous tiers</SelectItem>
            {tierOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={withDiscord ? "default" : "outline"}
          size="sm"
          onClick={() => setWithDiscord((v) => !v)}
        >
          Avec Discord
        </Button>
        <Button
          type="button"
          variant={withAddress ? "default" : "outline"}
          size="sm"
          onClick={() => setWithAddress((v) => !v)}
        >
          <MapPin className="mr-1.5 h-3.5 w-3.5" />
          Avec adresse
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-3">
                <span className="sr-only">Afficher les détails</span>
              </th>
              <th className="px-4 py-3 font-medium">Membre</th>
              <th className="px-4 py-3 font-medium">Discord</th>
              <th className="px-4 py-3 font-medium">Tier(s)</th>
              <th className="px-4 py-3 font-medium">Pledge</th>
              <th className="px-4 py-3 font-medium">LTV</th>
              <th className="px-4 py-3 font-medium">Dernier paiement</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Adresse</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const statusCfg = m.patron_status ? STATUS_LABEL[m.patron_status] : null;
              const isExpanded = expanded === m.id;
              const addrLine = formatAddress(m.address);
              return (
                <>
                  <tr
                    key={m.id}
                    className="border-t border-border/40 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-2 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : m.id)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Détails"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {m.patreon_thumb_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.patreon_thumb_url}
                            alt=""
                            className="size-8 shrink-0 rounded-full bg-muted object-cover"
                          />
                        ) : (
                          <div className="size-8 shrink-0 rounded-full bg-muted" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{m.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{m.email ?? "—"}</div>
                          {m.patreon_url && (
                            <a
                              href={m.patreon_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/60 hover:text-foreground"
                            >
                              patreon
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {m.discord_user_id ? (
                        <div>
                          <div className="font-mono text-foreground">{m.discord_user_id}</div>
                          {m.discord_role_ids.length > 0 && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {m.discord_role_ids.length} rôle
                              {m.discord_role_ids.length > 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.tier_titles.length > 0 ? (
                        <div className="space-y-0.5">
                          {m.tier_titles.map((t) => (
                            <div
                              key={t}
                              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                            >
                              <Star className="size-3 text-amber-500" />
                              {t}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {formatEur(m.currently_entitled_cents)}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                      {formatEur(m.lifetime_support_cents)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-foreground">{formatDate(m.last_charge_date)}</div>
                      {m.last_charge_status && (
                        <div
                          className={
                            m.last_charge_status === "Paid"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }
                        >
                          {m.last_charge_status}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {statusCfg ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.cls}`}
                        >
                          {statusCfg.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                      {m.is_gifted && (
                        <div className="mt-1 text-[10px] text-violet-600 dark:text-violet-400">
                          gift
                        </div>
                      )}
                      {m.is_free_trial && (
                        <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                          trial
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {addrLine ? (
                        <span title={addrLine}>
                          <MapPin className="mr-1 inline size-3 text-emerald-500" />
                          {m.address?.country ?? "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${m.id}-detail`} className="bg-muted/20">
                      <td aria-hidden="true" />
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
                          <DetailBlock title="Identité Patreon">
                            <DetailRow label="Patreon user ID" value={m.patreon_user_id} mono />
                            <DetailRow label="Member ID" value={m.id} mono />
                            <DetailRow label="Pledge depuis" value={formatDate(m.pledge_start)} />
                            <DetailRow
                              label="Cadence"
                              value={
                                m.pledge_cadence === 1
                                  ? "mensuelle"
                                  : m.pledge_cadence === 12
                                    ? "annuelle"
                                    : "—"
                              }
                            />
                            <DetailRow
                              label="Prochaine charge"
                              value={formatDate(m.next_charge_date)}
                            />
                            <DetailRow
                              label="Will pay"
                              value={formatEur(m.will_pay_amount_cents)}
                            />
                          </DetailBlock>

                          <DetailBlock title="Discord">
                            <DetailRow label="User ID" value={m.discord_user_id} mono />
                            <div>
                              <div className="text-muted-foreground">
                                Rôles tier ({m.discord_role_ids.length})
                              </div>
                              <div className="mt-1 space-y-0.5">
                                {m.discord_role_ids.length === 0 ? (
                                  <span className="text-muted-foreground/50">—</span>
                                ) : (
                                  m.discord_role_ids.map((r) => (
                                    <div key={r} className="font-mono text-[10px] text-foreground">
                                      {r}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </DetailBlock>

                          <DetailBlock title="Adresse">
                            {m.address ? (
                              <>
                                <DetailRow label="Destinataire" value={m.address.addressee} />
                                <DetailRow label="Ligne 1" value={m.address.line_1} />
                                {m.address.line_2 && (
                                  <DetailRow label="Ligne 2" value={m.address.line_2} />
                                )}
                                <DetailRow label="Code postal" value={m.address.postal_code} />
                                <DetailRow label="Ville" value={m.address.city} />
                                <DetailRow label="Région" value={m.address.state} />
                                <DetailRow label="Pays" value={m.address.country} />
                                <DetailRow label="Téléphone" value={m.address.phone_number} />
                              </>
                            ) : (
                              <span className="text-muted-foreground/50">
                                Aucune adresse renseignée.
                              </span>
                            )}
                          </DetailBlock>

                          {m.note && (
                            <DetailBlock title="Note Patreon" full>
                              <p className="whitespace-pre-wrap text-foreground/80">{m.note}</p>
                            </DetailBlock>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  Aucun membre ne correspond à ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} / {members.length} membre
        {members.length > 1 ? "s" : ""}
      </p>
    </div>
  );
}

function DetailBlock({
  title,
  children,
  full,
}: {
  title: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-border/60 bg-background p-3 ${
        full ? "sm:col-span-2 lg:col-span-3" : ""
      }`}
    >
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right text-foreground ${mono ? "font-mono text-[10px]" : ""}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}
