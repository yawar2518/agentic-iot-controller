import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./ChatWindow.css";

const SUGGESTIONS = ["what's the temperature?", "turn on the fan", "is it getting warmer?"];

// Agent replies come back as markdown (bold, tables, bullet lists) — render
// them properly instead of showing raw asterisks and pipes. User messages
// stay plain text; only the agent's side of the conversation goes through this.
const markdownComponents = {
  p: ({ children }) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: "#f8fafc", fontWeight: 600 }}>{children}</strong>,
  table: ({ children }) => (
    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "8px", fontSize: "13px" }}>
      {children}
    </table>
  ),
  td: ({ children }) => (
    <td style={{ padding: "4px 8px", border: "1px solid #ffffff15", color: "#94a3b8" }}>{children}</td>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: "4px 8px",
        border: "1px solid #ffffff15",
        color: "#f8fafc",
        fontWeight: 600,
        background: "#ffffff08",
      }}
    >
      {children}
    </th>
  ),
};

export default function ChatWindow({ messages, typing, onSend }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const canSend = draft.trim().length > 0 && !typing;

  const submit = (text) => {
    const msg = (text ?? draft).trim();
    if (!msg || typing) return;
    onSend(msg);
    setDraft("");
  };

  return (
    <section className="panel chat-panel">
      <div className="chat-header">
        <div className="panel-label">Agent Chat</div>
        <div className="chat-tools">2 TOOLS</div>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !typing && (
          <div className="chat-empty">
            <div className="chat-empty-title">
              Talk to your <span className="chat-empty-accent">room.</span>
            </div>
            <div className="chat-empty-sub">The agent reads live sensor data and controls your device.</div>
          </div>
        )}

        {messages.map((m) => (
          <div className="chat-msg" key={m.id}>
            {m.role === "user" ? (
              <div className="chat-bubble-row">
                <div className="chat-bubble">{m.text}</div>
                <div className="chat-time">{m.time}</div>
              </div>
            ) : (
              <div className="chat-agent-row">
                <div className="chat-avatar">
                  <span />
                </div>
                <div className="chat-agent-body">
                  <div className="chat-agent-text">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {m.text}
                    </ReactMarkdown>
                  </div>
                  {m.relayPill && (
                    <div className={`chat-pill ${m.relayPill.includes("ON") ? "chat-pill--on" : "chat-pill--off"}`}>
                      <span className="chat-pill-dot" />
                      {m.relayPill}
                    </div>
                  )}
                  {m.sensorPill && <div className="chat-pill chat-pill--neutral">{m.sensorPill}</div>}
                  {m.blockedReason && <div className="chat-pill chat-pill--warn">{m.blockedReason}</div>}
                  <div className="chat-time">{m.time}</div>
                </div>
              </div>
            )}
          </div>
        ))}

        {typing && (
          <div className="chat-agent-row">
            <div className="chat-avatar">
              <span />
            </div>
            <div className="chat-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div className="chat-list-spacer" />
      </div>

      <div className="chat-input-area">
        <div className={`chat-input-shell ${focused ? "chat-input-shell--focused" : ""}`}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask the agent anything — 'what's the temperature?' or 'turn on the fan'"
            className="chat-input"
          />
          <button onClick={() => submit()} disabled={!canSend} className={`chat-send ${canSend ? "chat-send--active" : ""}`}>
            ↑
          </button>
        </div>
        <div className="chat-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => submit(s)} className="chat-suggestion">
              {s}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
