import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
});

/**
 * Mock jobs shaped exactly like GET /schedule — see bridge/scheduler.py:_describe.
 * Mutable so mock cancelJob() can actually remove an entry, mirroring how the
 * real backend's list shrinks after a DELETE. `number` is re-derived from
 * position on every read, matching _sorted_jobs()'s 1-indexed renumbering.
 */
let mockScheduledJobs = [
  { state: "off", at: "4:00 PM", at_24h: "16:00", in_minutes: 37, label: "Turn the fan OFF at 4:00 PM" },
  { state: "on", at: "7:30 PM", at_24h: "19:30", in_minutes: 247, label: "Turn the fan ON at 7:30 PM" },
  { state: "off", at: "9:00 PM", at_24h: "21:00", in_minutes: 337, label: "Turn the fan OFF at 9:00 PM" },
  { state: "on", at: "6:00 AM", at_24h: "06:00", in_minutes: 780, label: "Turn the fan ON at 6:00 AM" },
];

/** '16:00' -> '4:00 PM', matching bridge/scheduler.py's _fmt_12h (no leading zero). */
function formatTime12h(time_str) {
  const [h, m] = time_str.split(":").map(Number);
  const meridiem = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** Mirrors bridge/scheduler.py:_format_days_label so mock mode reads the same. */
function formatDaysLabel(days) {
  const ordered = WEEKDAYS.filter((d) => days.includes(d));
  if (ordered.length === 7) return "every day";
  if (ordered.join(",") === WEEKDAYS.slice(0, 5).join(",")) return "on weekdays";
  if (ordered.join(",") === WEEKDAYS.slice(5).join(",")) return "on weekends";
  return "every " + ordered.map((d) => DAY_LABELS[d]).join(", ");
}

/** Builds a mock job entry matching normalizeScheduledJob's expectations for any schedule type. */
function buildMockJob({ state, time_str, schedule_type = "once", days = null, date_str = null }) {
  const at = formatTime12h(time_str);
  if (schedule_type === "weekly") {
    return {
      state,
      at,
      at_24h: time_str,
      in_minutes: null,
      label: `Turn the fan ${state.toUpperCase()} at ${at} ${formatDaysLabel(days || [])}`,
      schedule_type: "weekly",
      days,
    };
  }
  if (schedule_type === "date") {
    return {
      state,
      at,
      at_24h: time_str,
      in_minutes: null,
      label: `Turn the fan ${state.toUpperCase()} on ${date_str} at ${at}`,
      schedule_type: "date",
      date: date_str,
    };
  }
  return {
    state,
    at,
    at_24h: time_str,
    in_minutes: null,
    label: `Turn the fan ${state.toUpperCase()} at ${at}`,
    schedule_type: "once",
  };
}

/**
 * The backend never omits `at`/`label` for a job it returns (scheduler.py's
 * _sorted_jobs already drops jobs with no resolvable run time) — this guards
 * against a malformed response rather than a documented real case.
 */
function normalizeScheduledJob(job, index) {
  const hasTime = typeof job?.at === "string" && job.at.length > 0;
  return {
    number: job?.number ?? index + 1,
    state: job?.state ?? "unknown",
    at: hasTime ? job.at : null,
    at_24h: typeof job?.at_24h === "string" && job.at_24h.length > 0 ? job.at_24h : null,
    in_minutes: typeof job?.in_minutes === "number" ? job.in_minutes : null,
    label: typeof job?.label === "string" && job.label.length > 0
      ? job.label
      : hasTime
        ? `Turn the fan ${String(job?.state ?? "").toUpperCase()} at ${job.at}`
        : "Scheduled job (time unavailable)",
    // "once" | "weekly" | "date" — see bridge/scheduler.py:_describe.
    scheduleType: job?.schedule_type === "weekly" || job?.schedule_type === "date" ? job.schedule_type : "once",
    days: Array.isArray(job?.days) ? job.days : null,
    date: typeof job?.date === "string" && job.date.length > 0 ? job.date : null,
  };
}

/** GET /sensor → { temperature, humidity } — proxied live from the ESP32. */
export async function fetchSensor() {
  const { data } = await client.get("/sensor");
  return data;
}

/** GET /logs → sensor_read / relay_action events, oldest first. */
export async function fetchLogs() {
  const { data } = await client.get("/logs");
  return data;
}

/** GET /relay/status → { relay: "on" | "off", cooldown_remaining, cooldown_total } */
export async function fetchRelayStatus() {
  const { data } = await client.get("/relay/status");
  return data;
}

/**
 * POST /chat → { reply, actions } — runs the Claude tool-calling agent.
 * This can take several Claude round-trips plus a real ESP32 call (get
 * sensor reading, maybe toggle the relay), routinely well past the 8s
 * default used for the lightweight polling endpoints — give it its own
 * much longer budget so a slow-but-successful run isn't mistaken for a
 * dead server client-side while the bridge is still working.
 */
export async function sendChatMessage(message) {
  const { data } = await client.post("/chat", { message }, { timeout: 45000 });
  return data;
}

/** GET /schedule → array of pending scheduled jobs, soonest first. */
export async function getScheduledJobs() {
  if (USE_MOCKS) return mockScheduledJobs.map((job, i) => normalizeScheduledJob({ ...job, number: i + 1 }, i));
  const { data } = await client.get("/schedule");
  return (Array.isArray(data) ? data : []).map(normalizeScheduledJob);
}

/**
 * DELETE /schedule/{number} → { cancelled: "<label>" }
 * `number` is the 1-indexed position from getScheduledJobs(), sent as a
 * string — the backend has no client-facing job ID (see scheduler.py).
 */
export async function cancelJob(number) {
  if (USE_MOCKS) {
    const index = Number(number) - 1;
    const target = mockScheduledJobs[index];
    if (!target) throw new Error("Mock job not found");
    mockScheduledJobs = mockScheduledJobs.filter((_, i) => i !== index);
    return { cancelled: target.label };
  }
  const { data } = await client.delete(`/schedule/${number}`);
  return data;
}

/**
 * POST /schedule { state, time_str, schedule_type, days?, date_str? } → { created: true, ... }
 * schedule_type: "once" (default, today/tomorrow) | "weekly" (recurring on `days`) | "date" (one-time on `date_str`).
 */
export async function createScheduledJob({ state, time_str, schedule_type = "once", days = null, date_str = null }) {
  if (USE_MOCKS) {
    mockScheduledJobs.push(buildMockJob({ state, time_str, schedule_type, days, date_str }));
    return { created: true };
  }
  const { data } = await client.post("/schedule", { state, time_str, schedule_type, days, date_str });
  return data;
}

/**
 * PUT /schedule/{number} { state, time_str, schedule_type, days?, date_str? } → { updated: true, ... }
 * Jobs are one-shot/recurring triggers, so the backend implements this as
 * remove-and-reschedule rather than an in-place trigger edit — same effect,
 * new job underneath (can also change schedule_type, e.g. once -> weekly).
 */
export async function updateScheduledJob(number, { state, time_str, schedule_type = "once", days = null, date_str = null }) {
  if (USE_MOCKS) {
    const index = Number(number) - 1;
    if (!mockScheduledJobs[index]) throw new Error("Mock job not found");
    mockScheduledJobs[index] = buildMockJob({ state, time_str, schedule_type, days, date_str });
    return { updated: true };
  }
  const { data } = await client.put(`/schedule/${number}`, { state, time_str, schedule_type, days, date_str });
  return data;
}

export default client;
