import "./RelayStatus.css";

export default function RelayStatus({ relay }) {
  const isOn = relay === "on";
  const isKnown = relay === "on" || relay === "off";

  return (
    <section className="panel relay-panel">
      <div className="panel-label">Relay Status</div>
      <div className="relay-row">
        <div className="relay-indicator">
          {isOn && <span className="relay-ring" />}
          <span className={`relay-ring-static ${isOn ? "relay-ring-static--on" : ""}`} />
          <span className={`relay-dot ${isOn ? "relay-dot--on" : ""}`} />
        </div>
        <div>
          <div className={`relay-state ${isOn ? "relay-state--on" : ""}`}>
            {isOn ? "RELAY ON" : isKnown ? "RELAY OFF" : "RELAY —"}
          </div>
          <div className={`relay-caption ${isOn ? "" : "relay-caption--off"}`}>
            {isKnown ? (isOn ? "Device is active" : "Device is inactive") : "Checking device…"}
          </div>
        </div>
      </div>
    </section>
  );
}
