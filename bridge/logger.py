import aiosqlite
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "iot_logs.db")

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    event_type      TEXT    NOT NULL,
    temperature     REAL,
    humidity        REAL,
    relay_state     TEXT,
    agent_reasoning TEXT
);
"""

async def init_db() -> None:
    """Create the events table if it does not exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(CREATE_TABLE_SQL)
        await db.commit()

async def log_sensor_read(temperature: float, humidity: float, reasoning: str = "") -> None:
    """Log a sensor reading event."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO events (timestamp, event_type, temperature, humidity, agent_reasoning)
            VALUES (?, ?, ?, ?, ?)
            """,
            (datetime.now(timezone.utc).isoformat(), "sensor_read", temperature, humidity, reasoning)
        )
        await db.commit()

async def log_relay_action(state: str, reasoning: str = "") -> None:
    """Log a relay action event."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO events (timestamp, event_type, relay_state, agent_reasoning)
            VALUES (?, ?, ?, ?)
            """,
            (datetime.now(timezone.utc).isoformat(), "relay_action", state, reasoning)
        )
        await db.commit()

async def get_all_logs() -> list[dict]:
    """Return all logged events ordered by timestamp ascending."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events ORDER BY timestamp ASC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]