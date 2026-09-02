from collections import deque
from datetime import datetime, timezone

# Rolling window of last 10 sensor readings
MEMORY_SIZE = 10
_sensor_history: deque = deque(maxlen=MEMORY_SIZE)

def record_reading(temperature: float, humidity: float) -> None:
    """Add a sensor reading to the rolling window."""
    _sensor_history.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "temperature": temperature,
        "humidity": humidity
    })

def get_history() -> list[dict]:
    """Return all readings in the rolling window, oldest first."""
    return list(_sensor_history)

def get_trend_summary() -> str:
    """
    Summarize the temperature trend from the rolling window.
    Returns a human-readable string for injection into the agent context.
    """
    history = get_history()

    if len(history) < 2:
        return "Not enough history to determine a trend yet."

    temps = [r["temperature"] for r in history]
    humids = [r["humidity"] for r in history]

    temp_change = temps[-1] - temps[0]
    humid_change = humids[-1] - humids[0]

    if temp_change > 1.0:
        temp_trend = f"rising (+{temp_change:.1f}°C over last {len(history)} readings)"
    elif temp_change < -1.0:
        temp_trend = f"falling ({temp_change:.1f}°C over last {len(history)} readings)"
    else:
        temp_trend = f"stable (±{abs(temp_change):.1f}°C over last {len(history)} readings)"

    if humid_change > 3.0:
        humid_trend = f"rising (+{humid_change:.1f}% over last {len(history)} readings)"
    elif humid_change < -3.0:
        humid_trend = f"falling ({humid_change:.1f}% over last {len(history)} readings)"
    else:
        humid_trend = f"stable (±{abs(humid_change):.1f}% over last {len(history)} readings)"

    latest = history[-1]
    return (
        f"Current: {latest['temperature']}°C, {latest['humidity']}% humidity. "
        f"Temperature trend: {temp_trend}. "
        f"Humidity trend: {humid_trend}. "
        f"Based on {len(history)} readings."
    )