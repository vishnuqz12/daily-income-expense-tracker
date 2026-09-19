from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True, nullable=False)
    password_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    banks: Mapped[list["Bank"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    periods: Mapped[list["FinancialPeriod"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    transfers: Mapped[list["Transfer"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class Bank(Base):
    __tablename__ = "banks"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_bank_user_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="banks")


class FinancialPeriod(Base):
    __tablename__ = "financial_periods"
    __table_args__ = (UniqueConstraint("user_id", "start_date", name="uq_period_user_start"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="periods")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_user_date", "user_id", "date"),
        Index("ix_transactions_user_bank_date", "user_id", "bank_id", "date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    bank_id: Mapped[str] = mapped_column(ForeignKey("banks.id", ondelete="CASCADE"), index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="transactions")
    bank: Mapped[Bank] = relationship()


class Transfer(Base):
    __tablename__ = "transfers"
    __table_args__ = (
        Index("ix_transfers_user_date", "user_id", "date"),
        Index("ix_transfers_user_from", "user_id", "from_bank_id"),
        Index("ix_transfers_user_to", "user_id", "to_bank_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    from_bank_id: Mapped[str] = mapped_column(ForeignKey("banks.id", ondelete="CASCADE"), nullable=False)
    to_bank_id: Mapped[str] = mapped_column(ForeignKey("banks.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship(back_populates="transfers")
