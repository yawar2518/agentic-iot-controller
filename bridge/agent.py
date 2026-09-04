from groq import Groq
from config import settings
from tools import TOOL_DEFINITIONS, get_sensor_reading, set_relay, get_relay_cooldown_status
from logger import log_sensor_read, log_relay_action
from memory import get_trend_summary
from state import sensor_cache
import json
import threading
import time
import httpx

client = Groq(api_key=settings.GROQ_API_KEY)

SYSTEM_PROMPT = """You are an intelligent IoT controller managing a room environment via an ESP32 device.

You have access to these tools:
- get_sensor_reading: reads live temperature and humidity from the room
- set_relay: turns a physical relay ON or OFF (controls a fan or lamp)
- schedule_relay_after: schedule relay action after X minutes
- schedule_relay_at: schedule relay action at specific time of day
- get_scheduled_jobs: list all pending scheduled jobs
- cancel_scheduled_job: cancel a scheduled job by ID

Your ONLY job is to help users monitor and control their room environment.

Rules you must always follow:
1. ONLY answer questions related to temperature, humidity, room conditions, or relay/device control.
2. If the user asks anything unrelated to room environment or device control, politely decline and redirect them. Example: "I'm only able to help with room environment monitoring and device control."
3. Always try to check sensor data before deciding to control the relay. However, if the sensor is unavailable and the user explicitly insists or repeats the request, proceed with the relay action without sensor data and inform the user that you are acting without current readings.
4. Always explain WHY you are taking an action, referencing the actual sensor values if available. If sensor is unavailable, still act on explicit user request and mention sensor was unreachable.
5. If the user asks about room conditions, always call get_sensor_reading first.
6. If the user expresses discomfort — feeling hot, warm, stuffy, sweaty, cold, or any similar sentiment — read the sensor and ACT immediately. Turn the relay ON if they feel hot/warm/stuffy. Turn it OFF if they feel cold. Do NOT ask for confirmation — just act and explain what you did.
7. Keep responses concise and friendly.
8. Always tell the user what action you took and what the current sensor readings are.
9. If the relay is on cooldown, inform the user you will execute the action automatically once the cooldown expires — then it will happen without them asking again.
10. Use the sensor trend history to make smarter decisions — a rising trend justifies action sooner.
11. For time-based requests use the correct scheduling tool:
    - Convert 12-hour format (4:42pm) to 24-hour format (16:42) before calling schedule_relay_at.
      Examples: 6pm -> 18:00, 4:42pm -> 16:42, 8:30am -> 08:30, 12pm -> 12:00, 12am -> 00:00
    - "turn off after 2 hours" -> schedule_relay_after(state="off", delay_minutes=120)
    - "turn on at 6pm" -> schedule_relay_at(state="on", time_str="18:00")
    - If user gives MULTIPLE time-based instructions in one message, call the scheduling tool MULTIPLE times.
    - All times are in Pakistan Standard Time (PKT, UTC+5).
    - Always confirm the scheduled PKT time back to the user.
    - Always mention the job can be cancelled if they change their mind.
    - IMPORTANT: Before scheduling, check the current relay state from SYSTEM CONTEXT.
      If user asks to schedule an action that matches current state, inform the user.
12. If user asks to see scheduled jobs, call get_scheduled_jobs and list them clearly with job ID, state, and run time in PKT.
13. If user asks to cancel a job, call cancel_scheduled_job with the job ID. If multiple jobs exist, list them first and ask which one to cancel.
"""

