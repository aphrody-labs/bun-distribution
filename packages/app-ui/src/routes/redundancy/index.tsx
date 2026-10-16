// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright 2026 Spacedrive Technology Inc.
// Adapted from archived Drive routes: index.tsx, at-risk.tsx, compare.tsx,
// and components/RedundancyVolumeBar.tsx in
// drive/packages/interface/src/routes/redundancy/.

import type { SearchFilters, VolumeRedundancySummary } from "@aphrody/drive-client";
import { Button, Icon, m3FocusRing, m3StateLayer } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useLibraryQuery } from "../../contexts/SpacedriveContext";
import { ExplorerView, useExplorer } from "../explorer";

const number = new Intl.NumberFormat();
const bytes = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
  notation: "compact",
  maximumFractionDigits: 1,
});

const blankFilters: SearchFilters = {
  file_types: null,
  tags: null,
  date_range: null,
  size_range: null,
  locations: null,
  content_types: null,
  include_hidden: null,
  include_archived: null,
  at_risk: null,
  on_volumes: null,
  on_all_volumes: null,
  not_on_volumes: null,
  min_volume_count: null,
  max_volume_count: null,
};

function SummaryError({ retry }: { retry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-medium bg-error-container p-4 text-on-error-container">
      <p role="alert" className="text-body-large">
        Redundancy data is unavailable.
      </p>
      <Button
        aria-label="Retry"
        title="Retry"
        variant="text"
        size="lg"
        className="text-on-error-container"
        onClick={retry}
      >
        <Icon name="refresh" size={18} />
      </Button>
    </div>
  );
}

function SummaryLoading() {
  return <output className="block p-4 text-body-large text-on-surface-variant">Loading…</output>;
}

