import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { registerUser } from "../api/client.js";
import "./AdminPanel.css";

export default function AdminPanel() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      setSuccess(null);
      try {
        const { message } = await registerUser(username, password, role);
        setSuccess(message || "User created successfully");
        setUsername("");
        setPassword("");
        setRole("user");
      } catch (err) {
        setError(err?.response?.data?.detail || "Could not create user.");
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, role]
  );

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-header">
          <h1 className="admin-heading">Create User</h1>
          <Link to="/" className="admin-back-link">
            Back to dashboard
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="admin-form">
          <label className="admin-field">
            <span className="admin-label">Username</span>
            <input
              className="admin-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Password</span>
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="admin-field">
            <span className="admin-label">Role</span>
            <select
              className="admin-input admin-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>

          {error && <div className="admin-error">{error}</div>}
          {success && <div className="admin-success">{success}</div>}

          <button className="admin-button" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </form>
      </div>
    </div>
  );
}
