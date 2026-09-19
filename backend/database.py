from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not configured. Create a PostgreSQL database and set "
            "DATABASE_URL in your Render backend environment variables."
        )
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


DB_SSLMODE = os.getenv("DB_SSLMODE", "require" if os.getenv("RENDER") == "true" else "prefer")
DATABASE_URL = _database_url()

engine_kwargs = {
    "pool_pre_ping": True,
    "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "300")),
}
if DATABASE_URL.startswith("postgresql+psycopg://"):
    engine_kwargs.update({
        "pool_size": int(os.getenv("DB_POOL_SIZE", "5")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "5")),
        "connect_args": {"sslmode": DB_SSLMODE},
    })

engine = create_engine(DATABASE_URL, **engine_kwargs)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_all() -> None:
    # Imported lazily so Base.metadata is populated before create_all().
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def check_connection() -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


@contextmanager
def db_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
