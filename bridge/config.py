from dotenv import load_dotenv
import os

load_dotenv()

class Settings:
    # ESP32_IP: str = os.getenv("ESP32_IP", "192.168.18.43")
    ESP32_IP: str = os.getenv("ESP32_IP", "192.168.100.162")
    ESP32_PORT: int = int(os.getenv("ESP32_PORT", "80"))
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    BRIDGE_HOST: str = os.getenv("BRIDGE_HOST", "0.0.0.0")
    BRIDGE_PORT: int = int(os.getenv("BRIDGE_PORT", "8000"))
    COOLDOWN_SECONDS: int = int(os.getenv("COOLDOWN_SECONDS", "30"))

    @property
    def esp32_base_url(self) -> str:
        return f"http://{self.ESP32_IP}:{self.ESP32_PORT}"

settings = Settings()