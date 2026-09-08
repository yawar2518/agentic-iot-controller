import os
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

DB_PATH = os.path.join(os.path.dirname(__file__), "iot_logs.db")

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


def create_users_table() -> None:
    """Create the users table if it does not exist."""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                role          TEXT    NOT NULL DEFAULT 'user'
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def create_user(username: str, password: str, role: str = "user") -> dict:
    """Create a new user with a bcrypt-hashed password. Raises ValueError if username exists."""
    password_hash = pwd_context.hash(password)
    conn = sqlite3.connect(DB_PATH)
    try:
        try:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                (username, password_hash, role),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            raise ValueError(f"Username '{username}' already exists.")
        return {"id": cursor.lastrowid, "username": username, "role": role}
    finally:
        conn.close()


def verify_user(username: str, password: str) -> dict | None:
    """Verify credentials. Returns the user dict (without password_hash) or None."""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return None
    if not pwd_context.verify(password, row["password_hash"]):
        return None

    return {"id": row["id"], "username": row["username"], "role": row["role"]}


def create_access_token(data: dict) -> str:
    """Create a signed JWT with a 24h expiry."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTP 401 on any failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """FastAPI dependency: validates the Bearer token and returns its payload."""
    payload = verify_token(credentials.credentials)
    username = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def get_admin_user(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """FastAPI dependency: requires the token's role to be 'admin'."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return current_user
