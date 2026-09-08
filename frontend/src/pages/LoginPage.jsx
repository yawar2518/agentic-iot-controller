import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client.js";
import "./LoginPage.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const { access_token, role } = await login(username, password);
        localStorage.setItem("iot_token", access_token);
        localStorage.setItem("iot_role", role);
        navigate("/", { replace: true });
      } catch {
        setError("Invalid username or password");
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, navigate]
  );

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="login-logo">
            <span className="login-logo-dot" />
          </div>
          <div className="login-title">
            <span className="login-name">Agentic IoT</span>
            <span className="login-sub">Controller</span>
          </div>
        </div>

        <h1 className="login-heading">Sign in</h1>

        <label className="login-field">
          <span className="login-label">Username</span>
          <input
            className="login-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="login-field">
          <span className="login-label">Password</span>
          <input
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="login-button" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Login"}
        </button>
      </form>
    </div>
  );
}
