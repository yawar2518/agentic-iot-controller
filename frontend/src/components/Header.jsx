import { Link } from "react-router-dom";
import "./Header.css";

export default function Header({ connected, isAdmin, onLogout }) {
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

      <div className="header-status">
        {connected ? (
          <>
            <span className="status-dot status-dot--on">
              <span className="status-dot-pulse" />
            </span>
            <span className="status-text status-text--on">ESP32 Connected</span>
          </>
        ) : (
          <>
            <span className="status-dot status-dot--off" />
            <span className="status-text status-text--off">ESP32 Offline</span>
          </>
        )}

        {isAdmin && (
          <Link to="/admin" className="header-admin-link">
            Admin
          </Link>
        )}

        {onLogout && (
          <button type="button" className="header-logout" onClick={onLogout}>
            Logout
          </button>
        )}
      </div>
    </header>
  );
}
