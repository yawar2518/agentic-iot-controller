from dotenv import load_dotenv
import os

load_dotenv()

class Settings:
    ESP32_IP: str = os.getenv("ESP32_IP", "192.168.18.43")
    ESP32_PORT: int = int(os.getenv("ESP32_PORT", "80"))
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    CLAUDE_MODEL: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    BRIDGE_HOST: str = os.getenv("BRIDGE_HOST", "0.0.0.0")
    BRIDGE_PORT: int = int(os.getenv("BRIDGE_PORT", "8000"))

    @property
    def esp32_base_url(self) -> str:
        return f"http://{self.ESP32_IP}:{self.ESP32_PORT}"

settings = Settings()