from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from datetime import datetime, timezone
import httpx
from config import settings
from logger import log_relay_action
from state import relay_state

# ── Scheduler instance ──
scheduler = AsyncIOScheduler(
    jobstores={"default": MemoryJobStore()},
    job_defaults={"coalesce": False, "max_instances": 1}
)


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
    from datetime import timedelta
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

    return {
        "job_id": job.id,
        "state": state,
        "run_at": run_time.isoformat(),
        "delay_minutes": delay_minutes
    }


def schedule_relay_at(state: str, time_str: str, reason: str) -> dict:
    """Schedule relay action at specific time today in PKT (UTC+5)."""
    from datetime import timedelta

    # PKT = UTC+5
    PKT_OFFSET = timedelta(hours=5)
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

    return {
        "job_id": job.id,
        "state": state,
        "run_at_pkt": run_time_pkt.strftime("%I:%M %p PKT"),
        "run_at_utc": run_time_utc.isoformat(),
        "time_str": time_str
    }


def get_pending_jobs() -> list:
    """Return all pending scheduled jobs."""
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "job_id": job.id,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            "args": job.args
        })
    return jobs


def cancel_job(job_id: str) -> bool:
    """Cancel a scheduled job by ID. Returns True if cancelled."""
    try:
        scheduler.remove_job(job_id)
        return True
    except Exception:
        return False