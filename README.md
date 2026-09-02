# Agentic IoT Controller

An LLM-powered agent that reads live sensor data from an ESP32 and 
controls a physical relay via natural language commands using Claude 
API tool-calling.

**Built at AgileTech Studio, Lahore — September 2026**

## Team
- Yawar Abbas — Bridge server, Claude agent, SQLite logging
- Ahtesham — React frontend, live sensor panel, trend charts

## Stack
- Firmware: MicroPython on ESP32-WROOM-32
- Bridge: FastAPI + Claude API (tool-calling)
- Frontend: React 18 + Vite + Tailwind CSS + Recharts
- Logging: SQLite

## Status
- [x] Phase 1 — Hardware bringup (DHT22 + relay wired, confirmed)
- [x] Phase 2 — ESP32 HTTP API (/sensor + /relay live)
- [ ] Phase 3 — FastAPI bridge + Claude agent
- [ ] Phase 4 — Guardrails + memory
- [ ] Phase 5 — React frontend
- [ ] Phase 6 — Integration + demo

## Architecture
See `docs/architecture.md` (coming in Phase 3).