GROQ_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_sensor_reading",
            "description": (
                "Read the current temperature and humidity from the ESP32 sensor. "
                "Call this whenever the user asks about room conditions, temperature, "
                "humidity, or before deciding whether to control the relay."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_relay",
            "description": (
                "Turn the relay ON or OFF immediately. Controls a physical fan or lamp. "
                "Only call when user explicitly requests or sensor data justifies it. "
                "Respects a 30-second cooldown between toggles."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "enum": ["on", "off"],
                        "description": "Desired relay state."
                    }
                },
                "required": ["state"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_relay_after",
            "description": (
                "Schedule the relay to turn ON or OFF after a specified number of minutes. "
                "Use this when the user says 'turn off after X minutes/hours' or "
                "'keep it on for X minutes'. Convert hours to minutes before calling."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "enum": ["on", "off"],
                        "description": "Relay state to set at scheduled time."
                    },
                    "delay_minutes": {
                        "type": "number",
                        "description": "How many minutes from now to execute. Convert hours to minutes."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief reason for this scheduled action."
                    }
                },
                "required": ["state", "delay_minutes", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_relay_at",
            "description": (
                "Schedule the relay to turn ON or OFF at a specific time of day. "
                "Use this when the user says 'turn on at 6pm' or 'turn off at 8:30'. "
                "Convert to 24-hour HH:MM format."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "enum": ["on", "off"],
                        "description": "Relay state to set at scheduled time."
                    },
                    "time_str": {
                        "type": "string",
                        "description": "Time in 24-hour HH:MM format. e.g. '18:00' for 6pm."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief reason for this scheduled action."
                    }
                },
                "required": ["state", "time_str", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_scheduled_jobs",
            "description": (
                "Get a list of all currently scheduled relay jobs. "
                "Call this when the user asks to see pending schedules, "
                "upcoming jobs, or what is scheduled."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_scheduled_job",
            "description": (
                "Cancel a scheduled relay job by its job ID. "
                "Call this when the user wants to cancel, remove, or stop "
                "a scheduled job. Ask the user which job to cancel if unclear."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {
                        "type": "string",
                        "description": "The job ID to cancel."
                    }
                },
                "required": ["job_id"]
            }
        }
    }
]


def _build_context_block(relay_state: str) -> str:
    """Build dynamic context injected into every agent request."""
    cooldown = get_relay_cooldown_status()
    trend = get_trend_summary()

    cooldown_msg = (
        "Relay cooldown: READY (no restriction)"
        if cooldown["ready"]
        else f"Relay cooldown: ACTIVE - {cooldown['cooldown_remaining']} seconds remaining."
    )

    return (
        f"\n\n--- SYSTEM CONTEXT (injected, not from user) ---\n"
        f"Current relay state: {relay_state}\n"
        f"{cooldown_msg}\n"
        f"Sensor trend: {trend}\n"
        f"--- END SYSTEM CONTEXT ---"
    )


def _execute_delayed_relay(state: str, delay: int, user_message: str) -> None:
    """Run in a thread - wait for cooldown then execute relay action synchronously."""
    print(f"[DELAYED RELAY] Thread started - waiting {delay + 1}s to set relay {state}")
    time.sleep(delay + 1)
    print(f"[DELAYED RELAY] Executing relay {state}")

    url = f"{settings.esp32_base_url}/relay"
    for attempt in range(3):
        try:
            response = httpx.post(url, json={"state": state}, timeout=10.0)
            response.raise_for_status()
            print(f"[DELAYED RELAY] Success - relay is now {state}")
            return
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
                continue
            print(f"[DELAYED RELAY] Failed after 3 attempts: {e}")


