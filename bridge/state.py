import time

# Shared in-memory state
relay_state = {"state": "off"}
sensor_cache = {"temperature": None, "humidity": None, "last_updated": None}
last_toggle_at: float = 0.0