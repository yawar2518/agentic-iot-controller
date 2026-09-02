# Agentic IoT Controller

An LLM-powered agent that reads live sensor data from an ESP32 and 
controls a physical relay via natural language commands using Claude 
API tool-calling.

**Built at AgileTech Studio, Lahore — September 2026**  
**Team:** Yawar Abbas (bridge server + agent) · Ahtesham (React frontend)

---

## Elevator Pitch

> "An AI agent you can talk to — *'turn on the fan, it's getting warm'* — 
> that reasons over live sensor data and actually flips a physical relay 
> switch. Not a simulation."

---

## What Makes This Different

| Typical IoT project | This project |
|---|---|
| Hardcoded if/else rules | LLM agent reasons before acting |
| App-based manual toggle | Natural language chat interface |
| Simulated data | Real physical hardware feedback loop |
| One-way data reading | Agent reads sensors AND controls devices |
| Single data point decisions | Rolling sensor memory + trend analysis |
| No safety controls | 30-second relay cooldown guardrail |

---

## System Architecture

```
User: "It's getting warm, do something about it."
              │
              ▼
   ┌─────────────────────────┐
   │   Claude AI Agent        │
   │   reasons over context   │
   │   decides which tools    │
   │   to call                │
   └───────────┬─────────────┘
               │ tool: get_sensor_reading()
               ▼
   ┌─────────────────────────┐     HTTP GET /sensor
   │   FastAPI Bridge Server  │ ──────────────────▶ ┌─────────────────┐
   │   - exposes tools        │                     │  ESP32-WROOM-32  │
   │   - talks to ESP32       │ ◀────────────────── │  DHT22 on GPIO4  │
   │   - logs to SQLite       │  {temp, humidity}   │  Relay on GPIO5  │
   └───────────┬─────────────┘                     └─────────────────┘
               │ agent reasons: "27°C, rising trend — turning on fan"
               │ tool: set_relay("on")
               ▼
   ┌─────────────────────────┐     HTTP POST /relay
   │   FastAPI Bridge Server  │ ──────────────────▶ Fan turns ON physically
   └───────────┬─────────────┘
               ▼
   Agent replies: "It's 27°C and rising — I've turned the fan on."
               │
               ▼
   ┌─────────────────────────┐
   │   React Frontend         │
   │   Chat UI + Live Sensor  │
   │   Panel + Trend Chart    │
   └─────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Firmware | MicroPython on ESP32-WROOM-32 |
| Bridge Server | FastAPI (Python) |
| AI Agent | Claude API — tool-calling (claude-sonnet-4-6) |
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Logging | SQLite (aiosqlite) |
| Hardware | ESP32, DHT22, Songle Relay Module |

---

## Hardware

### Components
- ESP32-WROOM-32 (DevKitC)
- DHT22 temperature and humidity sensor
- Songle SRD-05VDC-SL-C relay module
- Breadboard + jumper wires
- Micro-USB cable (data capable — not charge-only)

### Pin Wiring

| Component | ESP32 Pin | Notes |
|---|---|---|
| DHT22 VCC | 3V3 | Right side, pin 1 |
| DHT22 GND | GND | Right side, pin 2 |
| DHT22 DATA | GPIO4 | Right side, 5th pin from bottom |
| Relay VCC | 3V3 | Shared 3.3V rail |
| Relay GND | GND | Shared ground rail |
| Relay IN | GPIO5 | Right side, 8th pin from bottom |

**Important:** Relay is active LOW.  
`relay.value(0)` = ON · `relay.value(1)` = OFF

---

## Flashing MicroPython onto ESP32

### Step 1 — Install CP2102 USB driver (Windows only)
Download and install from:  
https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

Plug in the ESP32 via Micro-USB. Confirm it appears as a COM port in 
Device Manager (e.g. COM3).

### Step 2 — Install esptool

```powershell
pip install esptool
```

### Step 3 — Download MicroPython firmware

Download the ESP32 generic .bin from:  
https://micropython.org/download/ESP32_GENERIC/

Use the latest stable release.

### Step 4 — Erase the ESP32 flash

```powershell
esptool --chip esp32 --port COM3 erase_flash
```

Replace `COM3` with your actual port number.

### Step 5 — Flash MicroPython

```powershell
esptool --chip esp32 --port COM3 --baud 460800 write_flash -z 0x1000 firmware.bin
```

Replace `firmware.bin` with the full path to your downloaded .bin file.  
**Flash offset must be 0x1000** for ESP32-WROOM-32 — using 0x0 will fail.

### Step 6 — Verify flash succeeded

Open any serial monitor (Thonny, PuTTY, or Arduino IDE) at 115200 baud.  
Press the EN (reset) button on the ESP32.  
You should see the MicroPython REPL prompt `>>>`.

---

## Uploading Firmware to ESP32

### Recommended tool — Thonny IDE

Download from: https://thonny.org

1. Open Thonny
2. Go to **Tools → Options → Interpreter**
3. Select **MicroPython (ESP32)**
4. Select your COM port
5. Click OK

### Upload main.py

1. Open `firmware/main.py` in Thonny
2. Edit the WiFi credentials at the top:
```python
   SSID = 'your_wifi_name'
   PASSWORD = 'your_wifi_password'
