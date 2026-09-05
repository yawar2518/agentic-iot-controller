import { Fragment, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MicIcon } from "./VoiceAgent.jsx";
import "./ChatWindow.css";

const SUGGESTIONS = ["What's the temperature?", "Turn on the fan", "Is it getting warmer?"];

// Agent replies come back as markdown (bold, tables, bullet lists) — render
// them properly instead of showing raw asterisks and pipes. User messages
// stay plain text; only the agent's side of the conversation goes through this.
const markdownComponents = {
  p: ({ children }) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: "var(--text)", fontWeight: 600 }}>{children}</strong>,
  table: ({ children }) => (
    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "8px", fontSize: "13px" }}>
      {children}
    </table>
  ),
  td: ({ children }) => (
    <td style={{ padding: "4px 8px", border: "1px solid #ffffff15", color: "var(--text-mute)" }}>{children}</td>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: "4px 8px",
        border: "1px solid #ffffff15",
        color: "var(--text)",
        fontWeight: 600,
        background: "#e3c89614",
      }}
    >
      {children}
    </th>
  ),
};

const PLACEHOLDER = "Ask the agent anything — 'what's the temperature?' or 'turn on the fan'";

export default function ChatWindow({ messages, typing, onSend, voice }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const listRef = useRef(null);
  const seenCountRef = useRef(messages.length);
  const didDragRef = useRef(false);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, sheetExpanded]);

  // A new agent reply while the sheet is collapsed is otherwise invisible
  // (no preview text) — surface it as a dot on the handle instead.
  useEffect(() => {
    if (messages.length <= seenCountRef.current) return;
    const arrived = messages.slice(seenCountRef.current);
    seenCountRef.current = messages.length;
    if (!sheetExpanded && arrived.some((m) => m.role === "agent")) {
      setHasUnseen(true);
    }
  }, [messages, sheetExpanded]);

  const expandSheet = () => {
    setSheetExpanded(true);
    setHasUnseen(false);
  };

  const canSend = draft.trim().length > 0 && !typing;

  const submit = (text) => {
    const msg = (text ?? draft).trim();
    if (!msg || typing) return;
    onSend(msg);
    setDraft("");
    // Sending keeps the sheet expanded on mobile — no auto-collapse.
  };

  return (
    <Fragment>
      {/* Sibling of the sheet, not a child — a scrim nested inside the sheet
          paints over the sheet's own content instead of behind it, since a
          positioned + z-indexed element stacks above non-positioned
          siblings regardless of DOM order, once it shares a parent
          stacking context with them. */}
      {sheetExpanded && <div className="chat-scrim" onClick={() => setSheetExpanded(false)} />}

      <section className={`panel chat-panel ${sheetExpanded ? "chat-panel--expanded" : "chat-panel--collapsed"}`}>
        <button
          type="button"
          className="chat-drag-handle-row"
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            sheetExpanded ? setSheetExpanded(false) : expandSheet();
          }}
          onPointerDown={(e) => {
            const startY = e.clientY;
            const onMove = (ev) => {
              const dy = ev.clientY - startY;
              if (dy > 40 && sheetExpanded) {
                didDragRef.current = true;
                setSheetExpanded(false);
                cleanup();
              } else if (dy < -20 && !sheetExpanded) {
                didDragRef.current = true;
                expandSheet();
                cleanup();
              }
            };
            const cleanup = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
            };
            const onUp = () => cleanup();
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
          aria-expanded={sheetExpanded}
          aria-label={sheetExpanded ? "Collapse chat" : "Expand chat"}
        >
          <span className="chat-drag-handle" />
          {hasUnseen && <span className="chat-unseen-dot" />}
        </button>

        <div className="chat-header">
          <div className="panel-label">Agent Chat</div>
          <button
            type="button"
            className="chat-sheet-close"
            onClick={() => setSheetExpanded(false)}
            aria-label="Collapse chat"
          >
            ↓
          </button>
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
              onFocus={() => {
                setFocused(true);
                expandSheet();
              }}
              onBlur={() => setFocused(false)}
              placeholder={PLACEHOLDER}
              className="chat-input"
            />
            {voice && (
              <button
                type="button"
                onClick={voice.startTalking}
                className="chat-mic"
                aria-label="Talk to the agent"
                title="Talk to the agent"
              >
                <MicIcon size={17} />
              </button>
            )}
            <button onClick={() => submit()} disabled={!canSend} className={`chat-send ${canSend ? "chat-send--active" : ""}`}>
              ↑
            </button>
          </div>
          <div className="chat-suggestions">
            {/* Wake toggle sits with the chips rather than in the input row —
                it is a mode you set once, not a control you reach for. */}
            {voice?.supportsWake && (
              <button
                type="button"
                onClick={voice.toggleWake}
                aria-pressed={voice.wakeArmed}
                className={`chat-suggestion chat-wake ${voice.wakeArmed ? "chat-wake--on" : ""} ${
                  voice.wakeLive ? "chat-wake--live" : ""
                }`}
                title={
                  voice.wakeArmed
                    ? voice.wakeLive
                      ? 'Listening for "Hey Agent"'
                      : "Starting the microphone…"
                    : 'Enable the "Hey Agent" wake word'
                }
              >
                <span className="chat-wake-dot" />
                Hey Agent
              </button>
            )}
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => submit(s)} className="chat-suggestion">
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>
    </Fragment>
  );
}
