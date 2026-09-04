import httpx
import time
import asyncio
from config import settings

RELAY_COOLDOWN_SECONDS: int = settings.COOLDOWN_SECONDS

TOOL_DEFINITIONS = [
    {
        "name": "get_sensor_reading",
        "description": (
            "Read the current temperature and humidity from the ESP32 sensor. "
            "Call this whenever the user asks about room conditions, temperature, "
            "humidity, or before deciding whether to control the relay."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "set_relay",
        "description": (
            "Turn the relay ON or OFF immediately. Controls a physical fan or lamp. "
            "Only call when user explicitly requests or sensor data justifies it. "
            "Respects a 30-second cooldown between toggles."
        ),
        "input_schema": {
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
]


async def get_sensor_reading() -> dict:
    """Call ESP32 /sensor endpoint with retry logic."""
    from memory import record_reading
    url = f"{settings.esp32_base_url}/sensor"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
                record_reading(data["temperature"], data["humidity"])
                return data
        except (httpx.ReadError, httpx.ConnectError,
                httpx.ConnectTimeout, httpx.ReadTimeout):
            if attempt < 2:
                await asyncio.sleep(1.5)
                continue
            raise


async def set_relay(state: str) -> dict:
    """Call ESP32 /relay endpoint with cooldown enforcement."""
    import state as app_state

    if state not in ("on", "off"):
        raise ValueError(f"Invalid relay state: {state}. Must be 'on' or 'off'.")

    elapsed = time.time() - app_state.last_toggle_at
    remaining = RELAY_COOLDOWN_SECONDS - elapsed

    if remaining > 0:
        return {
            "status": "rate_limited",
            "cooldown_remaining": int(remaining),
            "reason": (
                f"Relay was toggled {int(elapsed)} seconds ago. "
                f"Please wait {int(remaining)} more seconds before toggling again."
            )
        }

    url = f"{settings.esp32_base_url}/relay"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, json={"state": state})
                response.raise_for_status()
                # Only update on confirmed success
                app_state.last_toggle_at = time.time()
                return {"status": "ok", "relay": state}
        except (httpx.ReadError, httpx.ConnectError,
                httpx.ConnectTimeout, httpx.ReadTimeout):
            if attempt < 2:
                await asyncio.sleep(1.0)
                continue
            raise


def get_relay_cooldown_status() -> dict:
    """Return cooldown status computed fresh from server clock."""
    import state as app_state
    elapsed = time.time() - app_state.last_toggle_at
    remaining = max(0.0, RELAY_COOLDOWN_SECONDS - elapsed)
    return {
        "seconds_since_last_toggle": int(elapsed),
        "cooldown_remaining": int(remaining),
        "cooldown_total": RELAY_COOLDOWN_SECONDS,
        "ready": remaining == 0
    }