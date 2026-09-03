import { useMemo, useRef, useState } from "react";
import "./TrendChart.css";

// Chart plot area, in the 0 0 600 210 viewBox.
const L = 38;
const R = 562;
const T = 18;
const B = 176;
const GRID_ROWS = 4;
const VIEW_W = 600;

function hhmm(date) {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Pad a [min, max] domain so the line doesn't hug the plot edges. */
function padDomain(min, max, fraction) {
  const span = Math.max(max - min, 1);
  return [min - span * fraction, max + span * fraction];
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

  // Temperature and humidity each get their own independent [min, max]
  // domain and y-mapping function — the equivalent of putting them on
  // separate left/right axes so one series' scale never distorts the other.
  const temps = reads.map((r) => r.temperature);
  const hums = reads.map((r) => r.humidity);
  const [tMin, tMax] = padDomain(Math.min(...temps), Math.max(...temps), 0.15);
  const [hMin, hMax] = padDomain(Math.min(...hums), Math.max(...hums), 0.15);

  const pyT = (v) => B - ((v - tMin) / (tMax - tMin)) * (B - T); // left axis (temperature)
  const pyH = (v) => B - ((v - hMin) / (hMax - hMin)) * (B - T); // right axis (humidity)

  const path = (rows, y) =>
    rows.map((r, i) => (i ? "L" : "M") + px(new Date(r.timestamp).getTime()).toFixed(1) + " " + y(r).toFixed(1)).join(" ");

  const gridLines = Array.from({ length: GRID_ROWS + 1 }, (_, i) => ({ y: T + (i * (B - T)) / GRID_ROWS }));

  const tickIdx = [...new Set([0, Math.round((reads.length - 1) / 3), Math.round(((reads.length - 1) * 2) / 3), reads.length - 1])];
  const xTicks = tickIdx.map((i) => ({
    x: px(new Date(reads[i].timestamp).getTime()),
    label: hhmm(new Date(reads[i].timestamp)),
  }));

  const markers = logs
    .filter((r) => r.event_type === "relay_action")
    .map((r) => ({
      x: px(new Date(r.timestamp).getTime()),
      label: (r.relay_state || "").toUpperCase(),
    }))
    .filter((m) => m.x >= L && m.x <= R);

  const points = reads.map((r) => ({
    x: px(new Date(r.timestamp).getTime()),
    tempY: pyT(r.temperature),
    humY: pyH(r.humidity),
    temperature: r.temperature,
    humidity: r.humidity,
    time: new Date(r.timestamp),
  }));

  return {
    tempPath: path(reads, (r) => pyT(r.temperature)),
    humPath: path(reads, (r) => pyH(r.humidity)),
    gridLines,
    yTemp: gridLines.map((g, i) => ({ y: g.y, label: (tMax - (i * (tMax - tMin)) / GRID_ROWS).toFixed(0) + "°" })),
    yHum: gridLines.map((g, i) => ({ y: g.y, label: (hMax - (i * (hMax - hMin)) / GRID_ROWS).toFixed(0) + "%" })),
    xTicks,
    markers,
    points,
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
              viewBox="0 0 600 210"
              preserveAspectRatio="none"
              className="trend-svg"
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
            >
              {chart.gridLines.map((g, i) => (
                <line key={i} x1={L} x2={R} y1={g.y} y2={g.y} stroke="#ffffff08" strokeWidth="1" strokeDasharray="3 3" />
              ))}
              <line x1={L} x2={R} y1={B} y2={B} stroke="#ffffff10" strokeWidth="1" />

              {chart.yTemp.map((t, i) => (
                <text key={i} x={30} y={t.y} textAnchor="end" fill="#3b82f6" fontSize="11" fontFamily="IBM Plex Mono" letterSpacing="0.06em" dominantBaseline="middle">
                  {t.label}
                </text>
              ))}
              <text x={L} y={T - 4} textAnchor="start" fill="#3b82f6" fontSize="11" fontFamily="IBM Plex Mono">
                °C
              </text>

              {chart.yHum.map((h, i) => (
                <text key={i} x={570} y={h.y} textAnchor="start" fill="#06b6d4" fontSize="11" fontFamily="IBM Plex Mono" letterSpacing="0.06em" dominantBaseline="middle">
                  {h.label}
                </text>
              ))}
              <text x={R} y={T - 4} textAnchor="end" fill="#06b6d4" fontSize="11" fontFamily="IBM Plex Mono">
                %
              </text>

              {chart.markers.map((m, i) => {
                // Stagger consecutive relay-toggle labels between two rows so
                // they don't collide when several toggles land close together.
                const even = i % 2 === 0;
                const dy = even ? -8 : -20;
                return (
                  <g key={i}>
                    <line x1={m.x} x2={m.x} y1={14} y2={176} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 4" />
                    <text
                      x={m.x}
                      y={8}
                      dy={dy}
                      textAnchor={even ? "middle" : "start"}
                      fill="#f59e0b"
                      fontSize="9"
                      fontFamily="IBM Plex Mono"
                      letterSpacing="0.14em"
                    >
                      {m.label}
                    </text>
                  </g>
                );
              })}

              <path d={chart.humPath} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="trend-line trend-line--hum" />
              <path d={chart.tempPath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="trend-line trend-line--temp" />

              {chart.xTicks.map((x, i) => (
                <text key={i} x={x.x} y={196} textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="IBM Plex Mono" letterSpacing="0.08em">
                  {x.label}
                </text>
              ))}

              {hoverPoint && (
                <g>
                  <line x1={hoverPoint.x} x2={hoverPoint.x} y1={T} y2={B} stroke="#ffffff20" strokeWidth="1" />
                  <circle cx={hoverPoint.x} cy={hoverPoint.tempY} r="3.5" fill="#3b82f6" stroke="#0d0c0b" strokeWidth="1.5" />
                  <circle cx={hoverPoint.x} cy={hoverPoint.humY} r="3.5" fill="#06b6d4" stroke="#0d0c0b" strokeWidth="1.5" />
                </g>
              )}
            </svg>

            {hoverPoint && hover && (
              <div className="trend-tooltip" style={{ left: hover.left, top: hover.top }}>
                <div className="trend-tooltip-label">{hhmm(hoverPoint.time)}</div>
                <div className="trend-tooltip-row" style={{ color: "#3b82f6" }}>
                  ● {hoverPoint.temperature.toFixed(1)}°C
                </div>
                <div className="trend-tooltip-row" style={{ color: "#06b6d4" }}>
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
      </div>
    </section>
  );
}
