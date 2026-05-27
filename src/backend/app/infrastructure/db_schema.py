"""
PostgreSQL schema initialization.
Executes CREATE TABLE IF NOT EXISTS on startup.
包含迁移逻辑：检测旧 schema 并自动重建。
"""

SCHEMA_SQL = """
-- 迁移 1：如果 users.id 是 VARCHAR(8)，说明是极旧版本，全部重建
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'id'
        AND character_maximum_length = 8
    ) THEN
        DROP TABLE IF EXISTS reset_tokens CASCADE;
        DROP TABLE IF EXISTS verification_codes CASCADE;
        DROP TABLE IF EXISTS api_keys CASCADE;
        DROP TABLE IF EXISTS extracts CASCADE;
        DROP TABLE IF EXISTS openings CASCADE;
        DROP TABLE IF EXISTS simulates CASCADE;
        DROP TABLE IF EXISTS files CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
    END IF;
END $$;

-- 迁移 2：如果 files 表使用旧 schema（file_type 列或缺少 user_id），重建 files 及依赖表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'files' AND column_name = 'file_type'
    ) THEN
        DROP TABLE IF EXISTS extracts CASCADE;
        DROP TABLE IF EXISTS openings CASCADE;
        DROP TABLE IF EXISTS simulates CASCADE;
        DROP TABLE IF EXISTS files CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt VARCHAR(64) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(64) PRIMARY KEY,
    original_name TEXT NOT NULL,
    path TEXT NOT NULL,
    size BIGINT DEFAULT 0,
    type VARCHAR(50),
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulates (
    task_id VARCHAR(64) PRIMARY KEY,
    name TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    current_step INT DEFAULT 0,
    params JSONB DEFAULT '{}',
    step_results JSONB DEFAULT '{}',
    file_ids JSONB DEFAULT '[]',
    files JSONB DEFAULT '[]',
    file_names JSONB DEFAULT '[]',
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS openings (
    id VARCHAR(64) PRIMARY KEY,
    name TEXT,
    file_id VARCHAR(64),
    file_name TEXT,
    meta JSONB DEFAULT '{}',
    bidder_count INT DEFAULT 0,
    bid_ranking JSONB DEFAULT '[]',
    bid_stats JSONB DEFAULT '{}',
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS extracts (
    id VARCHAR(64) PRIMARY KEY,
    name TEXT,
    file_id VARCHAR(64),
    file_name TEXT,
    template_type VARCHAR(50),
    mode VARCHAR(20),
    content TEXT,
    elements JSONB DEFAULT '[]',
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    encrypted_key TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS verification_codes (
    email VARCHAR(255) PRIMARY KEY,
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokens (
    token VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
"""


async def init_schema(db) -> None:
    """Execute schema creation on the given Database instance."""
    async with db.pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
