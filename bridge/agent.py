from groq import Groq
from config import settings
from tools import TOOL_DEFINITIONS, get_sensor_reading, set_relay, get_relay_cooldown_status
from logger import log_sensor_read, log_relay_action
from memory import get_trend_summary
import json
import threading
import time
import httpx

client = Groq(api_key=settings.GROQ_API_KEY)

SYSTEM_PROMPT = """You are an intelligent IoT controller managing a room environment via an ESP32 device.

You have access to two tools:
- get_sensor_reading: reads live temperature and humidity from the room
- set_relay: turns a physical relay ON or OFF (controls a fan or lamp)

Your ONLY job is to help users monitor and control their room environment.

Rules you must always follow:
1. ONLY answer questions related to temperature, humidity, room conditions, or relay/device control.
2. If the user asks anything unrelated to room environment or device control, politely decline and redirect them. Example: "I'm only able to help with room environment monitoring and device control."
3. Always check sensor data before deciding to control the relay — never act blind.
4. Always explain WHY you are taking an action, referencing the actual sensor values.
5. If the user asks about room conditions, always call get_sensor_reading first.
6. If the user expresses discomfort — feeling hot, warm, stuffy, sweaty, cold, or any similar sentiment — read the sensor and ACT immediately. Turn the relay ON if they feel hot/warm/stuffy. Turn it OFF if they feel cold. Do NOT ask for confirmation — just act and explain what you did.
7. Keep responses concise and friendly.
8. Always tell the user what action you took and what the current sensor readings are.
9. If the relay is on cooldown, inform the user you will execute the action automatically once the cooldown expires — then it will happen without them asking again.
10. Use the sensor trend history to make smarter decisions — a rising trend justifies action sooner.
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
                "Turn the relay ON or OFF. Controls a physical fan or lamp. "
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
    }
]


def _build_context_block(relay_state: str) -> str:
    """Build dynamic context injected into every agent request."""
    cooldown = get_relay_cooldown_status()
    trend = get_trend_summary()

    cooldown_msg = (
        "Relay cooldown: READY (no restriction)"
        if cooldown["ready"]
        else f"Relay cooldown: ACTIVE — {cooldown['cooldown_remaining']} seconds remaining."
    )

    return (
        f"\n\n--- SYSTEM CONTEXT (injected, not from user) ---\n"
        f"Current relay state: {relay_state}\n"
        f"{cooldown_msg}\n"
        f"Sensor trend: {trend}\n"
        f"--- END SYSTEM CONTEXT ---"
    )


def _execute_delayed_relay(state: str, delay: int, user_message: str) -> None:
    """Run in a thread — wait for cooldown then execute relay action synchronously."""
    print(f"[DELAYED RELAY] Thread started — waiting {delay + 1}s to set relay {state}")
    time.sleep(delay + 1)
    print(f"[DELAYED RELAY] Executing relay {state}")

    url = f"{settings.esp32_base_url}/relay"
    for attempt in range(3):
        try:
            response = httpx.post(url, json={"state": state}, timeout=10.0)
            response.raise_for_status()
            print(f"[DELAYED RELAY] Success — relay is now {state}")
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

            if tool_name == "get_sensor_reading":
                result = await get_sensor_reading()
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
                    print(f"[DELAYED RELAY] Thread launched — relay {state} in {seconds_remaining + 1}s")

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

            else:
                result_str = json.dumps({"error": f"Unknown tool: {tool_name}"})

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result_str
            })

    return {"reply": final_reply, "actions": actions}