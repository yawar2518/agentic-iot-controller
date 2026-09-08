import { Navigate } from "react-router-dom";

/** Gates a route behind a valid token (and optionally an admin role), with no
 * pre-redirect flash — the check runs synchronously during render, before
 * children ever mount. */
export default function RequireAuth({ children, adminOnly = false }) {
  const token = localStorage.getItem("iot_token");
  if (!token) return <Navigate to="/login" replace />;

  if (adminOnly && localStorage.getItem("iot_role") !== "admin") {
    return <Navigate to="/" replace />;
  }

  return children;
}
