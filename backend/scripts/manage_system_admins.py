import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.core.system_admin_registry import SystemAdmin, SystemAdminRegistry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage pre-created system admins")
    parser.add_argument("action", choices=["list", "add"], help="Action to perform")
    parser.add_argument("--username")
    parser.add_argument("--display-name")
    parser.add_argument("--email")
    parser.add_argument("--inactive", action="store_true", help="Add as inactive")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    registry = SystemAdminRegistry(Path("app/core/system_admins.json"))

    admins = registry.load()

    if args.action == "list":
        for admin in admins:
            print(
                f"username={admin.username}, display_name={admin.display_name}, "
                f"email={admin.email}, is_active={admin.is_active}"
            )
        return

    if not args.username or not args.display_name or not args.email:
        raise SystemExit("--username, --display-name, --email are required for add")

    admins.append(
        SystemAdmin(
            username=args.username,
            display_name=args.display_name,
            email=args.email,
            is_active=not args.inactive,
        )
    )
    registry.save(admins)
    print(f"added: {args.username}")


if __name__ == "__main__":
    main()
