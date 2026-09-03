import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
});

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

/** GET /relay/status → { relay: "on" | "off" } */
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

export default client;
