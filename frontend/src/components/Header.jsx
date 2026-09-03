import "./Header.css";

export default function Header({ connected }) {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-logo">
          <span className="header-logo-dot" />
        </div>
        <div className="header-title">
          <span className="header-name">Agentic IoT</span>
          <span className="header-sub">Controller</span>
        </div>
      </div>

      {connected ? (
        <div className="header-status">
          <span className="status-dot status-dot--on">
            <span className="status-dot-pulse" />
          </span>
          <span className="status-text status-text--on">ESP32 Connected</span>
        </div>
      ) : (
        <div className="header-status">
          <span className="status-dot status-dot--off" />
          <span className="status-text status-text--off">ESP32 Offline</span>
        </div>
      )}
    </header>
  );
}
