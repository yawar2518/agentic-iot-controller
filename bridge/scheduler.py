from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.triggers.cron import CronTrigger
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

# Monday-first, matching APScheduler's own day_of_week numbering (mon=0).
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_LABELS = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"}

# CronTrigger has no clean "which weekdays did the user pick, in PKT" getter
# once it's been converted to a UTC-shifted expression — this in-memory
# side table remembers the PKT days per recurring job id so _describe() can
# read them back without reverse-engineering the trigger. It's exactly as
# ephemeral as MemoryJobStore itself (wiped on restart), which matches the
# rest of this scheduler's no-persistence design.
_recurring_meta: dict[str, dict] = {}


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
    When a job will next fire, in UTC.

    APScheduler only populates next_run_time once the scheduler is running;
    before that, ask the trigger directly — this works for both one-shot
    DateTrigger and recurring CronTrigger jobs.
    """
    run_at = getattr(job, "next_run_time", None)
    if run_at is not None:
        return run_at
    try:
        return job.trigger.get_next_fire_time(None, datetime.now(timezone.utc))
    except Exception:
        return getattr(job.trigger, "run_date", None)


def _pkt_days_time_to_utc(days_pkt: list, hour: int, minute: int):
    """
    A PKT weekday selection + wall-clock time -> the UTC weekdays/hour/minute
    CronTrigger actually needs.

    PKT is UTC+5, so subtracting 5 hours from an early-morning PKT time rolls
    the clock back into the previous UTC calendar day — which shifts which
    weekday the cron fires on too. e.g. "Monday 1:00 AM PKT" is
    "Sunday 8:00 PM UTC", not "Monday 8:00 PM UTC".
    """
    total_minutes = hour * 60 + minute - (5 * 60)
    day_shift = -1 if total_minutes < 0 else 0
    utc_minutes = total_minutes % 1440
    utc_hour, utc_minute = divmod(utc_minutes, 60)
    utc_days = [WEEKDAYS[(WEEKDAYS.index(d) + day_shift) % 7] for d in days_pkt]
    return utc_days, utc_hour, utc_minute


def _format_days_label(days_pkt: list) -> str:
    """['mon','wed','fri'] -> 'every Mon, Wed, Fri', with friendly shortcuts."""
    ordered = [d for d in WEEKDAYS if d in days_pkt]
    if ordered == WEEKDAYS:
        return "every day"
    if ordered == WEEKDAYS[:5]:
        return "on weekdays"
    if ordered == WEEKDAYS[5:]:
        return "on weekends"
    return "every " + ", ".join(DAY_LABELS[d] for d in ordered)


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
    base = {
        "state": state,
        "at": _fmt_12h(run_pkt),
        "at_24h": run_pkt.strftime("%H:%M"),
        "in_minutes": minutes_away,
        "_job_id": job.id,
    }

    meta = _recurring_meta.get(job.id)
    if meta and meta.get("schedule_type") == "weekly":
        days_pkt = meta["days_pkt"]
        base["label"] = f"Turn the fan {state.upper()} at {_fmt_12h(run_pkt)} {_format_days_label(days_pkt)}"
        base["schedule_type"] = "weekly"
        base["days"] = days_pkt
        base["date"] = None
        return base

    if meta and meta.get("schedule_type") == "date":
        base["label"] = f"Turn the fan {state.upper()} on {meta['date_str']} at {_fmt_12h(run_pkt)}"
        base["schedule_type"] = "date"
        base["days"] = None
        base["date"] = meta["date_str"]
        return base

    base["label"] = f"Turn the fan {state.upper()} at {_fmt_12h(run_pkt)}"
    base["schedule_type"] = "once"
    base["days"] = None
    base["date"] = None
    return base


async def _execute_scheduled_relay(state: str, reason: str) -> None:
    import state as app_state
    import time as time_module
    print(f"[SCHEDULER] Executing relay {state} — reason: {reason}")
    url = f"{settings.esp32_base_url}/relay"
    headers = {"ngrok-skip-browser-warning": "true"}
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, json={"state": state}, headers=headers)
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


def schedule_relay_weekly(state: str, days: list, time_str: str, reason: str) -> dict:
    """
    Schedule a recurring relay action on selected weekdays at a PKT time.

    Runs indefinitely (every matching weekday) until cancelled — unlike
    schedule_relay_at/schedule_relay_after, this job never disappears on
    its own after firing.
    """
    hour, minute = map(int, time_str.split(":"))
    days_pkt = [str(d).strip().lower()[:3] for d in days]
    invalid = [d for d in days_pkt if d not in WEEKDAYS]
    if invalid:
        raise ValueError(f"Invalid day(s): {invalid}. Use mon/tue/wed/thu/fri/sat/sun.")
    if not days_pkt:
        raise ValueError("Pick at least one day.")

    utc_days, utc_hour, utc_minute = _pkt_days_time_to_utc(days_pkt, hour, minute)
    # timezone="UTC" is required: CronTrigger otherwise interprets hour/minute
    # in the host machine's local system timezone, not UTC — and the manual
    # PKT->UTC shift above only makes sense if "UTC" here really means UTC,
    # regardless of what timezone the server happens to be running in.
    trigger = CronTrigger(day_of_week=",".join(utc_days), hour=utc_hour, minute=utc_minute, timezone="UTC")

    job_id = (
        f"relay_{state}_weekly_{'-'.join(days_pkt)}_{hour:02d}{minute:02d}"
        f"_{int(datetime.now(timezone.utc).timestamp())}"
    )
    job = scheduler.add_job(
        _execute_scheduled_relay,
        trigger,
        args=[state, reason],
        id=job_id,
        replace_existing=False
    )
    _recurring_meta[job.id] = {"schedule_type": "weekly", "days_pkt": days_pkt}

    print(f"[SCHEDULER] Weekly job added: {job.id} relay {state} at {time_str} PKT on {days_pkt}")

    return {
        "state": state,
        "run_at_pkt": f"{_fmt_12h(_to_pkt(_run_time_utc(job)))} PKT",
        "time_str": time_str,
        "days": days_pkt,
        "days_label": _format_days_label(days_pkt),
    }


def schedule_relay_on_date(state: str, date_str: str, time_str: str, reason: str) -> dict:
    """Schedule a one-time relay action on a specific PKT calendar date ('YYYY-MM-DD')."""
    hour, minute = map(int, time_str.split(":"))
    year, month, day = map(int, date_str.split("-"))

    now_utc = datetime.now(timezone.utc)
    now_pkt = now_utc + PKT_OFFSET
    run_time_pkt = now_pkt.replace(
        year=year, month=month, day=day, hour=hour, minute=minute, second=0, microsecond=0
    )

    if run_time_pkt <= now_pkt:
        raise ValueError("That date and time is in the past.")

    run_time_utc = run_time_pkt - PKT_OFFSET

    job = scheduler.add_job(
        _execute_scheduled_relay,
        "date",
        run_date=run_time_utc,
        args=[state, reason],
        id=f"relay_{state}_date_{date_str.replace('-', '')}_{int(run_time_utc.timestamp())}",
        replace_existing=False
    )
    _recurring_meta[job.id] = {"schedule_type": "date", "date_str": date_str}

    return {
        "state": state,
        "run_at_pkt": f"{date_str} {_fmt_12h(run_time_pkt)} PKT",
        "date_str": date_str,
        "time_str": time_str,
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


def _resolve_job(identifier):
    """
    Find a job by whatever the caller actually said — shared by cancel_job
    and update_job so both accept the same three forms.

    Accepts the list number ("2"), a time ("4pm", "16:00"), or a raw job ID
    for backwards compatibility. Returns (job_or_None, all_pending_jobs).
    """
    jobs = _sorted_jobs()
    if not jobs:
        return None, jobs

    token = str(identifier).strip()

    # Exact job ID.
    for job in jobs:
        if job.id == token:
            return job, jobs

    # List number, as presented by get_pending_jobs.
    if token.isdigit():
        position = int(token)
        if 1 <= position <= len(jobs):
            return jobs[position - 1], jobs

    # A time — "4pm", "16:00", "4:30 PM".
    wanted = _parse_time_token(token)
    if wanted:
        for job in jobs:
            if _to_pkt(_run_time_utc(job)).strftime("%H:%M") == wanted:
                return job, jobs

    return None, jobs


def cancel_job(identifier) -> dict:
    """
    Cancel a job by whatever the user actually said.

    Returns the cancelled job's label so the confirmation can name it
    instead of echoing an ID.
    """
    target, jobs = _resolve_job(identifier)

    if not jobs:
        return {"cancelled": False, "reason": "no_jobs", "remaining": 0}

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
    _recurring_meta.pop(target.id, None)

    return {"cancelled": True, "label": label, "remaining": len(jobs) - 1}


def update_job(
    identifier,
    state: str,
    time_str: str,
    schedule_type: str = "once",
    days: list | None = None,
    date_str: str | None = None,
) -> dict:
    """
    Edit a pending job's action, time, and/or recurrence.

    Jobs (one-shot or recurring) aren't designed to have their trigger
    swapped in place — so this resolves the target job the same way
    cancel_job does, removes it, and schedules a replacement, preserving
    the original job's reason for the activity log. `schedule_type` lets an
    edit change kind too (e.g. a one-time job into a weekly one).
    """
    target, jobs = _resolve_job(identifier)

    if not jobs:
        return {"updated": False, "reason": "no_jobs"}
    if target is None:
        return {"updated": False, "reason": "not_found"}
    if state not in ("on", "off"):
        return {"updated": False, "reason": "invalid_state"}
    if not re.match(r"^([01]?\d|2[0-3]):([0-5]\d)$", str(time_str).strip()):
        return {"updated": False, "reason": "invalid_time"}
    if schedule_type not in ("once", "weekly", "date"):
        return {"updated": False, "reason": "invalid_schedule_type"}

    reason = target.args[1] if len(target.args) > 1 else "Edited via scheduler UI"

    try:
        scheduler.remove_job(target.id)
    except Exception:
        return {"updated": False, "reason": "remove_failed"}
    _recurring_meta.pop(target.id, None)

    try:
        if schedule_type == "weekly":
            if not days:
                raise ValueError("Pick at least one day.")
            new_job = schedule_relay_weekly(state, days, time_str, reason)
        elif schedule_type == "date":
            if not date_str:
                raise ValueError("Pick a date.")
            new_job = schedule_relay_on_date(state, date_str, time_str, reason)
        else:
            new_job = schedule_relay_at(state, time_str, reason)
    except ValueError as e:
        return {"updated": False, "reason": "invalid_input", "detail": str(e)}

    return {"updated": True, **new_job}