```
   Note: ESP32-WROOM-32 supports **2.4GHz only** — will not connect to 5GHz networks.
3. Go to **File → Save As**
4. Select **MicroPython device**
5. Save as `main.py`

### Run it

Press the EN (reset) button on the ESP32.  
Open Thonny's serial monitor — you should see:

```
Connecting to WiFi....
Connected! IP: 192.168.x.x
HTTP server listening on 192.168.x.x port 80
```

### Test the ESP32 API

```powershell
# Read sensor
curl http://192.168.x.x/sensor

# Turn relay on
curl -X POST http://192.168.x.x/relay `
  -H "Content-Type: application/json" `
  -d '{"state": "on"}'

# Turn relay off
curl -X POST http://192.168.x.x/relay `
  -H "Content-Type: application/json" `
  -d '{"state": "off"}'
```

---

## Project Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- Git

### 1. Clone the repo

```powershell
git clone https://github.com/yawar2518/agentic-iot-controller.git
cd agentic-iot-controller
```

### 2. Configure environment

```powershell
Copy-Item .env.example bridge\.env
```

Open `bridge/.env` and fill in:

```env
ESP32_IP=192.168.x.x        # IP shown in ESP32 serial monitor
ESP32_PORT=80
ANTHROPIC_API_KEY=your_key_here
CLAUDE_MODEL=claude-sonnet-4-6
BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8000
```

### 3. Install bridge server dependencies

```powershell
cd bridge
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 4. Run the bridge server

```powershell
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Server starts at: http://localhost:8000

### 5. Install and run the frontend

```powershell
cd ..\frontend
npm install
npm run dev
```

Frontend starts at: http://localhost:5173

---

## API Reference

Base URL: `http://localhost:8000`

| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | /chat | `{"message": "string"}` | `{"reply": "string", "actions": []}` |
| GET | /sensor | none | `{"temperature": 27.4, "humidity": 63.4}` |
| GET | /logs | none | `[{"timestamp": "...", "temp": 27.4, "relay": "on"}]` |
| GET | /relay/status | none | `{"relay": "on" or "off"}` |

---

## Agent Guardrails

- **Relay rate limiting** — minimum 30 second cooldown between toggles. 
  Agent explains the wait time in natural language if blocked.
- **Sensor memory** — rolling window of last 10 readings. Agent reasons 
  over trend (rising/falling/stable), not just a single snapshot.
- **Context injection** — every request includes current relay state, 
  cooldown status, and sensor trend so Claude never acts blind.
- **Always explains** — agent always states why it acted, referencing 
  actual sensor values.

---

## Wiring a Real Device (220V)

To control a real fan or lamp:

1. Work with the power cord **unplugged from the wall**
2. Cut only the **live wire** (brown wire)
3. Strip both cut ends ~1cm
4. Connect one end to relay **COM** terminal
5. Connect other end to relay **NO** (Normally Open) terminal
6. Plug the device into the socket end, cord into the wall

When relay is OFF → COM-NO circuit open → device has no power  
When relay is ON → COM-NO circuit closes → device gets 220V

**Always unplug before touching any wiring.**

---

## Repository Structure

```
agentic-iot-controller/
├── firmware/
│   └── main.py              # MicroPython HTTP server — /sensor + /relay
├── bridge/
│   ├── config.py            # Settings from .env
│   ├── tools.py             # get_sensor_reading(), set_relay() + rate limiting
│   ├── agent.py             # Claude tool-calling loop + context injection
│   ├── logger.py            # SQLite async logging
│   ├── memory.py            # Rolling sensor window + trend analysis
│   ├── main.py              # FastAPI server — four endpoints
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ChatWindow.jsx
│       │   ├── SensorPanel.jsx
│       │   ├── RelayStatus.jsx
│       │   └── TrendChart.jsx
│       └── App.jsx
├── docs/
│   └── ahtesham-workflow.md
├── .env.example
├── .gitignore
└── README.md
```

---

## Project Status

- [x] Phase 1 — Hardware bringup (DHT22 + relay wired and confirmed)
- [x] Phase 2 — ESP32 HTTP API (/sensor + /relay live)
- [x] Phase 3 — FastAPI bridge server + Claude agent tool-calling
- [x] Phase 4 — Guardrails + rolling sensor memory
- [ ] Phase 5 — React frontend (in progress)
- [ ] Phase 6 — Integration + demo video

---

## Team

| Name | Role |
|---|---|
| Yawar Abbas | Bridge server, Claude agent, SQLite logging, firmware |
| Ahtesham | React frontend, live sensor panel, trend charts |

**PM:** Muhammad Arslan — AgileTech Studio, Lahore