async def run_agent(
    user_message: str,
    relay_state: str = "off"
) -> dict:
    """Run the Groq tool-calling agent loop for a single user message."""
    context = _build_context_block(relay_state)
    augmented_message = user_message + context

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": augmented_message}
    ]
    actions = []
    final_reply = ""

    while True:
        response = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            max_tokens=1024,
            tools=GROQ_TOOL_DEFINITIONS,
            tool_choice="auto",
            messages=messages
        )

        message = response.choices[0].message
        finish_reason = response.choices[0].finish_reason

        messages.append({
            "role": "assistant",
            "content": message.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                }
                for tc in (message.tool_calls or [])
            ] or None
        })

        if finish_reason == "stop" or not message.tool_calls:
            final_reply = message.content or ""
            break

        for tool_call in message.tool_calls:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments or "{}")
            print(f"[AGENT] Tool called: {tool_name} args: {tool_args}")

            if tool_name == "get_sensor_reading":
                if sensor_cache["temperature"] is not None:
                    result = {
                        "temperature": sensor_cache["temperature"],
                        "humidity": sensor_cache["humidity"]
                    }
                    from memory import record_reading
                    record_reading(result["temperature"], result["humidity"])
                else:
                    try:
                        result = await get_sensor_reading()
                    except Exception:
                        result = {"error": "ESP32 unreachable - sensor data unavailable"}
                        result_str = str(result)
                        actions.append({"tool": "get_sensor_reading", "result": result})
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": result_str
                        })
                        continue

                if "error" not in result:
                    await log_sensor_read(
                        temperature=result["temperature"],
                        humidity=result["humidity"],
                        reasoning=f"Agent requested sensor read for: {user_message}"
                    )
                actions.append({"tool": "get_sensor_reading", "result": result})
                result_str = str(result)

            elif tool_name == "set_relay":
                state = tool_args["state"]
                result = await set_relay(state)

                if result.get("status") == "ok":
                    await log_relay_action(
                        state=state,
                        reasoning=f"Agent set relay {state} for: {user_message}"
                    )
                    actions.append({"tool": "set_relay", "state": state})

                elif result.get("status") == "rate_limited":
                    seconds_remaining = get_relay_cooldown_status()["cooldown_remaining"]

                    thread = threading.Thread(
                        target=_execute_delayed_relay,
                        args=(state, seconds_remaining, user_message),
                        daemon=True
                    )
                    thread.start()
                    print(f"[DELAYED RELAY] Thread launched - relay {state} in {seconds_remaining + 1}s")

                    actions.append({
                        "tool": "set_relay",
                        "blocked": True,
                        "scheduled": True,
                        "delay_seconds": seconds_remaining,
                        "state": state
                    })

                else:
                    actions.append({
                        "tool": "set_relay",
                        "blocked": True,
                        "reason": result.get("reason", "Rate limited")
                    })

                result_str = str(result)

            elif tool_name == "schedule_relay_after":
                from scheduler import schedule_relay_after
                delay_minutes = tool_args["delay_minutes"]
                state = tool_args["state"]
                reason = tool_args.get("reason", "User requested")
                result = schedule_relay_after(state, delay_minutes, reason)
                actions.append({
                    "tool": "schedule_relay_after",
                    "state": state,
                    "delay_minutes": delay_minutes,
                    "job_id": result["job_id"],
                    "run_at": result["run_at"]
                })
                result_str = str(result)

            elif tool_name == "schedule_relay_at":
                from scheduler import schedule_relay_at
                state = tool_args["state"]
                time_str = tool_args["time_str"]
                reason = tool_args.get("reason", "User requested")
                result = schedule_relay_at(state, time_str, reason)
                actions.append({
                    "tool": "schedule_relay_at",
                    "state": state,
                    "time_str": time_str,
                    "job_id": result["job_id"],
                    "run_at": result["run_at_pkt"]
                })
                result_str = str(result)

            elif tool_name == "get_scheduled_jobs":
                from scheduler import get_pending_jobs
                result = get_pending_jobs()
                if not result:
                    result_str = "No scheduled jobs found."
                else:
                    result_str = str(result)
                actions.append({
                    "tool": "get_scheduled_jobs",
                    "jobs": result
                })

            elif tool_name == "cancel_scheduled_job":
                from scheduler import cancel_job
                job_id = tool_args["job_id"]
                success = cancel_job(job_id)
                result = {
                    "cancelled": success,
                    "job_id": job_id
                }
                actions.append({
                    "tool": "cancel_scheduled_job",
                    "job_id": job_id,
                    "success": success
                })
                result_str = str(result)

            else:
                result_str = json.dumps({"error": f"Unknown tool: {tool_name}"})

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result_str
            })

    return {"reply": final_reply, "actions": actions}