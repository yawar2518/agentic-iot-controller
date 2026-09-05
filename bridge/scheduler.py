from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from datetime import datetime, timedelta, timezone
import re
import httpx
from config import settings
from logger import log_relay_action
from state import relay_state

# ── Scheduler instance ──
scheduler = AsyncIOScheduler(
    jobstores={"default": MemoryJobStore()},
    job_defaults={"coalesce": False, "max_instances": 1}
)

# Pakistan Standard Time — every user-facing time is rendered in this zone.
PKT_OFFSET = timedelta(hours=5)


def _to_pkt(dt_utc: datetime) -> datetime:
    """UTC-aware datetime -> naive PKT wall-clock time."""
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    return dt_utc.astimezone(timezone.utc) + PKT_OFFSET


def _fmt_12h(dt_pkt: datetime) -> str:
    """PKT datetime -> '4:00 PM' (no leading zero, spoken cleanly)."""
    return dt_pkt.strftime("%I:%M %p").lstrip("0")


def _parse_time_token(text: str) -> str | None:
    """'4pm' / '4:00 PM' / '16:00' -> '16:00'. None if not a time."""
    token = str(text).strip().lower().replace(" ", "").replace(".", "")
    match = re.match(r"^(\d{1,2})(?::(\d{2}))?(am|pm)?$", token)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = match.group(3)
    if meridiem == "pm" and hour != 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _run_time_utc(job) -> datetime | None:
    """
    When a job will fire, in UTC.

    APScheduler only populates next_run_time once the scheduler is running;
    before that the time lives on the trigger, so fall back to it rather than
    reporting no pending jobs.
    """
    run_at = getattr(job, "next_run_time", None)
    if run_at is None:
        run_at = getattr(job.trigger, "run_date", None)
    return run_at


def _sorted_jobs() -> list:
    """Pending jobs, soonest first — the order the user sees and refers to."""
    jobs = [j for j in scheduler.get_jobs() if _run_time_utc(j)]
    return sorted(jobs, key=_run_time_utc)


def _describe(job) -> dict:
    """Everything needed to talk about a job, with no ID in sight."""
    run_at = _run_time_utc(job)
    run_pkt = _to_pkt(run_at)
    state = job.args[0] if job.args else "on"
    minutes_away = max(
        0, int((run_at - datetime.now(timezone.utc)).total_seconds() // 60)
    )
    return {
        "state": state,
        "at": _fmt_12h(run_pkt),
        "at_24h": run_pkt.strftime("%H:%M"),
        "in_minutes": minutes_away,
        "label": f"Turn the fan {state.upper()} at {_fmt_12h(run_pkt)}",
        "_job_id": job.id,
    }


async def _execute_scheduled_relay(state: str, reason: str) -> None:
    import state as app_state
    import time as time_module
    print(f"[SCHEDULER] Executing relay {state} — reason: {reason}")
    url = f"{settings.esp32_base_url}/relay"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, json={"state": state})
                response.raise_for_status()
                app_state.last_toggle_at = time_module.time()
                app_state.relay_state["state"] = state
                await log_relay_action(
                    state=state,
                    reasoning=f"Scheduled: {reason}"
                )
                print(f"[SCHEDULER] Success — relay is now {state}")
                return
        except Exception as e:
            if attempt < 2:
                import asyncio
                await asyncio.sleep(1.0)
                continue
            print(f"[SCHEDULER] Failed after 3 attempts: {e}")


def schedule_relay_after(state: str, delay_minutes: float, reason: str) -> dict:
    """Schedule relay action after X minutes."""
    run_time = datetime.now(timezone.utc) + timedelta(minutes=delay_minutes)

    job = scheduler.add_job(
        _execute_scheduled_relay,
        "date",
        run_date=run_time,
        args=[state, reason],
        id=f"relay_{state}_{int(run_time.timestamp())}",
        replace_existing=False
    )

    print(f"[SCHEDULER] Job added: {job.id} relay {state} at {run_time} UTC")
    print(f"[SCHEDULER] All jobs: {[j.id for j in scheduler.get_jobs()]}")

    # No job_id in the payload: it only ever ended up read out to the user.
    return {
        "state": state,
        "run_at": _fmt_12h(_to_pkt(run_time)),
        "delay_minutes": delay_minutes
    }


def schedule_relay_at(state: str, time_str: str, reason: str) -> dict:
    """Schedule relay action at specific time today in PKT (UTC+5)."""
    now_utc = datetime.now(timezone.utc)
    now_pkt = now_utc + PKT_OFFSET

    hour, minute = map(int, time_str.split(":"))

    # Run time in PKT
    run_time_pkt = now_pkt.replace(hour=hour, minute=minute, second=0, microsecond=0)

    # Agar time past ho gayi toh kal ke liye
    if run_time_pkt <= now_pkt:
        run_time_pkt += timedelta(days=1)

    # Convert back to UTC for scheduler
    run_time_utc = run_time_pkt - PKT_OFFSET

    job = scheduler.add_job(
        _execute_scheduled_relay,
        "date",
        run_date=run_time_utc,
        args=[state, reason],
        id=f"relay_{state}_{int(run_time_utc.timestamp())}",
        replace_existing=False
    )

    # No job_id, no ISO timestamp — just the time as it should be spoken.
    return {
        "state": state,
        "run_at_pkt": f"{_fmt_12h(run_time_pkt)} PKT",
        "time_str": time_str
    }


def get_pending_jobs() -> list:
    """
    Pending jobs as short, readable entries numbered from 1.

    Job IDs are deliberately excluded: they are long machine strings that made
    replies unreadable and were painful to listen to when spoken aloud. The
    number is what the user sees and says, and cancel_job resolves it.
    """
    jobs = []
    for index, job in enumerate(_sorted_jobs(), start=1):
        described = _describe(job)
        described.pop("_job_id", None)
        jobs.append({"number": index, **described})
    return jobs


def cancel_job(identifier) -> dict:
    """
    Cancel a job by whatever the user actually said.

    Accepts the list number ("2"), a time ("4pm", "16:00"), or a raw job ID
    for backwards compatibility. Returns the cancelled job's label so the
    confirmation can name it instead of echoing an ID.
    """
    jobs = _sorted_jobs()
    if not jobs:
        return {"cancelled": False, "reason": "no_jobs", "remaining": 0}

    token = str(identifier).strip()
    target = None

    # Exact job ID.
    for job in jobs:
        if job.id == token:
            target = job
            break

    # List number, as presented by get_pending_jobs.
    if target is None and token.isdigit():
        position = int(token)
        if 1 <= position <= len(jobs):
            target = jobs[position - 1]

    # A time — "4pm", "16:00", "4:30 PM".
    if target is None:
        wanted = _parse_time_token(token)
        if wanted:
            for job in jobs:
                if _to_pkt(_run_time_utc(job)).strftime("%H:%M") == wanted:
                    target = job
                    break

    if target is None:
        return {
            "cancelled": False,
            "reason": "not_found",
            "remaining": len(jobs),
            "pending": [
                {"number": i, "label": _describe(j)["label"]}
                for i, j in enumerate(jobs, start=1)
            ],
        }

    label = _describe(target)["label"]
    try:
        scheduler.remove_job(target.id)
    except Exception:
        return {"cancelled": False, "reason": "remove_failed", "remaining": len(jobs)}

    return {"cancelled": True, "label": label, "remaining": len(jobs) - 1}