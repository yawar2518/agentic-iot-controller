import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import SensorPanel from "./components/SensorPanel.jsx";
import RelayStatus from "./components/RelayStatus.jsx";
import TrendChart from "./components/TrendChart.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import { fetchLogs, fetchRelayStatus, fetchSensor, sendChatMessage } from "./api/client.js";
import "./App.css";

const SENSOR_POLL_MS = 15000;
const RELAY_POLL_MS = 10000;
const LOGS_POLL_MS = 15000;

function timeStamp(date = new Date()) {
  const hours = date.getHours();
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export default function App() {
  const [connected, setConnected] = useState(true);
  const [sensor, setSensor] = useState({ temperature: null, humidity: null });
  const [sensorLoading, setSensorLoading] = useState(true);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [relay, setRelay] = useState(null);
  const [logs, setLogs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);

  const lastReadAt = useRef(null);

  const pollSensor = useCallback(async () => {
    try {
      const data = await fetchSensor();
      setSensor({ temperature: data.temperature, humidity: data.humidity });
      setSensorLoading(false);
      setConnected(true);
      lastReadAt.current = Date.now();
      setSecondsAgo(0);
    } catch {
      setConnected(false);
    }
  }, []);

  const pollRelay = useCallback(async () => {
    try {
      const data = await fetchRelayStatus();
      setRelay(data.relay);
    } catch {
      // keep the last known relay state — bridge may be mid-restart
    }
  }, []);

  const pollLogs = useCallback(async () => {
    try {
      const data = await fetchLogs();
      setLogs(data);
    } catch {
      // keep last known trend — chart just goes stale, not blank
    }
  }, []);

  useEffect(() => {
    pollSensor();
    pollRelay();
    pollLogs();

    const sensorTimer = setInterval(pollSensor, SENSOR_POLL_MS);
    const relayTimer = setInterval(pollRelay, RELAY_POLL_MS);
    const logsTimer = setInterval(pollLogs, LOGS_POLL_MS);
    const secondsTimer = setInterval(() => {
      if (lastReadAt.current) {
        setSecondsAgo(Math.floor((Date.now() - lastReadAt.current) / 1000));
      }
    }, 1000);

    return () => {
      clearInterval(sensorTimer);
      clearInterval(relayTimer);
      clearInterval(logsTimer);
      clearInterval(secondsTimer);
    };
  }, [pollSensor, pollRelay, pollLogs]);

  const handleSend = useCallback(
    async (text) => {
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text, time: timeStamp() }]);
      setTyping(true);

      try {
        const { reply, actions = [] } = await sendChatMessage(text);
        const relayAction = actions.find((a) => a.tool === "set_relay" && !a.blocked);
        const blockedAction = actions.find((a) => a.tool === "set_relay" && a.blocked);
        const sensorAction = actions.find((a) => a.tool === "get_sensor_reading");

        if (relayAction) setRelay(relayAction.state);

        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: reply,
            time: timeStamp(),
            relayPill: relayAction ? `Relay turned ${relayAction.state.toUpperCase()}` : null,
            sensorPill: sensorAction
              ? `Sensor read: ${sensorAction.result.temperature}°C · ${sensorAction.result.humidity.toFixed(1)}%`
              : null,
            blockedReason: blockedAction ? blockedAction.reason : null,
          },
        ]);

        // A relay toggle or sensor read means the bridge just wrote a new
        // log row — refresh the trend chart instead of waiting on its timer.
        if (relayAction || sensorAction) pollLogs();
      } catch (err) {
        // A timeout means the bridge was still working (Claude + a real ESP32
        // round-trip routinely takes longer than a normal request) — that's a
        // different problem from the bridge actually being down, so say so.
        const timedOut = err?.code === "ECONNABORTED";
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "agent",
            text: timedOut
              ? "That's taking longer than expected. The action may have still gone through on the bridge — check the sensor/relay panels, then try again."
              : "I couldn't reach the bridge server. Check that it's running on port 8000 and try again.",
            time: timeStamp(),
          },
        ]);
      } finally {
        setTyping(false);
      }
    },
    [pollLogs]
  );

  return (
    <div className="app-shell">
      <Header connected={connected} />
      <div className="app-grid">
        <div className="app-col-left">
          <SensorPanel
            temperature={sensor.temperature}
            humidity={sensor.humidity}
            loading={sensorLoading}
            secondsAgo={secondsAgo}
          />
          <RelayStatus relay={relay} />
          <TrendChart logs={logs} />
        </div>
        <ChatWindow messages={messages} typing={typing} onSend={handleSend} />
      </div>
    </div>
  );
}
