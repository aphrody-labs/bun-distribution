import { Icon, Button, CircleButton } from "@aphrody/m3-primitives";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJobsContext } from "../hooks/JobsContext";
import { JobRow } from "./JobRow";

export function JobsScreen() {
  const navigate = useNavigate();
  const { jobs, pause, resume, cancel, isLoading, error } = useJobsContext();
  const [showOnlyRunning, setShowOnlyRunning] = useState(false);

  // Filter jobs based on toggle
  const filteredJobs = showOnlyRunning
    ? jobs.filter(
        (job) =>
          job.status === "running" ||
          job.status === "paused" ||
          job.status === "queued",
      )
    : jobs;

  // Group jobs by status
  const runningJobs = filteredJobs.filter((j) => j.status === "running");
  const pausedJobs = filteredJobs.filter((j) => j.status === "paused");
  const queuedJobs = filteredJobs.filter((j) => j.status === "queued");
  const completedJobs = filteredJobs.filter((j) => j.status === "completed");
  const failedJobs = filteredJobs.filter((j) => j.status === "failed");
  const cancelledJobs = filteredJobs.filter((j) => j.status === "cancelled");

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface-container border-b border-outline-variant">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-headline-small text-on-surface">Jobs</h1>
            <div className="flex items-center gap-2 text-label-large text-on-surface-variant">
              <span>{jobs.length} total</span>
              {runningJobs.length > 0 && (
                <>
                  <span>•</span>
                  <span>{runningJobs.length} running</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter toggle */}
            <CircleButton
              icon="filter_list"
              active={showOnlyRunning}
              onClick={() => setShowOnlyRunning(!showOnlyRunning)}
              title={
                showOnlyRunning ? "Show all jobs" : "Show only active jobs"
              }
            />

            {/* Back button */}
            <CircleButton
              icon="close"
              onClick={() => navigate(-1)}
              title="Go back"
            />
          </div>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-4 px-4 py-2 text-label-medium text-on-surface-variant bg-surface-container-low border-t border-outline-variant">
          <div className="flex-shrink-0 w-10" /> {/* Icon spacer */}
          <div className="flex-1 min-w-0 flex items-center gap-6">
            <div className="flex-1">Name</div>
            <div className="flex-shrink-0 w-32">Duration</div>
            <div className="flex-shrink-0 w-24 text-right">Time</div>
            <div className="flex-shrink-0 w-20 text-right">Status</div>
          </div>
          <div className="flex-shrink-0 w-6" /> {/* Action button spacer */}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && jobs.length === 0 ? (
          <output className="block p-6 text-label-large text-on-surface-variant">
            Chargement…
          </output>
        ) : error && jobs.length === 0 ? (
          <div className="m-4 flex items-center gap-3 rounded-medium bg-error-container p-4 text-on-error-container">
            <p role="alert" className="text-label-large">
              Chargement des tâches impossible.
            </p>
            <Button
              aria-label="Paramètres"
              title="Paramètres"
              variant="text"
              size="lg"
              className="text-on-error-container"
              onClick={() => navigate("/settings")}
            >
              <Icon name="settings" size={18} />
            </Button>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-body-medium text-on-surface-variant">
                No jobs found
              </p>
            </div>
          </div>
        ) : (
          <div>
            {/* Running Jobs */}
            {runningJobs.length > 0 && (
              <JobSection title="Running" count={runningJobs.length}>
                {runningJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </JobSection>
            )}

            {/* Paused Jobs */}
            {pausedJobs.length > 0 && (
              <JobSection title="Paused" count={pausedJobs.length}>
                {pausedJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </JobSection>
            )}

            {/* Queued Jobs */}
            {queuedJobs.length > 0 && (
              <JobSection title="Queued" count={queuedJobs.length}>
                {queuedJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </JobSection>
            )}

            {/* Completed Jobs */}
            {completedJobs.length > 0 && (
              <JobSection title="Completed" count={completedJobs.length}>
                {completedJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </JobSection>
            )}

            {/* Failed Jobs */}
            {failedJobs.length > 0 && (
              <JobSection title="Failed" count={failedJobs.length}>
                {failedJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </JobSection>
            )}

            {cancelledJobs.length > 0 && (
              <JobSection title="Cancelled" count={cancelledJobs.length}>
                {cancelledJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </JobSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface JobSectionProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

function JobSection({ title, count, children }: JobSectionProps) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b border-outline-variant">
        <h2 className="text-title-small text-on-surface">{title}</h2>
        <span className="text-body-small text-on-surface-variant">
          ({count})
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}
