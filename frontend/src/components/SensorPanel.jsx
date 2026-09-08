import "./SensorPanel.css";

export default function SensorPanel({ temperature, humidity, loading, secondsAgo, onOpenScheduler, scheduledCount }) {
  const ready = !loading && temperature != null && humidity != null;
  const hasCount = typeof scheduledCount === "number";

  return (
    <section className="panel sensor-panel">
      <div className="panel-label">Live Sensors</div>
      <div className="sensor-row">
        <div className="sensor-grid">
          <div>
            {ready ? (
              <div className="sensor-value-row">
                <span className="sensor-value">{temperature.toFixed(1)}</span>
                <span className="sensor-unit">°C</span>
              </div>
            ) : (
              <div className="sensor-skeleton" />
            )}
            <div className="sensor-caption">Temperature</div>
          </div>
          <div className="sensor-col sensor-col--divider">
            {ready ? (
              <div className="sensor-value-row">
                <span className="sensor-value">{humidity.toFixed(1)}</span>
                <span className="sensor-unit">%</span>
              </div>
            ) : (
              <div className="sensor-skeleton" />
            )}
            <div className="sensor-caption">Humidity</div>
          </div>
        </div>

        <div className="sensor-scheduler-divider" />

        <div className="sensor-scheduler-col">
          <button type="button" className="sensor-scheduler-btn" onClick={onOpenScheduler}>
            Scheduler
          </button>
          <div className="sensor-scheduler-count">{hasCount ? `${scheduledCount} scheduled` : "—"}</div>
        </div>
      </div>
      <div className="sensor-updated">
        {ready ? `Last updated ${secondsAgo}s ago` : "Waiting for first reading…"}
      </div>
    </section>
  );
}
