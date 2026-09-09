from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from agent import run_agent
from auth import (
    create_access_token,
    create_users_table,
    get_admin_user,
    get_current_user,
    create_user,
    verify_user,
)
from logger import init_db, get_all_logs
from config import settings
from scheduler import (
    scheduler,
    get_pending_jobs,
    cancel_job,
    schedule_relay_at,
    schedule_relay_weekly,
    schedule_relay_on_date,
    update_job,
    WEEKDAYS,
)
from tools import set_relay, get_relay_cooldown_status
import state as app_state
import asyncio
import httpx
import re
import time

TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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
    create_users_table()

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

class ScheduleCreateRequest(BaseModel):
    state: str
    time_str: str
    schedule_type: str = "once"  # "once" | "weekly" | "date"
    days: Optional[list[str]] = None  # required for "weekly" — e.g. ["mon", "wed", "fri"]
    date_str: Optional[str] = None  # required for "date" — "YYYY-MM-DD"

class ScheduleUpdateRequest(BaseModel):
    state: str
    time_str: str
    schedule_type: str = "once"
    days: Optional[list[str]] = None
    date_str: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


def _validate_schedule_fields(request) -> None:
    """Shared validation for the create/edit request bodies."""
    if request.state not in ("on", "off"):
        raise HTTPException(status_code=400, detail="State must be 'on' or 'off'.")
    if not TIME_RE.match(request.time_str):
        raise HTTPException(status_code=400, detail="time_str must be 'HH:MM' in 24-hour format.")
    if request.schedule_type not in ("once", "weekly", "date"):
        raise HTTPException(status_code=400, detail="schedule_type must be 'once', 'weekly', or 'date'.")
    if request.schedule_type == "weekly":
        if not request.days:
            raise HTTPException(status_code=400, detail="days is required for schedule_type 'weekly'.")
        bad = [d for d in request.days if str(d).strip().lower()[:3] not in WEEKDAYS]
        if bad:
            raise HTTPException(status_code=400, detail=f"Invalid day(s): {bad}. Use mon/tue/wed/thu/fri/sat/sun.")
    if request.schedule_type == "date":
        if not request.date_str or not DATE_RE.match(request.date_str):
            raise HTTPException(status_code=400, detail="date_str is required for schedule_type 'date', format 'YYYY-MM-DD'.")


# ── Routes ──

@app.post("/auth/login")
async def login(request: LoginRequest):
    """Verify credentials and issue a JWT."""
    user = verify_user(request.username, request.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    access_token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer", "role": user["role"]}


@app.post("/auth/register")
async def register(request: RegisterRequest, _admin: dict = Depends(get_admin_user)):
    """Create a new user. Requires an admin token."""
    try:
        create_user(request.username, request.password, role=request.role)
    except ValueError:
        raise HTTPException(status_code=400, detail="Username already exists.")
    return {"message": "User created successfully"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, _user: dict = Depends(get_current_user)):
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
async def sensor(_user: dict = Depends(get_current_user)):
    """Return cached sensor data — no direct ESP32 call."""
    if app_state.sensor_cache["temperature"] is None:
        raise HTTPException(status_code=503, detail="Sensor data not yet available.")
    return {
        "temperature": app_state.sensor_cache["temperature"],
        "humidity": app_state.sensor_cache["humidity"],
        "last_updated": app_state.sensor_cache["last_updated"]
    }


@app.get("/logs")
async def logs(_user: dict = Depends(get_current_user)):
    """Return all logged events for TrendChart."""
    return await get_all_logs()


@app.get("/relay/status")
async def relay_status(_user: dict = Depends(get_current_user)):
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


@app.get("/preview")
async def preview():
    """
    Public, unauthenticated snapshot of live temperature/humidity/relay state
    for the login page's dashboard preview. No control surface, no per-user data.
    """
    return {
        "temperature": app_state.sensor_cache["temperature"],
        "humidity": app_state.sensor_cache["humidity"],
        "relay": app_state.relay_state["state"],
        "last_updated": app_state.sensor_cache["last_updated"],
    }


@app.post("/relay")
async def toggle_relay(request: RelayToggleRequest, _user: dict = Depends(get_current_user)):
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
async def get_schedule(_user: dict = Depends(get_current_user)):
    """Return all pending scheduled jobs."""
    return get_pending_jobs()


@app.post("/schedule")
async def create_schedule(request: ScheduleCreateRequest, _user: dict = Depends(get_current_user)):
    """
    Schedule a relay action:
    - schedule_type "once" (default): today, or tomorrow if that time already passed.
    - schedule_type "weekly": recurring every selected weekday, until cancelled.
    - schedule_type "date": once, on a specific future calendar date.
    """
    _validate_schedule_fields(request)

    try:
        if request.schedule_type == "weekly":
            result = schedule_relay_weekly(request.state, request.days, request.time_str, reason="Added via scheduler UI")
        elif request.schedule_type == "date":
            result = schedule_relay_on_date(request.state, request.date_str, request.time_str, reason="Added via scheduler UI")
        else:
            result = schedule_relay_at(request.state, request.time_str, reason="Added via scheduler UI")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"created": True, **result}


@app.put("/schedule/{job_id}")
async def edit_schedule(job_id: str, request: ScheduleUpdateRequest, _user: dict = Depends(get_current_user)):
    """Edit a pending job's action, time, and/or recurrence, by ID, list number, or time."""
    _validate_schedule_fields(request)

    result = update_job(
        job_id,
        request.state,
        request.time_str,
        schedule_type=request.schedule_type,
        days=request.days,
        date_str=request.date_str,
    )
    if not result.get("updated"):
        reason = result.get("reason")
        if reason in ("not_found", "no_jobs"):
            raise HTTPException(status_code=404, detail="Job not found.")
        if reason in ("invalid_input", "invalid_state", "invalid_time", "invalid_schedule_type"):
            raise HTTPException(status_code=400, detail=result.get("detail") or reason)
        raise HTTPException(status_code=500, detail="Could not update job.")
    return result


@app.delete("/schedule/{job_id}")
async def delete_schedule(job_id: str, _user: dict = Depends(get_current_user)):
    """Cancel a scheduled job by ID, list number, or time."""
    result = cancel_job(job_id)
    if not result.get("cancelled"):
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"cancelled": result.get("label") or job_id}