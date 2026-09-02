import anthropic
from config import settings
from tools import TOOL_DEFINITIONS, get_sensor_reading, set_relay, get_relay_cooldown_status
from logger import log_sensor_read, log_relay_action
from memory import get_trend_summary

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

SYSTEM_PROMPT = """You are an intelligent IoT controller managing a room environment via an ESP32 device.

You have access to two tools:
- get_sensor_reading: reads live temperature and humidity from the room
- set_relay: turns a physical relay ON or OFF (controls a fan or lamp)

Rules you must always follow:
1. Always check sensor data before deciding to control the relay — never act blind.
2. Always explain WHY you are taking an action, referencing the actual sensor values.
3. If the user asks about room conditions, always call get_sensor_reading first.
4. Only control the relay when the user explicitly asks, or when sensor data clearly justifies it.
5. Keep responses concise and friendly — you are a helpful room assistant.
6. Always tell the user what action you took and what the current sensor readings are.
7. If the relay is on cooldown, explain clearly how many seconds remain — do not attempt to toggle it.
8. Use the sensor trend history to make smarter decisions — a rising trend justifies action sooner.
"""

def _build_context_block(relay_state: str) -> str:
    """Build a dynamic context block injected into every agent request."""
    cooldown = get_relay_cooldown_status()
    trend = get_trend_summary()

    cooldown_msg = (
        f"Relay cooldown: READY (no restriction)"
        if cooldown["ready"]
        else f"Relay cooldown: ACTIVE — {cooldown['cooldown_remaining']} seconds remaining before next toggle allowed."
    )

    return (
        f"\n\n--- SYSTEM CONTEXT (injected, not from user) ---\n"
        f"Current relay state: {relay_state}\n"
        f"{cooldown_msg}\n"
        f"Sensor trend: {trend}\n"
        f"--- END SYSTEM CONTEXT ---"
    )


async def run_agent(user_message: str, relay_state: str = "off") -> dict:
    """
    Run the Claude tool-calling agent loop for a single user message.
    Returns the final text reply and a list of actions taken.
    """
    context = _build_context_block(relay_state)
    augmented_message = user_message + context

    messages = [{"role": "user", "content": augmented_message}]
    actions = []
    final_reply = ""

    while True:
        response = client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOL_DEFINITIONS,
            messages=messages
        )

        # Add Claude's response to the message history
        messages.append({"role": "assistant", "content": response.content})

        # If end_turn, Claude is done
        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    final_reply = block.text
            break

        # If tool_use, execute the requested tools
        if response.stop_reason == "tool_use":
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input

                if tool_name == "get_sensor_reading":
                    result = await get_sensor_reading()
                    await log_sensor_read(
                        temperature=result["temperature"],
                        humidity=result["humidity"],
                        reasoning=f"Agent requested sensor read for: {user_message}"
                    )
                    actions.append({"tool": "get_sensor_reading", "result": result})

                elif tool_name == "set_relay":
                    state = tool_input["state"]
                    result = await set_relay(state)
                    if result.get("status") == "ok":
                        await log_relay_action(
                            state=state,
                            reasoning=f"Agent set relay {state} for: {user_message}"
                        )
                        actions.append({"tool": "set_relay", "state": state})
                    else:
                        # Rate limited — log it but don't update relay state
                        actions.append({
                            "tool": "set_relay",
                            "blocked": True,
                            "reason": result.get("reason", "Rate limited")
                        })

                else:
                    result = {"error": f"Unknown tool: {tool_name}"}

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(result)
                })

            messages.append({"role": "user", "content": tool_results})

    return {"reply": final_reply, "actions": actions}