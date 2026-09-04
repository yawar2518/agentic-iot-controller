from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from agent import run_agent
from logger import init_db, get_all_logs
from config import settings
from scheduler import scheduler, get_pending_jobs, cancel_job
from tools import set_relay, get_relay_cooldown_status
import state as app_state
import asyncio
import httpx
import time

# ── Background sensor polling ──
async def _poll_sensor():
    """Poll ESP32 every 20 seconds and cache the result."""
    while True:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(f"{settings.esp32_base_url}/sensor")
                response.raise_for_status()
                data = response.json()
                app_state.sensor_cache["temperature"] = data["temperature"]
                app_state.sensor_cache["humidity"] = data["humidity"]
                from datetime import datetime, timezone
                app_state.sensor_cache["last_updated"] = datetime.now(timezone.utc).isoformat()
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
            app_state.relay_state["state"] = data.get("relay", "off")
    except Exception:
        app_state.relay_state["state"] = "off"

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

class RelayToggleRequest(BaseModel):
    state: str


# ── Routes ──

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Receive user message, run agent, return reply."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    result = await run_agent(
        request.message,
        relay_state=app_state.relay_state["state"]
    )

    for action in result["actions"]:
        if action.get("tool") == "set_relay" and not action.get("blocked"):
            app_state.relay_state["state"] = action["state"]

    return ChatResponse(reply=result["reply"], actions=result["actions"])


@app.get("/sensor")
async def sensor():
    """Return cached sensor data — no direct ESP32 call."""
    if app_state.sensor_cache["temperature"] is None:
        raise HTTPException(status_code=503, detail="Sensor data not yet available.")
    return {
        "temperature": app_state.sensor_cache["temperature"],
        "humidity": app_state.sensor_cache["humidity"],
        "last_updated": app_state.sensor_cache["last_updated"]
    }


@app.get("/logs")
async def logs():
    """Return all logged events for TrendChart."""
    return await get_all_logs()


@app.get("/relay/status")
async def relay_status():
    """Return relay state with cooldown info — computed fresh from server clock."""
    elapsed = time.time() - app_state.last_toggle_at
    remaining = max(0.0, settings.COOLDOWN_SECONDS - elapsed)
    return {
        "relay": app_state.relay_state["state"],
        "relay_on": app_state.relay_state["state"] == "on",
        "cooldown_active": remaining > 0,
        "cooldown_remaining": int(remaining),
        "cooldown_total": settings.COOLDOWN_SECONDS
    }


@app.post("/relay")
async def toggle_relay(request: RelayToggleRequest):
    """Direct relay toggle — enforces cooldown, returns 429 if active."""
    if request.state not in ("on", "off"):
        raise HTTPException(status_code=400, detail="State must be 'on' or 'off'.")

    elapsed = time.time() - app_state.last_toggle_at
    remaining = max(0.0, settings.COOLDOWN_SECONDS - elapsed)

    if remaining > 0:
        return JSONResponse(
            status_code=429,
            content={
                "error": "cooldown_active",
                "cooldown_remaining": int(remaining),
                "message": "Relay is cooling down."
            }
        )

    result = await set_relay(request.state)

    if result.get("status") == "ok":
        app_state.relay_state["state"] = request.state
        return {"relay": request.state, "cooldown_remaining": 0}

    raise HTTPException(status_code=503, detail="ESP32 unreachable.")


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