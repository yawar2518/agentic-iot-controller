from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent import run_agent
from tools import get_sensor_reading
from logger import init_db, get_all_logs
from config import settings

# ── Relay state tracker (in-memory) ──
relay_state = {"state": "off"}

# ── Lifespan — runs on startup ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

# ── App ──
app = FastAPI(
    title="Agentic IoT Bridge Server",
    description="FastAPI bridge between Claude agent and ESP32 hardware",
    version="1.0.0",
    lifespan=lifespan
)

# ── CORS — allow React frontend on any local port ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request/Response models ──
class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str
    actions: list

# ── Routes ──

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Receive a user message, run the agent, return the reply."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    result = await run_agent(request.message, relay_state=relay_state["state"])

    # Update in-memory relay state from agent actions
    for action in result["actions"]:
        if action.get("tool") == "set_relay" and not action.get("blocked"):
            relay_state["state"] = action["state"]

    return ChatResponse(reply=result["reply"], actions=result["actions"])


@app.get("/sensor")
async def sensor():
    """Proxy live sensor data from ESP32 to frontend."""
    try:
        data = await get_sensor_reading()
        return data
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ESP32 unreachable: {str(e)}")


@app.get("/logs")
async def logs():
    """Return all logged events for the TrendChart."""
    return await get_all_logs()


@app.get("/relay/status")
async def relay_status():
    """Return current relay state."""
    return {"relay": relay_state["state"]}