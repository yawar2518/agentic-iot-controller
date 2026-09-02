import httpx
from config import settings

# ── Tool schemas — Claude reads these to understand available tools ──

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
            "justifies automatic action."
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

# ── Tool implementations — actual HTTP calls to ESP32 ──

async def get_sensor_reading() -> dict:
    """Call ESP32 /sensor endpoint and return temperature and humidity."""
    url = f"{settings.esp32_base_url}/sensor"
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()

async def set_relay(state: str) -> dict:
    """Call ESP32 /relay endpoint to turn the relay on or off."""
    if state not in ("on", "off"):
        raise ValueError(f"Invalid relay state: {state}. Must be 'on' or 'off'.")
    url = f"{settings.esp32_base_url}/relay"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.post(url, json={"state": state})
                response.raise_for_status()
                return {"status": "ok", "relay": state}
        except httpx.ReadError:
            if attempt < 2:
                import asyncio
                await asyncio.sleep(0.5)
                continue
            raise