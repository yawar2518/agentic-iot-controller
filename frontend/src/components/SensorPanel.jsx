import "./SensorPanel.css";

export default function SensorPanel({ temperature, humidity, loading, secondsAgo }) {
  const ready = !loading && temperature != null && humidity != null;

  return (
    <section className="panel sensor-panel">
      <div className="panel-label">Live Sensors</div>
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
      <div className="sensor-updated">
        {ready ? `Last updated ${secondsAgo}s ago` : "Waiting for first reading…"}
      </div>
    </section>
  );
}
