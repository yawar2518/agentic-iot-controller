# Ahtesham — Workflow Instructions
# Agentic IoT Controller | AgileTech Studio | September 2026

---

## Your Role
You own the entire React frontend:
- ChatWindow.jsx — chat UI, message input, conversation history
- SensorPanel.jsx — live temperature and humidity (polls every 5s)
- RelayStatus.jsx — ON/OFF indicator with green/red color
- TrendChart.jsx — Recharts time series with relay markers

You do NOT touch firmware, bridge server, or anything in bridge/ or firmware/.

---

## One-Time Setup

### 1. Clone the repo
git clone https://github.com/yawar2518/agentic-iot-controller.git
cd agentic-iot-controller

### 2. Switch to your branch
git checkout ahtesham/react-frontend

### 3. Scaffold React in the frontend/ directory
cd frontend
npm create vite@latest . -- --template react
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install recharts
npm install axios

### 4. Create your .env file (inside frontend/)
Create a file called .env with this content:
VITE_API_BASE_URL=http://localhost:8000

This is already gitignored. Never commit real credentials.

---

## API Contract

All your API calls go to: http://localhost:8000 (Yawar's FastAPI server)
Read from VITE_API_BASE_URL environment variable, not hardcoded.

| Method | Endpoint       | Request Body            | Response                                      |
|--------|----------------|-------------------------|-----------------------------------------------|
| POST   | /chat          | {"message": "string"}   | {"reply": "string", "actions": []}            |
| GET    | /sensor        | none                    | {"temperature": 27.4, "humidity": 63.4}       |
| GET    | /logs          | none                    | [{"timestamp": "...", "temp": 27.4, "relay": "on"}] |
| GET    | /relay/status  | none                    | {"relay": "on" or "off"}                      |

---

## Working Without Yawar's Server (Mock Mode)

Yawar's server will not be ready on day one.
Build everything against mock data first. Example:

// In SensorPanel.jsx during development:
const mockSensor = { temperature: 28.5, humidity: 65.0 };

// In RelayStatus.jsx during development:
const mockRelay = { relay: "off" };

// In TrendChart.jsx during development:
const mockLogs = [
  { timestamp: "2026-09-02T10:00:00", temp: 27.4, humidity: 63.0, relay: "off" },
  { timestamp: "2026-09-02T10:05:00", temp: 28.1, humidity: 64.0, relay: "on"  },
  { timestamp: "2026-09-02T10:10:00", temp: 27.8, humidity: 63.5, relay: "off" }
];

When Yawar's server is ready, you change one line:
const BASE_URL = import.meta.env.VITE_API_BASE_URL;
and replace mock data with real axios calls. Zero other changes needed.

---

## Daily Git Workflow

### Start of day — pull latest
git checkout ahtesham/react-frontend
git pull origin ahtesham/react-frontend

### Work, then commit
git add .
git commit -m "feat(frontend): add SensorPanel with mock data"

### Push your work
git push origin ahtesham/react-frontend

### Commit message format (mandatory)
feat(frontend): short description       ← new feature
fix(frontend): short description        ← bug fix
chore(frontend): short description      ← setup, config, cleanup
style(frontend): short description      ← CSS, layout only

Examples:
feat(frontend): scaffold ChatWindow with message input
feat(frontend): add SensorPanel polling every 5 seconds
feat(frontend): add TrendChart with relay on/off markers
fix(frontend): correct relay status color logic
chore(frontend): configure Tailwind and Vite env variables

---

## When Your Feature Is Ready — PR to dev

1. Push your branch one final time:
   git push origin ahtesham/react-frontend

2. Go to GitHub → agentic-iot-controller → Pull Requests → New Pull Request

3. Set:
   - base: dev
   - compare: ahtesham/react-frontend

4. Title format: feat(frontend): complete React frontend Phase 5

5. Description: list what components you built and what mock data
   they currently use.

6. Assign Yawar as reviewer.

7. Do NOT merge yourself — Yawar merges after review.

---

## Rules

- Never commit to main directly — it is protected
- Never commit to dev directly — your branch is ahtesham/react-frontend
- Never commit .env files — they are gitignored
- Never add UI libraries not in the stack (no MUI, no Chakra, no Bootstrap)
  Allowed: React 18, Vite, Tailwind CSS, Recharts, Axios
- If you need something not on this list, ask Yawar first

---

## Contact

Any questions about the API contract or backend → Yawar Abbas
Any questions about Git workflow → this document