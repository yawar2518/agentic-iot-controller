from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent import run_agent
from tools import get_sensor_reading
from logger import init_db, get_all_logs
from config import settings
from scheduler import scheduler, get_pending_jobs, cancel_job
import asyncio
import httpx

# ── In-memory state ──
relay_state = {"state": "off"}
sensor_cache = {"temperature": None, "humidity": None, "last_updated": None}


# ── Background sensor polling ──
async def _poll_sensor():
    """Poll ESP32 every 20 seconds and cache the result."""
    while True:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(f"{settings.esp32_base_url}/sensor")
                response.raise_for_status()
                data = response.json()
                sensor_cache["temperature"] = data["temperature"]
                sensor_cache["humidity"] = data["humidity"]
                from datetime import datetime, timezone
                sensor_cache["last_updated"] = datetime.now(timezone.utc).isoformat()
                from memory import record_reading
                record_reading(data["temperature"], data["humidity"])
        except Exception as e:
            print(f"[SENSOR POLL] Failed: {e}")
        await asyncio.sleep(20)


# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # Sync relay state from ESP32
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{settings.esp32_base_url}/relay/status")
            data = response.json()
            relay_state["state"] = data.get("relay", "off")
    except Exception:
        relay_state["state"] = "off"

    # Start background sensor polling
    sensor_task = asyncio.create_task(_poll_sensor())

    # Start scheduler
    scheduler.start()

    yield

    # Cleanup
    sensor_task.cancel()
    scheduler.shutdown()


# ── App ──
app = FastAPI(
    title="Agentic IoT Bridge Server",
    description="FastAPI bridge between Groq agent and ESP32 hardware",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──
class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str
    actions: list


# ── Routes ──

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Receive user message, run agent, return reply."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    result = await run_agent(request.message, relay_state=relay_state["state"])

    for action in result["actions"]:
        if action.get("tool") == "set_relay" and not action.get("blocked"):
            relay_state["state"] = action["state"]

    return ChatResponse(reply=result["reply"], actions=result["actions"])


@app.get("/sensor")
async def sensor():
    """Return cached sensor data — no direct ESP32 call."""
    if sensor_cache["temperature"] is None:
        raise HTTPException(status_code=503, detail="Sensor data not yet available.")
    return {
        "temperature": sensor_cache["temperature"],
        "humidity": sensor_cache["humidity"],
        "last_updated": sensor_cache["last_updated"]
    }


@app.get("/logs")
async def logs():
    """Return all logged events for TrendChart."""
    return await get_all_logs()


@app.get("/relay/status")
async def relay_status():
    """Return current relay state."""
    return {"relay": relay_state["state"]}


@app.get("/schedule")
async def get_schedule():
    """Return all pending scheduled jobs."""
    return get_pending_jobs()


@app.delete("/schedule/{job_id}")
async def delete_schedule(job_id: str):
    """Cancel a scheduled job."""
    success = cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"cancelled": job_id}