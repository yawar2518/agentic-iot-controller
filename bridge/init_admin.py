"""One-time script to bootstrap the admin user from .env credentials.

Usage:
    python init_admin.py
"""
import os

from dotenv import load_dotenv

load_dotenv()

from auth import create_users_table, create_user

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")


def main() -> None:
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        print("ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env")
        return

    create_users_table()

    try:
        create_user(ADMIN_USERNAME, ADMIN_PASSWORD, role="admin")
        print("Admin created successfully")
    except ValueError:
        print("Admin already exists")


if __name__ == "__main__":
    main()
