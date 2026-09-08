import { useMemo, useRef, useState } from "react";
import "./TrendChart.css";

// Chart plot area, in the 0 0 600 220 viewBox. Two stacked panels (temp on
// top, humidity below) share this horizontal range and one x-axis at the
// bottom; only the vertical split differs between them.
const L = 46;
const R = 546;
const VIEW_W = 600;
const VIEW_H = 220;

// Top panel is slightly taller (~55/45) since temperature is the primary
// signal; a small gap separates the two panels visually.
const TOP_T = 10;
const TOP_B = 108;
const GAP = 10;
const BOT_T = TOP_B + GAP; // 118
const BOT_B = 190;
const AXIS_Y = 206; // shared x-axis label baseline, below both panels

const Y_TICKS = 3;
const TEMP_COLOR = "#e3c896"; // sand accent
const HUM_COLOR = "#7dd3fc"; // cool sky-blue — distinct from the warm relay bands and temp line
const RELAY_BAND = "#e3c8961f"; // warm, very low opacity

function hhmm(date) {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Pad a [min, max] domain so the line doesn't hug the plot edges. */
function padDomain(min, max, fraction) {
  const span = Math.max(max - min, 1);
  return [min - span * fraction, max + span * fraction];
}

/** Pick tick values across a domain, formatting with a decimal only if whole numbers would collide. */
function buildYTicks(min, max, panelTop, panelBottom, unit) {
  const span = max - min;
  const wholeValues = new Set();
  for (let i = 0; i < Y_TICKS; i++) {
    wholeValues.add(Math.round(max - (i * span) / (Y_TICKS - 1)));
  }
  const needsDecimal = wholeValues.size < Y_TICKS;

  return Array.from({ length: Y_TICKS }, (_, i) => {
    const value = max - (i * span) / (Y_TICKS - 1);
    const y = panelTop + (i * (panelBottom - panelTop)) / (Y_TICKS - 1);
    const label = (needsDecimal ? value.toFixed(1) : Math.round(value).toString()) + unit;
    return { y, label };
  });
}

function buildChart(logs) {
  // Only rows with both readings ever become points on the path — there is
  // no "null" data point that can appear mid-line, so temp/humidity are
  // effectively always connected (the connectNulls intent, without a gap to
  // bridge in the first place).
  const reads = logs.filter(
    (r) => r.event_type === "sensor_read" && r.temperature != null && r.humidity != null
  );
  if (reads.length < 2) return null;

  const times = reads.map((r) => new Date(r.timestamp).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0 || 1;
  const px = (ts) => L + ((ts - t0) / span) * (R - L);

  const temps = reads.map((r) => r.temperature);
  const hums = reads.map((r) => r.humidity);
  const [tMin, tMax] = padDomain(Math.min(...temps), Math.max(...temps), 0.15);
  const [hMin, hMax] = padDomain(Math.min(...hums), Math.max(...hums), 0.15);

  const pyT = (v) => TOP_B - ((v - tMin) / (tMax - tMin)) * (TOP_B - TOP_T);
  const pyH = (v) => BOT_B - ((v - hMin) / (hMax - hMin)) * (BOT_B - BOT_T);

  const path = (rows, y) =>
    rows.map((r, i) => (i ? "L" : "M") + px(new Date(r.timestamp).getTime()).toFixed(1) + " " + y(r).toFixed(1)).join(" ");

  const yTemp = buildYTicks(tMin, tMax, TOP_T, TOP_B, "°");
  const yHum = buildYTicks(hMin, hMax, BOT_T, BOT_B, "%");

  // Real-time x-axis ticks: evenly spaced by clock time, not by data index.
  const TICK_COUNT = 5;
  const xTicks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const ts = t0 + (i * span) / (TICK_COUNT - 1);
    return { x: px(ts), label: hhmm(new Date(ts)) };
  });

  // Pair consecutive relay_action events into ON intervals: an "on" event
  // opens a band, the next "off" (or the window's right edge) closes it.
  const relayEvents = logs
    .filter((r) => r.event_type === "relay_action")
    .map((r) => ({ ts: new Date(r.timestamp).getTime(), state: (r.relay_state || "").toLowerCase() }))
    .sort((a, b) => a.ts - b.ts);

  const bands = [];
  let openTs = null;
  for (const ev of relayEvents) {
    if (ev.state === "on" && openTs == null) {
      openTs = ev.ts;
    } else if (ev.state === "off" && openTs != null) {
      bands.push({ x1: px(Math.max(openTs, t0)), x2: px(Math.min(ev.ts, t1)) });
      openTs = null;
    }
  }
  if (openTs != null) {
    bands.push({ x1: px(Math.max(openTs, t0)), x2: px(t1) });
  }

  const points = reads.map((r) => ({
    x: px(new Date(r.timestamp).getTime()),
    tempY: pyT(r.temperature),
    humY: pyH(r.humidity),
    temperature: r.temperature,
    humidity: r.humidity,
    time: new Date(r.timestamp),
  }));

  const last = points[points.length - 1];

  return {
    tempPath: path(reads, (r) => pyT(r.temperature)),
    humPath: path(reads, (r) => pyH(r.humidity)),
    yTemp,
    yHum,
    xTicks,
    bands,
    points,
    last,
  };
}

