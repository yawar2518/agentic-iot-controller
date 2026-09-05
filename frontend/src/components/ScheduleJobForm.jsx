import { useState } from "react";
import "./ScheduleJobForm.css";

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export default function ScheduleJobForm({ initial, submitting, error, onSubmit, onCancel }) {
  const isEdit = initial != null;
  const [state, setState] = useState(initial?.state === "off" ? "off" : "on");
  const [time, setTime] = useState(initial?.at_24h ?? "");
  const [touched, setTouched] = useState(false);

  const timeValid = TIME_RE.test(time);
  const showTimeError = touched && !timeValid;

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!timeValid) return;
    onSubmit({ state, time_str: time });
  };

  return (
    <form className="job-form" onSubmit={handleSubmit}>
      <div className="job-form-field">
        <label className="job-form-label">Action</label>
        <div className="job-form-toggle">
          <button
            type="button"
            className={`job-form-toggle-btn ${state === "on" ? "job-form-toggle-btn--active" : ""}`}
            disabled={submitting}
            onClick={() => setState("on")}
          >
            Turn ON
          </button>
          <button
            type="button"
            className={`job-form-toggle-btn ${state === "off" ? "job-form-toggle-btn--active" : ""}`}
            disabled={submitting}
            onClick={() => setState("off")}
          >
            Turn OFF
          </button>
        </div>
      </div>

      <div className="job-form-field">
        <label className="job-form-label" htmlFor="job-form-time">Time (24h, PKT)</label>
        <input
          id="job-form-time"
          type="time"
          className="job-form-time-input"
          value={time}
          disabled={submitting}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {showTimeError && <div className="job-form-hint job-form-hint--error">Pick a valid time.</div>}
      </div>

      {error && <div className="job-form-hint job-form-hint--error">{error}</div>}

      <div className="job-form-actions">
        <button type="button" className="job-form-btn job-form-btn--secondary" disabled={submitting} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="job-form-btn job-form-btn--primary" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add job"}
        </button>
      </div>
    </form>
  );
}
