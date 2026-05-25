"""
PostgreSQL-backed data storage.
Drop-in async replacement for mock_storage — same function signatures, persistent data.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.infrastructure.database import get_database


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())[:8]


def _to_dt(val) -> Optional[datetime]:
    """Convert ISO string or datetime to datetime object for asyncpg."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    return datetime.fromisoformat(val)


def _serialize_row(row: Optional[dict]) -> Optional[dict]:
    """Convert datetime fields in a row dict to ISO strings for JSON serialization."""
    if row is None:
        return None
    result = dict(row)
    for k, v in result.items():
        if isinstance(v, datetime):
            result[k] = v.isoformat()
    return result


def _serialize_rows(rows: list[dict]) -> list[dict]:
    return [_serialize_row(r) for r in rows]


# ──────────────────────────────────────────────
# Stats
# ──────────────────────────────────────────────

async def get_stats(user_id: str) -> dict:
    db = await get_database()
    counts = {}
    for table, alias in [("files", "files"), ("simulates", "simulate_tasks"),
                         ("openings", "opening_results"), ("extracts", "extract_results")]:
        row = await db.fetch_one(f"SELECT COUNT(*) as cnt FROM {table} WHERE user_id = $1", user_id)
        counts[alias] = row["cnt"] if row else 0
    return counts


# ──────────────────────────────────────────────
# Files
# ──────────────────────────────────────────────

async def add_file(record: dict, user_id: Optional[str] = None) -> dict:
    if "id" not in record:
        record["id"] = _new_id()
    if "created_at" not in record:
        record["created_at"] = _now()
    if user_id:
        record["user_id"] = user_id
    db = await get_database()
    await db.execute(
        """INSERT INTO files (id, original_name, path, size, type, user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING""",
        record["id"], record.get("original_name", ""), record.get("path", ""),
        record.get("size", 0), record.get("type"), record.get("user_id"),
        _to_dt(record.get("created_at", _now())),
    )
    return record


async def list_files(page: int = 1, page_size: int = 20, file_type: Optional[str] = None, user_id: Optional[str] = None) -> dict:
    db = await get_database()
    base = "WHERE user_id = $1"
    args = [user_id]
    if file_type:
        base += " AND type = $2"
        args.append(file_type)
    total_row = await db.fetch_one(f"SELECT COUNT(*) as cnt FROM files {base}", *args)
    total = total_row["cnt"] if total_row else 0
    offset = (page - 1) * page_size
    args_q = args + [page_size, offset]
    idx = len(args) + 1
    rows = await db.fetch_all(
        f"SELECT * FROM files {base} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx+1}", *args_q
    )
    return {"total": total, "page": page, "page_size": page_size, "files": _serialize_rows(rows)}


