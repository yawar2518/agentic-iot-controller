import { useState } from "react";
import "./ScheduleJobForm.css";

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DAYS = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" },
];

/** Today as 'YYYY-MM-DD', used as the date input's minimum. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ScheduleJobForm({ initial, submitting, error, onSubmit, onCancel }) {
  const isEdit = initial != null;
  const [state, setState] = useState(initial?.state === "off" ? "off" : "on");
  const [time, setTime] = useState(initial?.at_24h ?? "");
  const [repeat, setRepeat] = useState(initial?.scheduleType ?? "once"); // "once" | "weekly" | "date"
  const [days, setDays] = useState(initial?.days ?? []);
  const [date, setDate] = useState(initial?.date ?? "");
  const [touched, setTouched] = useState(false);

  const timeValid = TIME_RE.test(time);
  const daysValid = repeat !== "weekly" || days.length > 0;
  const dateValid = repeat !== "date" || date.length > 0;
  const formValid = timeValid && daysValid && dateValid;

  const showTimeError = touched && !timeValid;
  const showDaysError = touched && !daysValid;
  const showDateError = touched && !dateValid;

  const toggleDay = (key) => {
    setDays((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;
    onSubmit({
      state,
      time_str: time,
      schedule_type: repeat,
      days: repeat === "weekly" ? days : null,
      date_str: repeat === "date" ? date : null,
    });
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
        <label className="job-form-label">Repeat</label>
        <div className="job-form-toggle">
          <button
            type="button"
            className={`job-form-toggle-btn ${repeat === "once" ? "job-form-toggle-btn--active" : ""}`}
            disabled={submitting}
            onClick={() => setRepeat("once")}
          >
            Once
          </button>
          <button
            type="button"
            className={`job-form-toggle-btn ${repeat === "weekly" ? "job-form-toggle-btn--active" : ""}`}
            disabled={submitting}
            onClick={() => setRepeat("weekly")}
          >
            Weekly
          </button>
          <button
            type="button"
            className={`job-form-toggle-btn ${repeat === "date" ? "job-form-toggle-btn--active" : ""}`}
            disabled={submitting}
            onClick={() => setRepeat("date")}
          >
            On date
          </button>
        </div>
        {repeat === "once" && <div className="job-form-hint">Fires once — today, or tomorrow if that time already passed.</div>}
      </div>

      {repeat === "weekly" && (
        <div className="job-form-field">
          <label className="job-form-label">Days</label>
          <div className="job-form-days">
            {DAYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={days.includes(key)}
                className={`job-form-day-btn ${days.includes(key) ? "job-form-day-btn--active" : ""}`}
                disabled={submitting}
                onClick={() => toggleDay(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {showDaysError && <div className="job-form-hint job-form-hint--error">Pick at least one day.</div>}
        </div>
      )}

      {repeat === "date" && (
        <div className="job-form-field">
          <label className="job-form-label" htmlFor="job-form-date">Date</label>
          <input
            id="job-form-date"
            type="date"
            className="job-form-time-input"
            value={date}
            min={todayStr()}
            disabled={submitting}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {showDateError && <div className="job-form-hint job-form-hint--error">Pick a date.</div>}
        </div>
      )}

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