function VolumeCard({ volume }: { volume: VolumeRedundancySummary }) {
  const classifiedBytes = volume.redundant_bytes + volume.at_risk_bytes;
  const redundantPercent =
    classifiedBytes > 0 ? Math.min(100, (volume.redundant_bytes / classifiedBytes) * 100) : 0;
  const atRiskPercent =
    classifiedBytes > 0
      ? Math.min(100 - redundantPercent, (volume.at_risk_bytes / classifiedBytes) * 100)
      : 0;
  const linkClass = clsx(
    "inline-flex min-h-10 items-center rounded-full px-3 text-label-large",
    m3StateLayer,
    m3FocusRing,
  );
  return (
    <article className="rounded-medium border border-outline-variant bg-surface-container-low p-4">
      <h3 className="text-title-medium text-on-surface">
        {volume.display_name || "Unnamed volume"}
      </h3>
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <img> exige un src ; la barre est composée de divs CSS colorés
        role="img"
        aria-label={`${number.format(Math.round(redundantPercent))}% replicated, ${number.format(Math.round(atRiskPercent))}% at risk`}
        className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface-container-highest"
      >
        <div className="bg-success" style={{ width: `${redundantPercent}%` }} />
        <div className="bg-warning" style={{ width: `${atRiskPercent}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-body-large text-on-surface-variant">
        <span>{bytes.format(volume.redundant_bytes)} replicated</span>
        <span aria-hidden="true">·</span>
        <span>{bytes.format(volume.at_risk_bytes)} at risk</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          className={linkClass}
          to={`/redundancy/at-risk?volume=${encodeURIComponent(volume.volume_uuid)}&at_risk=true`}
        >
          At-risk files
        </Link>
        <Link
          className={linkClass}
          to={`/redundancy/at-risk?volume=${encodeURIComponent(volume.volume_uuid)}&at_risk=false`}
        >
          Replicated content
        </Link>
      </div>
    </article>
  );
}

/** Library and per-volume replication summary from the real Drive query. */
export function RedundancyDashboard() {
  const { data, isLoading, error, refetch } = useLibraryQuery({
    type: "redundancy.summary",
    input: {},
  });
  const volumes = data?.volumes ?? [];
  return (
    <section
      aria-labelledby="redundancy-title"
      className="flex h-full min-h-0 flex-col bg-surface text-on-surface"
    >
      <header className="border-b border-outline-variant px-6 py-5">
        <h1 id="redundancy-title" className="text-headline-small">
          Redundancy
        </h1>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {isLoading && <SummaryLoading />}
        {error && <SummaryError retry={() => void refetch()} />}
        {data && !error && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-medium bg-surface-container-low p-4">
                <strong className="block text-headline-large font-normal">
                  {number.format(Math.round(data.library_totals.replication_score * 100))}%
                </strong>
                <span className="text-body-large text-on-surface-variant">Replication score</span>
              </div>
              <Link
                to="/redundancy/at-risk"
                className={clsx(
                  "rounded-medium bg-warning-container p-4 text-on-warning-container",
                  m3StateLayer,
                  m3FocusRing,
                )}
              >
                <strong className="block text-headline-large font-normal">
                  {bytes.format(data.library_totals.total_at_risk_bytes)}
                </strong>
                <span className="text-body-large">
                  At-risk files <Icon name="arrow_forward" size={20} />
                </span>
              </Link>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-title-large">Volumes</h2>
              {volumes.length >= 2 && (
                <Link
                  to="/redundancy/compare"
                  className={clsx(
                    "inline-flex min-h-10 items-center rounded-full px-4 text-label-large text-primary",
                    m3StateLayer,
                    m3FocusRing,
                  )}
                >
                  Compare volumes
                </Link>
              )}
            </div>
            {volumes.length === 0 ? (
              <div className="flex items-center gap-3 p-4 text-body-large text-on-surface-variant">
                <span>No indexed volumes.</span>
                <Link
                  to="/sources"
                  className={clsx("rounded-full px-3 py-2 text-primary", m3StateLayer, m3FocusRing)}
                >
                  Add source
                </Link>
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {volumes.map((volume) => (
                  <VolumeCard key={volume.volume_uuid} volume={volume} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function FilteredExplorer({ filters, label }: { filters: SearchFilters; label: string }) {
  const { enterFilteredMode, exitFilteredMode, mode, setSortBy } = useExplorer();
  useEffect(() => {
    enterFilteredMode(filters, label);
    return () => exitFilteredMode();
  }, [filters, label, enterFilteredMode, exitFilteredMode]);
  const sorted = useRef(false);
  useEffect(() => {
    if (sorted.current) return;
    sorted.current = true;
    setSortBy("size");
  }, [setSortBy]);
  return mode.type === "filtered" && mode.filters === filters ? (
    <ExplorerView />
  ) : (
    <SummaryLoading />
  );
}

/** At-risk and replicated files reuse the full Explorer on a real search filter. */
export function AtRiskFiles() {
  const [searchParams] = useSearchParams();
  const volume = searchParams.get("volume");
  const atRisk = searchParams.get("at_risk") !== "false";
  const { data, isLoading, error, refetch } = useLibraryQuery({
    type: "redundancy.summary",
    input: {},
  });
  const knownVolume = !volume || data?.volumes.some((v) => v.volume_uuid === volume);
  const filters = useMemo<SearchFilters>(
    () => ({
      ...blankFilters,
      at_risk: atRisk,
      on_volumes: volume ? [volume] : null,
    }),
    [atRisk, volume],
  );
  const title = atRisk ? "At-risk files" : "Replicated content";
  return (
    <section
      aria-labelledby="risk-title"
      className="flex h-full min-h-0 flex-col bg-surface text-on-surface"
    >
      <header className="flex items-center gap-3 border-b border-outline-variant px-4 py-3">
        <Link
          to="/redundancy"
          aria-label="Back to redundancy"
          className={clsx(
            "inline-flex size-10 items-center justify-center rounded-full",
            m3StateLayer,
            m3FocusRing,
          )}
        >
          <Icon name="arrow_back" size={20} />
        </Link>
        <h1 id="risk-title" className="text-title-large">
          {title}
        </h1>
      </header>
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <SummaryLoading />
        ) : error ? (
          <SummaryError retry={() => void refetch()} />
        ) : !knownVolume ? (
          <Navigate to="/redundancy" replace />
        ) : (
          <FilteredExplorer filters={filters} label={title} />
        )}
      </div>
    </section>
  );
}

type CompareMode = "unique_a" | "shared" | "unique_b";

/** Pairwise volume comparison uses search filters shared with the archived Drive view. */
export function CompareVolumes() {
  const { data, isLoading, error, refetch } = useLibraryQuery({
    type: "redundancy.summary",
    input: {},
  });
  const [volumeA, setVolumeA] = useState("");
  const [volumeB, setVolumeB] = useState("");
  const [mode, setMode] = useState<CompareMode>("unique_a");
  const volumes = data?.volumes ?? [];
  const validA = volumes.some((volume) => volume.volume_uuid === volumeA);
  const validB = volumes.some((volume) => volume.volume_uuid === volumeB);
  const ready = validA && validB && volumeA !== volumeB;
  const nameA =
    volumes.find((volume) => volume.volume_uuid === volumeA)?.display_name || "Volume A";
  const nameB =
    volumes.find((volume) => volume.volume_uuid === volumeB)?.display_name || "Volume B";
  const filters = useMemo<SearchFilters | null>(() => {
    if (!ready) return null;
    if (mode === "unique_a")
      return { ...blankFilters, on_volumes: [volumeA], not_on_volumes: [volumeB] };
    if (mode === "unique_b")
      return { ...blankFilters, on_volumes: [volumeB], not_on_volumes: [volumeA] };
    return { ...blankFilters, on_all_volumes: [volumeA, volumeB] };
  }, [ready, mode, volumeA, volumeB]);
  const label =
    mode === "unique_a"
      ? `Content on ${nameA}, absent from ${nameB}`
      : mode === "shared"
        ? `Content on both ${nameA} and ${nameB}`
        : `Content on ${nameB}, absent from ${nameA}`;
  const selectClass = clsx(
    "min-h-12 min-w-0 flex-1 rounded-extra-small border border-outline bg-surface px-3 text-body-large text-on-surface",
    m3FocusRing,
  );
  return (
    <section
      aria-labelledby="compare-title"
      className="flex h-full min-h-0 flex-col bg-surface text-on-surface"
    >
      <header className="flex items-center gap-3 border-b border-outline-variant px-4 py-3">
        <Link
          to="/redundancy"
          aria-label="Back to redundancy"
          className={clsx(
            "inline-flex size-10 items-center justify-center rounded-full",
            m3StateLayer,
            m3FocusRing,
          )}
        >
          <Icon name="arrow_back" size={20} />
        </Link>
        <h1 id="compare-title" className="text-title-large">
          Compare volumes
        </h1>
      </header>
      {isLoading ? (
        <SummaryLoading />
      ) : error ? (
        <SummaryError retry={() => void refetch()} />
      ) : (
        <>
          {volumes.length < 2 ? (
            <div className="flex items-center gap-3 p-4 text-body-large text-on-surface-variant">
              <span>Two indexed volumes are needed.</span>
              <Link
                to="/sources"
                className={clsx("rounded-full px-3 py-2 text-primary", m3StateLayer, m3FocusRing)}
              >
                Add source
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-3 border-b border-outline-variant bg-surface-container-low p-4">
                <div className="flex flex-wrap gap-3">
                  <label className="flex min-w-48 flex-1 flex-col gap-1 text-body-large">
                    First volume
                    <select
                      className={selectClass}
                      value={volumeA}
                      onChange={(event) => setVolumeA(event.target.value)}
                    >
                      <option value="">Select volume</option>
                      {volumes.map((volume) => (
                        <option
                          key={volume.volume_uuid}
                          value={volume.volume_uuid}
                          disabled={volume.volume_uuid === volumeB}
                        >
                          {volume.display_name || "Unnamed volume"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-48 flex-1 flex-col gap-1 text-body-large">
                    Second volume
                    <select
                      className={selectClass}
                      value={volumeB}
                      onChange={(event) => setVolumeB(event.target.value)}
                    >
                      <option value="">Select volume</option>
                      {volumes.map((volume) => (
                        <option
                          key={volume.volume_uuid}
                          value={volume.volume_uuid}
                          disabled={volume.volume_uuid === volumeA}
                        >
                          {volume.display_name || "Unnamed volume"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {ready && (
                  <fieldset aria-label="Comparison" className="flex min-w-0 flex-wrap gap-2">
                    {(["unique_a", "shared", "unique_b"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={mode === option}
                        onClick={() => setMode(option)}
                        className={clsx(
                          "min-h-10 rounded-full px-4 text-label-large",
                          m3StateLayer,
                          m3FocusRing,
                          mode === option
                            ? "bg-secondary-container text-on-secondary-container"
                            : "border border-outline text-on-surface",
                        )}
                      >
                        {option === "unique_a"
                          ? `On ${nameA}, not ${nameB}`
                          : option === "shared"
                            ? "On both"
                            : `On ${nameB}, not ${nameA}`}
                      </button>
                    ))}
                  </fieldset>
                )}
              </div>
              <div className="min-h-0 flex-1">
                {filters ? (
                  <FilteredExplorer filters={filters} label={label} />
                ) : (
                  <p className="p-4 text-body-large text-on-surface-variant">Select two volumes.</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