async def get_file(file_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    db = await get_database()
    row = await db.fetch_one("SELECT * FROM files WHERE id = $1", file_id)
    if row and user_id and row.get("user_id") != user_id:
        return None
    return _serialize_row(row)


async def delete_file(file_id: str, user_id: Optional[str] = None) -> bool:
    db = await get_database()
    if user_id:
        result = await db.execute("DELETE FROM files WHERE id = $1 AND user_id = $2", file_id, user_id)
    else:
        result = await db.execute("DELETE FROM files WHERE id = $1", file_id)
    return "DELETE 1" in result


async def update_file(file_id: str, updates: dict) -> bool:
    if not updates:
        return False
    db = await get_database()
    sets = []
    args = []
    for i, (k, v) in enumerate(updates.items(), 1):
        sets.append(f"{k} = ${i}")
        args.append(v if not isinstance(v, (dict, list)) else json.dumps(v))
    args.append(file_id)
    result = await db.execute(
        f"UPDATE files SET {', '.join(sets)} WHERE id = ${len(args)}", *args
    )
    return "UPDATE 1" in result


# ──────────────────────────────────────────────
# Simulates
# ──────────────────────────────────────────────

async def add_simulate(record: dict, user_id: Optional[str] = None) -> dict:
    if "task_id" not in record:
        record["task_id"] = _new_id()
    if "created_at" not in record:
        record["created_at"] = _now()
    if "name" not in record:
        ts = datetime.now().strftime("%m%d_%H%M")
        file_names = record.get("file_names") or []
        file_part = "_".join(n.rsplit(".", 1)[0] for n in file_names[:2]) if file_names else ""
        record["name"] = f"模拟编制_{file_part}_{ts}" if file_part else f"模拟编制_{ts}"
    if user_id:
        record["user_id"] = user_id
    db = await get_database()
    await db.execute(
        """INSERT INTO simulates (task_id, name, status, current_step, params, step_results, file_ids, files, file_names, user_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (task_id) DO NOTHING""",
        record["task_id"], record.get("name"), record.get("status", "pending"),
        record.get("current_step", 0), json.dumps(record.get("params", {})),
        json.dumps(record.get("step_results", {})), json.dumps(record.get("file_ids", [])),
        json.dumps(record.get("files", [])), json.dumps(record.get("file_names", [])),
        record.get("user_id"), _to_dt(record.get("created_at", _now())),
    )
    return record


async def list_simulates(page: int = 1, page_size: int = 20, status: Optional[str] = None, user_id: Optional[str] = None) -> dict:
    db = await get_database()
    base = "WHERE user_id = $1"
    args = [user_id]
    if status:
        base += " AND status = $2"
        args.append(status)
    total_row = await db.fetch_one(f"SELECT COUNT(*) as cnt FROM simulates {base}", *args)
    total = total_row["cnt"] if total_row else 0
    offset = (page - 1) * page_size
    args_q = args + [page_size, offset]
    idx = len(args) + 1
    rows = await db.fetch_all(
        f"SELECT * FROM simulates {base} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx+1}", *args_q
    )
    for r in rows:
        for k in ("params", "step_results", "file_ids", "files", "file_names"):
            if k in r and isinstance(r[k], str):
                r[k] = json.loads(r[k])
    return {"total": total, "page": page, "page_size": page_size, "tasks": _serialize_rows(rows)}


async def get_simulate(task_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    db = await get_database()
    row = await db.fetch_one("SELECT * FROM simulates WHERE task_id = $1", task_id)
    if not row:
        return None
    if user_id and row.get("user_id") != user_id:
        return None
    for k in ("params", "step_results", "file_ids", "files", "file_names"):
        if k in row and isinstance(row[k], str):
            row[k] = json.loads(row[k])
    return _serialize_row(row)


async def delete_simulate(task_id: str, user_id: Optional[str] = None) -> bool:
    db = await get_database()
    if user_id:
        result = await db.execute("DELETE FROM simulates WHERE task_id = $1 AND user_id = $2", task_id, user_id)
    else:
        result = await db.execute("DELETE FROM simulates WHERE task_id = $1", task_id)
    return "DELETE 1" in result


async def update_simulate(task_id: str, updates: dict) -> bool:
    if not updates:
        return False
    db = await get_database()
    sets = []
    args = []
    for i, (k, v) in enumerate(updates.items(), 1):
        sets.append(f"{k} = ${i}")
        args.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
    args.append(task_id)
    result = await db.execute(
        f"UPDATE simulates SET {', '.join(sets)} WHERE task_id = ${len(args)}", *args
    )
    return "UPDATE 1" in result


# ──────────────────────────────────────────────
# Openings
# ──────────────────────────────────────────────

async def add_opening(record: dict, user_id: Optional[str] = None) -> dict:
    if "id" not in record:
        record["id"] = _new_id()
    if "created_at" not in record:
        record["created_at"] = _now()
    if "name" not in record:
        ts = datetime.now().strftime("%m%d_%H%M")
        file_name = record.get("file_name", "")
        if file_name:
            file_part = file_name.rsplit(".", 1)[0]
            record["name"] = f"开标分析_{file_part}_{ts}"
        else:
            project_name = (record.get("meta") or {}).get("project_name", "")
            record["name"] = f"开标分析_{project_name}_{ts}" if project_name else f"开标分析_{ts}"
    if user_id:
        record["user_id"] = user_id
    db = await get_database()
    await db.execute(
        """INSERT INTO openings (id, name, file_id, file_name, meta, bidder_count, bid_ranking, bid_stats, user_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING""",
        record["id"], record.get("name"), record.get("file_id"), record.get("file_name"),
        json.dumps(record.get("meta", {})), record.get("bidder_count", 0),
        json.dumps(record.get("bid_ranking", [])), json.dumps(record.get("bid_stats", {})),
        record.get("user_id"), _to_dt(record.get("created_at", _now())),
    )
    return record


async def list_openings(page: int = 1, page_size: int = 20, user_id: Optional[str] = None) -> dict:
    db = await get_database()
    total_row = await db.fetch_one("SELECT COUNT(*) as cnt FROM openings WHERE user_id = $1", user_id)
    total = total_row["cnt"] if total_row else 0
    offset = (page - 1) * page_size
    rows = await db.fetch_all(
        "SELECT * FROM openings WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        user_id, page_size, offset,
    )
    for r in rows:
        for k in ("meta", "bid_ranking", "bid_stats"):
            if k in r and isinstance(r[k], str):
                r[k] = json.loads(r[k])
    return {"total": total, "page": page, "page_size": page_size, "results": _serialize_rows(rows)}


async def get_opening(task_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    db = await get_database()
    row = await db.fetch_one("SELECT * FROM openings WHERE id = $1", task_id)
    if not row:
        return None
    if user_id and row.get("user_id") != user_id:
        return None
    for k in ("meta", "bid_ranking", "bid_stats"):
        if k in row and isinstance(row[k], str):
            row[k] = json.loads(row[k])
    return _serialize_row(row)


async def delete_opening(task_id: str, user_id: Optional[str] = None) -> bool:
    db = await get_database()
    if user_id:
        result = await db.execute("DELETE FROM openings WHERE id = $1 AND user_id = $2", task_id, user_id)
    else:
        result = await db.execute("DELETE FROM openings WHERE id = $1", task_id)
    return "DELETE 1" in result


async def update_opening(opening_id: str, updates: dict) -> bool:
    if not updates:
        return False
    db = await get_database()
    sets = []
    args = []
    for i, (k, v) in enumerate(updates.items(), 1):
        sets.append(f"{k} = ${i}")
        args.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
    args.append(opening_id)
    result = await db.execute(
        f"UPDATE openings SET {', '.join(sets)} WHERE id = ${len(args)}", *args
    )
    return "UPDATE 1" in result


# ──────────────────────────────────────────────
# Extracts
# ──────────────────────────────────────────────

async def add_extract(record: dict, user_id: Optional[str] = None) -> dict:
    if "id" not in record:
        record["id"] = _new_id()
    if "created_at" not in record:
        record["created_at"] = _now()
    if "name" not in record:
        ts = datetime.now().strftime("%m%d_%H%M")
        file_name = record.get("file_name", "")
        if file_name:
            file_part = file_name.rsplit(".", 1)[0]
            record["name"] = f"要素提取_{file_part}_{ts}"
        else:
            template = record.get("template_type", "")
            record["name"] = f"要素提取_{template}_{ts}" if template else f"要素提取_{ts}"
    if user_id:
        record["user_id"] = user_id
    db = await get_database()
    await db.execute(
        """INSERT INTO extracts (id, name, file_id, file_name, template_type, mode, content, elements, user_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING""",
        record["id"], record.get("name"), record.get("file_id"), record.get("file_name"),
        record.get("template_type"), record.get("mode"), record.get("content"),
        json.dumps(record.get("elements", [])), record.get("user_id"), _to_dt(record.get("created_at", _now())),
    )
    return record


async def list_extracts(page: int = 1, page_size: int = 20, user_id: Optional[str] = None) -> dict:
    db = await get_database()
    total_row = await db.fetch_one("SELECT COUNT(*) as cnt FROM extracts WHERE user_id = $1", user_id)
    total = total_row["cnt"] if total_row else 0
    offset = (page - 1) * page_size
    rows = await db.fetch_all(
        "SELECT * FROM extracts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        user_id, page_size, offset,
    )
    for r in rows:
        if "elements" in r and isinstance(r["elements"], str):
            r["elements"] = json.loads(r["elements"])
    return {"total": total, "page": page, "page_size": page_size, "results": _serialize_rows(rows)}


async def get_extract(result_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    db = await get_database()
    row = await db.fetch_one("SELECT * FROM extracts WHERE id = $1", result_id)
    if not row:
        return None
    if user_id and row.get("user_id") != user_id:
        return None
    if "elements" in row and isinstance(row["elements"], str):
        row["elements"] = json.loads(row["elements"])
    return _serialize_row(row)


async def delete_extract(result_id: str, user_id: Optional[str] = None) -> bool:
    db = await get_database()
    if user_id:
        result = await db.execute("DELETE FROM extracts WHERE id = $1 AND user_id = $2", result_id, user_id)
    else:
        result = await db.execute("DELETE FROM extracts WHERE id = $1", result_id)
    return "DELETE 1" in result


# ──────────────────────────────────────────────
# Users
# ──────────────────────────────────────────────

async def add_user(record: dict) -> dict:
    if "id" not in record:
        record["id"] = _new_id()
    if "created_at" not in record:
        record["created_at"] = _now()
    db = await get_database()
    await db.execute(
        """INSERT INTO users (id, username, email, password_hash, salt, role, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING""",
        record["id"], record["username"], record["email"],
        record["password_hash"], record["salt"],
        record.get("role", "user"), record.get("is_active", True),
        _to_dt(record.get("created_at", _now())),
    )
    return record


async def get_user_by_username(username: str) -> Optional[dict]:
    db = await get_database()
    return _serialize_row(await db.fetch_one("SELECT * FROM users WHERE username = $1", username))


async def get_user_by_email(email: str) -> Optional[dict]:
    db = await get_database()
    return _serialize_row(await db.fetch_one("SELECT * FROM users WHERE email = $1", email))


async def get_user_by_id(user_id: str) -> Optional[dict]:
    db = await get_database()
    return _serialize_row(await db.fetch_one("SELECT * FROM users WHERE id = $1", user_id))


async def update_user_password(user_id: str, password_hash: str, salt_hex: str) -> bool:
    db = await get_database()
    result = await db.execute(
        "UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3",
        password_hash, salt_hex, user_id,
    )
    return "UPDATE 1" in result


# ──────────────────────────────────────────────
# API Keys
# ──────────────────────────────────────────────

async def save_api_key(user_id: str, provider: str, encrypted_key: str) -> dict:
    db = await get_database()
    now = _now()
    await db.execute(
        """INSERT INTO api_keys (user_id, provider, encrypted_key, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_key = $3, updated_at = $4""",
        user_id, provider, encrypted_key, _to_dt(now),
    )
    return {"user_id": user_id, "provider": provider, "encrypted_key": encrypted_key, "updated_at": now}


async def get_api_key(user_id: str, provider: str) -> Optional[str]:
    db = await get_database()
    row = await db.fetch_one(
        "SELECT encrypted_key FROM api_keys WHERE user_id = $1 AND provider = $2", user_id, provider
    )
    return row["encrypted_key"] if row else None


async def delete_api_key(user_id: str, provider: str) -> bool:
    db = await get_database()
    result = await db.execute("DELETE FROM api_keys WHERE user_id = $1 AND provider = $2", user_id, provider)
    return "DELETE 1" in result


async def list_user_api_keys(user_id: str) -> list[dict]:
    db = await get_database()
    rows = await db.fetch_all(
        "SELECT provider, updated_at FROM api_keys WHERE user_id = $1", user_id
    )
    return [{"provider": r["provider"], "updated_at": r["updated_at"].isoformat() if isinstance(r["updated_at"], datetime) else r["updated_at"]} for r in rows]


# ──────────────────────────────────────────────
# Verification Codes
# ──────────────────────────────────────────────

async def save_verification_code(email: str, code: str, expires_at: datetime) -> None:
    db = await get_database()
    await db.execute(
        """INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET code = $2, expires_at = $3""",
        email, code, expires_at,
    )


async def verify_code(email: str, code: str) -> bool:
    db = await get_database()
    row = await db.fetch_one("SELECT code, expires_at FROM verification_codes WHERE email = $1", email)
    if not row:
        return False
    if row["code"] != code:
        return False
    expires = row["expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        await db.execute("DELETE FROM verification_codes WHERE email = $1", email)
        return False
    return True


async def delete_verification_code(email: str) -> None:
    db = await get_database()
    await db.execute("DELETE FROM verification_codes WHERE email = $1", email)


# ──────────────────────────────────────────────
# Reset Tokens
# ──────────────────────────────────────────────

async def save_reset_token(token: str, user_id: str, expires_at: datetime) -> None:
    db = await get_database()
    await db.execute(
        """INSERT INTO reset_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (token) DO UPDATE SET user_id = $2, expires_at = $3""",
        token, user_id, expires_at,
    )


async def get_reset_token(token: str) -> Optional[dict]:
    db = await get_database()
    row = await db.fetch_one("SELECT user_id, expires_at FROM reset_tokens WHERE token = $1", token)
    if not row:
        return None
    expires = row["expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        await db.execute("DELETE FROM reset_tokens WHERE token = $1", token)
        return None
    return _serialize_row(row)


async def delete_reset_token(token: str) -> None:
    db = await get_database()
    await db.execute("DELETE FROM reset_tokens WHERE token = $1", token)

