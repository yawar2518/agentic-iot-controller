import "./RelayStatus.css";

function cooldownContent(relay, cooldownRemaining) {
  const isKnown = relay === "on" || relay === "off";

  if (!isKnown) {
    return { seconds: null, primary: "Unavailable", secondary: null };
  }
  if (cooldownRemaining > 0) {
    return { seconds: cooldownRemaining, primary: null, secondary: "until next switch" };
  }
  return {
    seconds: null,
    primary: relay === "on" ? "Ready — can turn off" : "Ready — can turn on",
    secondary: null,
  };
}

export default function RelayStatus({ relay, cooldownRemaining, cooldownTotal }) {
  const isOn = relay === "on";
  const isKnown = relay === "on" || relay === "off";
  const { seconds, primary, secondary } = cooldownContent(relay, cooldownRemaining);
  const counting = seconds != null;
  const progressPct = counting && cooldownTotal ? Math.max(0, Math.min(100, (seconds / cooldownTotal) * 100)) : 0;

  return (
    <section className="panel relay-panel">
      <div className="relay-columns">
        <div className="relay-col-left">
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
        </div>

        <div className="relay-divider" />

        <div className="relay-col-right">
          <div className="panel-label panel-label--small">Cooldown</div>
          <div className="relay-cooldown-body">
            {counting ? (
              <>
                <div className="relay-cooldown-seconds">{seconds}s</div>
                <div className="relay-cooldown-sub">{secondary}</div>
              </>
            ) : (
              <div className="relay-cooldown-ready">{primary}</div>
            )}
          </div>
          <div className="relay-progress-track">
            {counting && <div className="relay-progress-fill" style={{ width: `${progressPct}%` }} />}
          </div>
        </div>
      </div>
    </section>
  );
}
