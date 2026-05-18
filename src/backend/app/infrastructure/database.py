from __future__ import annotations
"""
Database connection manager using asyncpg.
For production deployment, configure DATABASE_URL to a PostgreSQL instance.
Currently using mock_storage as the default data layer.
"""
from typing import Optional
import asyncpg

from app.config import get_settings


class Database:
    """asyncpg-based PostgreSQL connection manager.

    Usage:
        db = Database(url)
        await db.connect()
        rows = await db.fetch_all("SELECT * FROM tender_documents")
        await db.disconnect()
    """

    def __init__(self, database_url: str | None = None):
        settings = get_settings()
        self.database_url = database_url or settings.database_url
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self._pool:
            return
        self._pool = await asyncpg.create_pool(
            self.database_url,
            min_size=2,
            max_size=10,
        )

    async def disconnect(self) -> None:
        if self._pool:
            await self._pool.close()
            self._pool = None

    @property
    def pool(self) -> asyncpg.Pool:
        if not self._pool:
            raise RuntimeError("Database not connected. Call await db.connect() first.")
        return self._pool

    async def fetch_one(self, query: str, *args) -> dict | None:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(query, *args)
            return dict(row) if row else None

    async def fetch_all(self, query: str, *args) -> list[dict]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(query, *args)
            return [dict(r) for r in rows]

    async def execute(self, query: str, *args) -> str:
        async with self.pool.acquire() as conn:
            result = await conn.execute(query, *args)
            return result


# Global instance (lazy, only created when needed)
_db: Database | None = None


async def get_database() -> Database:
    global _db
    if _db is None:
        _db = Database()
        await _db.connect()
    return _db


async def close_database() -> None:
    global _db
    if _db:
        await _db.disconnect()
        _db = None
