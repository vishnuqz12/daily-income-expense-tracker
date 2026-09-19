"""Import a ZIP-of-CSV backup into the PostgreSQL-backed tracker.

Run from the backend directory:
    set DATABASE_URL=postgresql://...
    python scripts/import_backup.py path/to/daily-money-tracker-backup.zip --email you@example.com

The destination user must already exist. Passwords and sessions in the backup
are intentionally ignored; only that user's banks, financial months,
transactions and transfers are restored.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backup_utils import import_backup_zip  # noqa: E402
from database import SessionLocal, create_all  # noqa: E402
from models import User  # noqa: E402
from sqlalchemy import select  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore a Daily Money Tracker ZIP backup into PostgreSQL")
    parser.add_argument("backup", type=Path)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    if not args.backup.exists():
        print(f"Backup file not found: {args.backup}")
        return 2

    create_all()
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
        if not user:
            print("Destination user not found. Create the account in the PostgreSQL-backed app first.")
            return 2
        counts = import_backup_zip(db, user.id, args.backup.read_bytes())
        print("Import complete")
        print(f"Banks added: {counts['banks_added']}")
        print(f"Financial months added: {counts['periods_added']}")
        print(f"Transactions added: {counts['transactions_added']} (skipped: {counts['transactions_skipped']})")
        print(f"Transfers added: {counts['transfers_added']} (skipped: {counts['transfers_skipped']})")
        return 0
    except ValueError as exc:
        db.rollback()
        print(f"Import failed: {exc}")
        return 3
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
