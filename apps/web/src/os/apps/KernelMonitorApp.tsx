// SPDX-License-Identifier: Apache-2.0
/**
 * System monitor on measured values only (GET /api/webos/system, read by the Bun server from node:os,
 * process, /proc and /sys). A value the host does not expose is shown as unavailable with its reason.
 */
import React, { useState } from "react";
import { formatBytes, formatDuration, UNAVAILABLE, useSystemSnapshot } from "../system-client";

type Tab = "overview" | "memory" | "network" | "sysctl";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "memory", label: "Mémoire & swap" },
  { id: "network", label: "Réseau" },
  { id: "sysctl", label: "sysctl" },
];

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-1 border-b border-[var(--md-sys-color-outline-variant)]/40">
    <span className="text-[var(--md-sys-color-on-surface-variant)]">{label}</span>
    <span className="text-[var(--md-sys-color-on-surface)] font-bold text-right break-all">{value}</span>
  </div>
);

const Bar: React.FC<{ percent: number | null }> = ({ percent }) => (
  <div className="h-2 w-full rounded-full bg-[var(--md-sys-color-surface-container-highest)] overflow-hidden">
    {percent !== null && (
      <div
        className="h-full bg-[var(--md-sys-color-primary)]"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    )}
  </div>
);

export const KernelMonitorApp: React.FC = () => {
  const { snapshot: snap, error } = useSystemSnapshot(3000);
  const [tab, setTab] = useState<Tab>("overview");

  if (!snap) {
    return (
      <div className="p-6 font-mono text-xs text-[var(--md-sys-color-on-surface-variant)]">
        {error ? `Mesures ${UNAVAILABLE} : ${error}` : "Lecture de /api/webos/system..."}
      </div>
    );
  }

  const memPercent = snap.memory.totalBytes > 0 ? (snap.memory.usedBytes / snap.memory.totalBytes) * 100 : null;

  return (
    <div className="h-full flex flex-col font-mono text-xs">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)]">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1 rounded-full font-semibold transition ${
              tab === t.id
                ? "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]"
                : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
          {error ? `dernière mesure ${snap.measuredAt} (${error})` : `mesuré ${snap.measuredAt}`}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {tab === "overview" && (
          <>
            <section>
              <Row label="Hôte" value={snap.host.hostname} />
              <Row label="Système" value={snap.linux?.distribution ?? `${snap.host.type} ${snap.host.version}`} />
              <Row label="Noyau" value={`${snap.host.type} ${snap.host.release}`} />
              <Row label="Architecture" value={`${snap.host.arch} (${snap.host.machine})`} />
              <Row label="Uptime hôte" value={formatDuration(snap.host.uptimeSeconds)} />
              <Row label="Bun" value={`${snap.runtime.bun} (${snap.runtime.revision.slice(0, 12)})`} />
              <Row
                label="Serveur WebOS"
                value={`pid ${snap.runtime.pid}, uptime ${formatDuration(snap.runtime.uptimeSeconds)}`}
              />
            </section>
            <section className="flex flex-col gap-2">
              <Row label="CPU" value={`${snap.cpu.model ?? UNAVAILABLE} × ${snap.cpu.count}`} />
              <Row
                label="Utilisation CPU"
                value={snap.cpu.usagePercent === null ? UNAVAILABLE : `${snap.cpu.usagePercent} %`}
              />
              <Bar percent={snap.cpu.usagePercent} />
              <Row
                label="Charge 1/5/15 min"
                value={snap.cpu.loadAverage ? snap.cpu.loadAverage.map(n => n.toFixed(2)).join(" / ") : UNAVAILABLE}
              />
            </section>
          </>
        )}

        {tab === "memory" && (
          <>
            <section className="flex flex-col gap-2">
              <Row
                label="Mémoire hôte"
                value={`${formatBytes(snap.memory.usedBytes)} / ${formatBytes(snap.memory.totalBytes)}`}
              />
              <Bar percent={memPercent} />
              <Row label="Libre" value={formatBytes(snap.memory.freeBytes)} />
              <Row label="RSS serveur" value={formatBytes(snap.memory.process.rssBytes)} />
              <Row
                label="Tas JS serveur"
                value={`${formatBytes(snap.memory.process.heapUsedBytes)} / ${formatBytes(snap.memory.process.heapTotalBytes)}`}
              />
            </section>
            <section>
              <h3 className="font-bold mb-1 text-[var(--md-sys-color-primary)]">Swap (/proc/swaps)</h3>
              {!snap.linux ? (
                <p className="text-[var(--md-sys-color-on-surface-variant)]">{UNAVAILABLE} (hôte non Linux)</p>
              ) : snap.linux.swaps.length === 0 ? (
                <p className="text-[var(--md-sys-color-on-surface-variant)]">aucun périphérique de swap</p>
              ) : (
                snap.linux.swaps.map(s => (
                  <Row
                    key={s.name}
                    label={`${s.name} (${s.type}, prio ${s.priority})`}
                    value={`${formatBytes(s.usedKb * 1024)} / ${formatBytes(s.sizeKb * 1024)}`}
                  />
                ))
              )}
            </section>
            <section>
              <h3 className="font-bold mb-1 text-[var(--md-sys-color-primary)]">zswap</h3>
              {snap.linux?.zswap ? (
                <>
                  <Row label="enabled" value={snap.linux.zswap.enabled} />
                  <Row label="compressor" value={snap.linux.zswap.compressor} />
                  <Row label="zpool" value={snap.linux.zswap.zpool} />
                </>
              ) : (
                <p className="text-[var(--md-sys-color-on-surface-variant)]">{UNAVAILABLE}</p>
              )}
            </section>
          </>
        )}

        {tab === "network" && (
          <section>
            {snap.network.map(nic => (
              <div key={nic.name} className="mb-3">
                <div className="font-bold text-[var(--md-sys-color-primary)]">
                  {nic.name}
                  {nic.internal ? " (loopback)" : ""}
                </div>
                {nic.addresses.map(a => (
                  <Row key={`${a.family}-${a.address}`} label={a.family} value={a.cidr ?? a.address} />
                ))}
              </div>
            ))}
          </section>
        )}

        {tab === "sysctl" && (
          <section>
            {!snap.linux ? (
              <p className="text-[var(--md-sys-color-on-surface-variant)]">
                {UNAVAILABLE} : /proc/sys n'existe que sous Linux (hôte {snap.host.platform}).
              </p>
            ) : (
              Object.entries(snap.linux.sysctl).map(([key, value]) => (
                <Row key={key} label={key} value={value ?? `${UNAVAILABLE} (clé absente de ce noyau)`} />
              ))
            )}
          </section>
        )}

        {snap.unavailable.length > 0 && (
          <section className="mt-auto p-3 rounded-xl bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)]">
            <div className="font-bold mb-1">Non mesurable sur cet hôte</div>
            <ul className="list-disc pl-4">
              {snap.unavailable.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