export default function TrendChart({ logs }) {
  const chart = useMemo(() => buildChart(logs), [logs]);
  const [hover, setHover] = useState(null); // { idx, left, top }
  const svgRef = useRef(null);
  const bodyRef = useRef(null);

  const handleMove = (e) => {
    if (!chart || !svgRef.current || !bodyRef.current) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    const bodyRect = bodyRef.current.getBoundingClientRect();
    const fracX = (e.clientX - svgRect.left) / svgRect.width;
    const svgX = fracX * VIEW_W;

    let idx = 0;
    let best = Infinity;
    chart.points.forEach((p, i) => {
      const d = Math.abs(p.x - svgX);
      if (d < best) {
        best = d;
        idx = i;
      }
    });

    setHover({ idx, left: e.clientX - bodyRect.left, top: e.clientY - bodyRect.top });
  };

  const handleLeave = () => setHover(null);
  const hoverPoint = hover && chart ? chart.points[hover.idx] : null;

  return (
    <section className="panel trend-panel">
      <div className="trend-header">
        <div className="panel-label">Sensor Trend</div>
        <div className="trend-window">LAST {logs.length ? "30 MIN" : "—"}</div>
      </div>

      <div className="trend-body" ref={bodyRef}>
        {chart ? (
          <>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              className="trend-svg"
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
            >
              {/* Relay ON bands — span the full height of both panels */}
              {chart.bands.map((b, i) => (
                <rect key={i} x={b.x1} y={TOP_T} width={Math.max(b.x2 - b.x1, 0)} height={BOT_B - TOP_T} fill={RELAY_BAND} />
              ))}

              {/* Top panel — temperature */}
              {chart.yTemp.map((t, i) => (
                <line key={i} x1={L} x2={R} y1={t.y} y2={t.y} stroke="#ffffff08" strokeWidth="1" />
              ))}
              {chart.yTemp.map((t, i) => (
                <text key={i} x={L - 8} y={t.y} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono" dominantBaseline="middle">
                  {t.label}
                </text>
              ))}
              <path d={chart.tempPath} fill="none" stroke={TEMP_COLOR} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="trend-line trend-line--temp" />
              <text x={R + 6} y={chart.last.tempY} dominantBaseline="middle" fill={TEMP_COLOR} fontSize="11" fontFamily="IBM Plex Mono" fontWeight="600">
                {chart.last.temperature.toFixed(1)}°
              </text>

              {/* Bottom panel — humidity */}
              {chart.yHum.map((h, i) => (
                <line key={i} x1={L} x2={R} y1={h.y} y2={h.y} stroke="#ffffff08" strokeWidth="1" />
              ))}
              {chart.yHum.map((h, i) => (
                <text key={i} x={L - 8} y={h.y} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono" dominantBaseline="middle">
                  {h.label}
                </text>
              ))}
              <path d={chart.humPath} fill="none" stroke={HUM_COLOR} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="trend-line trend-line--hum" />
              <text x={R + 6} y={chart.last.humY} dominantBaseline="middle" fill={HUM_COLOR} fontSize="11" fontFamily="IBM Plex Mono" fontWeight="600">
                {chart.last.humidity.toFixed(1)}%
              </text>

              {/* Shared x-axis */}
              {chart.xTicks.map((x, i) => (
                <text key={i} x={x.x} y={AXIS_Y} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="IBM Plex Mono" letterSpacing="0.06em">
                  {x.label}
                </text>
              ))}

              {hoverPoint && (
                <g>
                  <line x1={hoverPoint.x} x2={hoverPoint.x} y1={TOP_T} y2={BOT_B} stroke="#ffffff20" strokeWidth="1" />
                </g>
              )}
            </svg>

            {hoverPoint && hover && (
              <div className="trend-tooltip" style={{ left: hover.left, top: hover.top }}>
                <div className="trend-tooltip-label">{hhmm(hoverPoint.time)}</div>
                <div className="trend-tooltip-row" style={{ color: TEMP_COLOR }}>
                  ● {hoverPoint.temperature.toFixed(1)}°C
                </div>
                <div className="trend-tooltip-row" style={{ color: HUM_COLOR }}>
                  ● {hoverPoint.humidity.toFixed(1)}%
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="trend-empty">Waiting for sensor history…</div>
        )}
      </div>

      <div className="trend-legend">
        <div className="trend-legend-item">
          <span className="trend-legend-swatch trend-legend-swatch--temp" />
          Temp
        </div>
        <div className="trend-legend-item">
          <span className="trend-legend-swatch trend-legend-swatch--hum" />
          Humidity
        </div>
        <div className="trend-legend-item">
          <span className="trend-legend-swatch trend-legend-swatch--relay" />
          Relay On
        </div>
      </div>
    </section>
  );
}
