from __future__ import annotations
"""
Database connection manager using asyncpg.
"""
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
import ssl
import asyncpg

from app.config import get_settings


def _clean_dsn(dsn: str) -> tuple[str, bool]:
    """Remove asyncpg-incompatible params from DSN. Returns (cleaned_dsn, needs_ssl)."""
    parsed = urlparse(dsn)
    params = parse_qs(parsed.query, keep_blank_values=True)

    needs_ssl = False
    if "sslmode" in params:
        mode = params["sslmode"][0]
        if mode in ("require", "verify-ca", "verify-full"):
            needs_ssl = True
        del params["sslmode"]

    params.pop("channel_binding", None)

    flat = {k: v[0] for k, v in params.items()}
    new_query = urlencode(flat)
    cleaned = urlunparse(parsed._replace(query=new_query))
    return cleaned, needs_ssl


class Database:
    """asyncpg-based PostgreSQL connection manager."""

    def __init__(self, database_url: str | None = None):
        settings = get_settings()
        raw_url = database_url or settings.database_url
        self.database_url, self._needs_ssl = _clean_dsn(raw_url)
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self._pool:
            return
        kwargs: dict = {"min_size": 2, "max_size": 10}
        if self._needs_ssl:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            kwargs["ssl"] = ctx
        if "-pooler" in self.database_url:
            kwargs["statement_cache_size"] = 0
        self._pool = await asyncpg.create_pool(self.database_url, **kwargs)
        print("Database pool connected")

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
