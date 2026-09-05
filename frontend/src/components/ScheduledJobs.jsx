import { useState } from "react";
import "./ScheduledJobs.css";

function JobRow({ job, onEdit, onDelete, busy }) {
  const [confirming, setConfirming] = useState(false);
  const hasTime = job.at != null;
  const isOn = job.state === "on";

  const handleDeleteClick = () => {
    if (confirming) {
      setConfirming(false);
      onDelete(job.number);
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className="job-row">
      <span className={`job-dot ${isOn ? "job-dot--on" : ""}`} />
      <div className="job-row-body">
        <div className="job-label">{job.label}</div>
        {!hasTime && <div className="job-time job-time--unknown">Time unavailable</div>}
      </div>
      {hasTime && <div className="job-time">{job.at}</div>}

      <div className="job-actions">
        {confirming ? (
          <>
            <button
              type="button"
              className="job-action job-action--confirm-delete"
              disabled={busy}
              onClick={handleDeleteClick}
            >
              Confirm
            </button>
            <button
              type="button"
              className="job-action job-action--edit"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {onEdit && (
              <button
                type="button"
                className="job-action job-action--edit"
                aria-label={`Edit: ${job.label}`}
                disabled={busy}
                onClick={() => onEdit(job.number)}
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="job-action job-action--delete"
                aria-label={`Delete: ${job.label}`}
                disabled={busy}
                onClick={handleDeleteClick}
              >
                ×
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ScheduledJobs({ jobs, loading, error, onEdit, onDelete, busyNumber }) {
  const ready = !loading && !error;
  const hasJobs = ready && Array.isArray(jobs) && jobs.length > 0;

  if (loading) {
    return (
      <div className="jobs-skeleton-list">
        <div className="jobs-skeleton" />
        <div className="jobs-skeleton" />
        <div className="jobs-skeleton" />
      </div>
    );
  }

  if (error) {
    return <div className="jobs-empty jobs-empty--error">Couldn't load scheduled jobs.</div>;
  }

  if (!hasJobs) {
    return <div className="jobs-empty">No jobs scheduled</div>;
  }

  return (
    <div className="jobs-list">
      {jobs.map((job) => (
        <JobRow key={job.number} job={job} onEdit={onEdit} onDelete={onDelete} busy={busyNumber === job.number} />
      ))}
    </div>
  );
}
