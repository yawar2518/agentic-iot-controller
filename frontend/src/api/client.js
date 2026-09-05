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
 * NOT A REAL BACKEND ROUTE. bridge/main.py has no POST /schedule — only
 * schedule_relay_at()/schedule_relay_after() exist internally, called from
 * the chat agent, not from an HTTP endpoint (see scheduler.py). This mock
 * lets the create form be built and demoed end-to-end now; the live branch
 * throws clearly instead of silently 404ing so a misconfigured USE_MOCKS
 * flag fails loudly rather than looking like a network error.
 *
 * Guessed shape, to confirm with Yawar: POST /schedule { state, time_str }.
 */
export async function createScheduledJob({ state, time_str }) {
  if (USE_MOCKS) {
    mockScheduledJobs.push({
      state,
      at: formatTime12h(time_str),
      at_24h: time_str,
      in_minutes: null,
      label: `Turn the fan ${state.toUpperCase()} at ${formatTime12h(time_str)}`,
    });
    return { created: true };
  }
  throw new Error("Creating scheduled jobs isn't supported by the backend yet — ask Yawar for POST /schedule.");
}

/**
 * NOT A REAL BACKEND ROUTE — see createScheduledJob(). Jobs are one-shot and
 * `number` is positional, so there's no in-place reschedule on the backend
 * today; this mock overwrites the mock entry at that position.
 *
 * Guessed shape, to confirm with Yawar: PUT /schedule/{number} { state, time_str }.
 */
export async function updateScheduledJob(number, { state, time_str }) {
  if (USE_MOCKS) {
    const index = Number(number) - 1;
    if (!mockScheduledJobs[index]) throw new Error("Mock job not found");
    mockScheduledJobs[index] = {
      state,
      at: formatTime12h(time_str),
      at_24h: time_str,
      in_minutes: null,
      label: `Turn the fan ${state.toUpperCase()} at ${formatTime12h(time_str)}`,
    };
    return { updated: true };
  }
  throw new Error("Editing scheduled jobs isn't supported by the backend yet — ask Yawar for an update endpoint.");
}

export default client;
