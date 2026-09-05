import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import SensorPanel from "./components/SensorPanel.jsx";
import RelayStatus from "./components/RelayStatus.jsx";
import TrendChart from "./components/TrendChart.jsx";
import ScheduledJobs from "./components/ScheduledJobs.jsx";
import SchedulerModal from "./components/SchedulerModal.jsx";
import ScheduleJobForm from "./components/ScheduleJobForm.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import VoiceAgent, { useVoiceAgent } from "./components/VoiceAgent.jsx";
import {
  cancelJob,
  createScheduledJob,
  fetchLogs,
  fetchRelayStatus,
  fetchSensor,
  getScheduledJobs,
  sendChatMessage,
  updateScheduledJob,
} from "./api/client.js";
import "./App.css";

const SENSOR_POLL_MS = 30000;
const RELAY_POLL_MS = 20000;
const LOGS_POLL_MS = 60000;
const JOBS_POLL_MS = 30000;

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
  const [cooldownRemaining, setCooldownRemaining] = useState(null);
  const [cooldownTotal, setCooldownTotal] = useState(null);
  const [logs, setLogs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState(false);
  const [busyNumber, setBusyNumber] = useState(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [schedulerView, setSchedulerView] = useState("list"); // "list" | "create" | "edit"
  const [editingJob, setEditingJob] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
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
      setCooldownRemaining(data.cooldown_active ? data.cooldown_remaining : 0);
      setCooldownTotal(data.cooldown_total);
    } catch {
      // keep the last known relay state
    }
  }, []);

  const pollLogs = useCallback(async () => {
    try {
      const data = await fetchLogs();
      setLogs(data);
    } catch {
      // keep last known trend
    }
  }, []);

  const pollJobs = useCallback(async () => {
    try {
      const data = await getScheduledJobs();
      setJobs(data);
      setJobsLoading(false);
      setJobsError(false);
    } catch {
      setJobsLoading(false);
      setJobsError(true);
    }
  }, []);

  const handleDeleteJob = useCallback(async (number) => {
    setBusyNumber(number);
    try {
      await cancelJob(number);
      await pollJobs();
    } catch {
      // leave the list as-is; the next poll will reconcile if it did cancel
    } finally {
      setBusyNumber(null);
    }
  }, [pollJobs]);

  const openScheduler = useCallback(() => {
    setSchedulerView("list");
    setEditingJob(null);
    setFormError(null);
    setSchedulerOpen(true);
  }, []);

  const closeScheduler = useCallback(() => {
    setSchedulerOpen(false);
    setSchedulerView("list");
    setEditingJob(null);
    setFormError(null);
  }, []);

  const startCreate = useCallback(() => {
    setEditingJob(null);
    setFormError(null);
    setSchedulerView("create");
  }, []);

  const startEdit = useCallback((number) => {
    const job = jobs.find((j) => j.number === number);
    if (!job) return;
    setEditingJob(job);
    setFormError(null);
    setSchedulerView("edit");
  }, [jobs]);

  const backToList = useCallback(() => {
    setSchedulerView("list");
    setEditingJob(null);
    setFormError(null);
  }, []);

  const handleFormSubmit = useCallback(async ({ state, time_str }) => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (schedulerView === "edit" && editingJob) {
        await updateScheduledJob(editingJob.number, { state, time_str });
      } else {
        await createScheduledJob({ state, time_str });
      }
      await pollJobs();
      setSchedulerView("list");
      setEditingJob(null);
    } catch (err) {
      setFormError(err?.message || "Something went wrong. Try again.");
    } finally {
      setFormSubmitting(false);
    }
  }, [schedulerView, editingJob, pollJobs]);

  useEffect(() => {
    pollSensor();
    pollRelay();
    pollLogs();
    pollJobs();

    const sensorTimer = setInterval(pollSensor, SENSOR_POLL_MS);
    const relayTimer = setInterval(pollRelay, RELAY_POLL_MS);
    const logsTimer = setInterval(pollLogs, LOGS_POLL_MS);
    const jobsTimer = setInterval(pollJobs, JOBS_POLL_MS);
    const secondsTimer = setInterval(() => {
      if (lastReadAt.current) {
        setSecondsAgo(Math.floor((Date.now() - lastReadAt.current) / 1000));
      }
      setCooldownRemaining((prev) => {
        if (prev == null || prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(sensorTimer);
      clearInterval(relayTimer);
      clearInterval(logsTimer);
      clearInterval(jobsTimer);
      clearInterval(secondsTimer);
    };
  }, [pollSensor, pollRelay, pollLogs, pollJobs]);

  const handleSend = useCallback(
    async (text) => {
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text, time: timeStamp() }]);
      setTyping(true);

      try {
        const { reply, actions = [] } = await sendChatMessage(text);
        const relayAction = actions.find((a) => a.tool === "set_relay" && !a.blocked);
        const blockedAction = actions.find((a) => a.tool === "set_relay" && a.blocked);
        const sensorAction = actions.find((a) => a.tool === "get_sensor_reading");

        if (relayAction) {
          setRelay(relayAction.state);
          setCooldownRemaining(30);
        }

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

        if (relayAction || sensorAction) pollLogs();
        // Returned so the voice agent can speak the same reply it just
        // appended to the transcript; the chat UI ignores the value.
        return reply;
      } catch (err) {
        const timedOut = err?.code === "ECONNABORTED";
        const failureText = timedOut
          ? "That's taking longer than expected. The action may have still gone through on the bridge — check the sensor/relay panels, then try again."
          : "I couldn't reach the bridge server. Check that it's running on port 8000 and try again.";
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "agent",
            text: failureText,
            time: timeStamp(),
          },
        ]);
        return failureText;
      } finally {
        setTyping(false);
      }
    },
    [pollLogs]
  );

  // Owns the speech plumbing; its controls render inside the chat input and
  // its overlay renders at the top level.
  const voice = useVoiceAgent({ onSend: handleSend });

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
            onOpenScheduler={openScheduler}
            scheduledCount={jobsLoading || jobsError ? null : jobs.length}
          />
          <RelayStatus relay={relay} cooldownRemaining={cooldownRemaining} cooldownTotal={cooldownTotal} />
          <TrendChart logs={logs} />
        </div>
        <ChatWindow messages={messages} typing={typing} onSend={handleSend} voice={voice} />
      </div>
      <VoiceAgent voice={voice} />
      <SchedulerModal
        open={schedulerOpen}
        onClose={closeScheduler}
        onAdd={schedulerView === "list" ? startCreate : null}
      >
        {schedulerView === "list" && (
          <ScheduledJobs
            jobs={jobs}
            loading={jobsLoading}
            error={jobsError}
            onEdit={startEdit}
            onDelete={handleDeleteJob}
            busyNumber={busyNumber}
          />
        )}
        {(schedulerView === "create" || schedulerView === "edit") && (
          <ScheduleJobForm
            initial={editingJob}
            submitting={formSubmitting}
            error={formError}
            onSubmit={handleFormSubmit}
            onCancel={backToList}
          />
        )}
      </SchedulerModal>
    </div>
  );
}