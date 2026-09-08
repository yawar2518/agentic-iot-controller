import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, fetchPreview } from "../api/client.js";
import smartHomeBg from "../assets/images.jpg";

const PREVIEW_POLL_MS = 15000;

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState({ temperature: null, humidity: null, relay: null });

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await fetchPreview();
        if (!cancelled) {
          setPreview({ temperature: data.temperature, humidity: data.humidity, relay: data.relay });
        }
      } catch {
        // Preview is decorative — silently keep the last known (or placeholder) values.
      }
    };

    poll();
    const timer = setInterval(poll, PREVIEW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
    <div className="relative h-screen w-screen flex overflow-hidden">
      {/* Full-bleed photo background, spans the whole screen */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${smartHomeBg})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/60" />
      <div className="absolute inset-0 bg-black/25" />

      {/* LEFT — form */}
      <div className="relative z-10 w-full md:w-1/2 h-full flex items-center overflow-hidden">
        <form
          className="w-full max-w-[380px] md:max-w-[560px] px-8 md:px-20 flex flex-col gap-6"
          onSubmit={handleSubmit}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-6 h-6 rounded-md border border-[#c8a26a4d] bg-[#c8a26a1a] flex items-center justify-center shrink-0">
              <span className="w-[7px] h-[7px] rounded-full bg-[#c8a26a]" />
            </div>
            <div className="flex items-baseline gap-3">
              <span className="font-['Instrument_Sans',system-ui,sans-serif] text-lg font-semibold tracking-[-0.005em] text-[#f0ece4]">
                Agentic Room 
              </span>
              <span className="font-['IBM_Plex_Mono',monospace] text-[9px] tracking-[0.24em] uppercase text-[#918b80]">
                Controller
              </span>
            </div>
          </div>

          <span className="font-['IBM_Plex_Mono',monospace] text-[10px] tracking-[0.14em] uppercase text-[#c8a26a99] whitespace-nowrap">
            Room · Authorized Access
          </span>

          <h1 className="m-0 font-['Instrument_Sans',system-ui,sans-serif] text-4xl font-semibold text-[#f0ece4]">
            Sign in
          </h1>

          <label className="flex flex-col gap-2">
            <span className="font-['IBM_Plex_Mono',monospace] text-[11px] tracking-[0.12em] uppercase text-[#918b80]">
              Username
            </span>
            <input
              className="bg-transparent border-0 border-b border-[#ffffff33] rounded-none px-0 py-3 text-base text-[#f0ece4] font-inherit focus:outline-none focus:border-[#c8a26a] transition-colors"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-['IBM_Plex_Mono',monospace] text-[11px] tracking-[0.12em] uppercase text-[#918b80]">
              Password
            </span>
            <input
              className="bg-transparent border-0 border-b border-[#ffffff33] rounded-none px-0 py-3 text-base text-[#f0ece4] font-inherit focus:outline-none focus:border-[#c8a26a] transition-colors"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="text-sm text-[#e0665f]">{error}</div>}

          <button
            className="mt-2 px-5 py-3.5 rounded-lg border border-[#c8a26a4d] bg-[#c8a26a1a] text-[#e3c896] font-['Instrument_Sans',system-ui,sans-serif] text-base font-semibold cursor-pointer hover:bg-[#c8a26a2e] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>
      </div>

      {/* RIGHT — dashboard preview panel */}
      <div className="relative z-10 hidden md:flex w-1/2 h-full items-center justify-center px-14">
        <div className="w-full max-w-[560px] flex flex-col gap-10">
          <div className="rounded-2xl border border-[#ffffff14] bg-[#1a1815]/90 backdrop-blur-sm shadow-[0_20px_50px_-24px_rgba(0,0,0,0.7)] p-9 flex flex-col gap-7">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1.5">
                <span className="font-['IBM_Plex_Mono',monospace] text-xs tracking-[0.12em] uppercase text-[#918b80]">
                  Living Room
                </span>
                <div className="flex items-baseline gap-3">
                  <span className="font-['Instrument_Sans',system-ui,sans-serif] text-5xl font-semibold text-[#f0ece4]">
                    {preview.temperature != null ? `${preview.temperature.toFixed(1)}°C` : "—"}
                  </span>
                  <span className="text-base text-[#918b80]">
                    {preview.humidity != null ? `${preview.humidity.toFixed(0)}% RH` : ""}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`w-3.5 h-3.5 rounded-full ${
                    preview.relay === "on"
                      ? "bg-[#4ade80] shadow-[0_0_0_5px_rgba(74,222,128,0.18)]"
                      : "bg-[#918b80]"
                  }`}
                />
                <span className="font-['IBM_Plex_Mono',monospace] text-[10px] tracking-[0.1em] uppercase text-[#918b80]">
                  Relay 1
                </span>
              </div>
            </div>

            <svg viewBox="0 0 300 70" className="w-full h-24" preserveAspectRatio="none">
              <polyline
                points="0,50 30,42 60,48 90,30 120,35 150,18 180,26 210,14 240,20 270,8 300,15"
                fill="none"
                stroke="#c8a26a"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="0,50 30,42 60,48 90,30 120,35 150,18 180,26 210,14 240,20 270,8 300,15 300,70 0,70"
                fill="#c8a26a14"
                stroke="none"
              />
            </svg>

            <div className="flex items-center justify-between pt-2 border-t border-[#ffffff0f]">
              <span className="font-['IBM_Plex_Mono',monospace] text-xs tracking-[0.1em] uppercase text-[#918b80]">
                Relay 1 · {preview.relay === "on" ? "On" : preview.relay === "off" ? "Off" : "—"}
              </span>
              <span className="font-['IBM_Plex_Mono',monospace] text-xs text-[#6b665e] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#c8a26a] animate-pulse" />
                Live
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="m-0 font-['Instrument_Sans',system-ui,sans-serif] text-4xl font-semibold text-[#f0ece4]">
              Talk to your Room
            </h2>
            <p className="m-0 text-base text-[#918b80] leading-relaxed">
              Manage Your Room, From Anywhere
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
