import httpx
import time
from config import settings

# ── Relay rate limiting ──
_last_relay_toggle: float = 0.0
RELAY_COOLDOWN_SECONDS: int = 30

# ── Tool schemas ──
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
            "Turn the relay ON or OFF. The relay controls a physical device "
            "(fan or lamp) connected to the ESP32. Only call this when the user "
            "explicitly wants to control the device, or when sensor data clearly "
            "justifies automatic action. Respects a 30-second cooldown between toggles."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "state": {
                    "type": "string",
                    "enum": ["on", "off"],
                    "description": "The desired relay state. 'on' activates the device, 'off' deactivates it."
                }
            },
            "required": ["state"]
        }
    }
]

# ── Tool implementations ──

async def get_sensor_reading() -> dict:
    """Call ESP32 /sensor endpoint and return temperature and humidity."""
    from memory import record_reading
    url = f"{settings.esp32_base_url}/sensor"
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
        record_reading(data["temperature"], data["humidity"])
        return data


async def set_relay(state: str) -> dict:
    """Call ESP32 /relay endpoint with rate limiting and retry logic."""
    global _last_relay_toggle

    if state not in ("on", "off"):
        raise ValueError(f"Invalid relay state: {state}. Must be 'on' or 'off'.")

    # ── Rate limit check ──
    elapsed = time.time() - _last_relay_toggle
    remaining = RELAY_COOLDOWN_SECONDS - elapsed

    if remaining > 0:
        return {
            "status": "rate_limited",
            "reason": (
                f"Relay was toggled {int(elapsed)} seconds ago. "
                f"Please wait {int(remaining)} more seconds before toggling again."
            )
        }

    # ── Execute relay toggle ──
    url = f"{settings.esp32_base_url}/relay"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.post(url, json={"state": state})
                response.raise_for_status()
                _last_relay_toggle = time.time()
                return {"status": "ok", "relay": state}
        except httpx.ReadError:
            if attempt < 2:
                import asyncio
                await asyncio.sleep(0.5)
                continue
            raise


def get_relay_cooldown_status() -> dict:
    """Return how many seconds remain in the cooldown period."""
    elapsed = time.time() - _last_relay_toggle
    remaining = max(0.0, RELAY_COOLDOWN_SECONDS - elapsed)
    return {
        "seconds_since_last_toggle": int(elapsed),
        "cooldown_remaining": int(remaining),
        "ready": remaining == 0
    }