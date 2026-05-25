"""
FastAPI application entry point for Bid Master Backend.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from app.config import get_settings
from app.api import files, extract, settings, statistics, database as data, health, simulate, auth, api_keys, logs
from app.utils.exceptions import AppError
from app.limiter import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    from app.infrastructure.database import get_database, close_database
    from app.infrastructure.db_schema import init_schema

    settings = get_settings()
    print(f"Starting Bid Master API on port 8000")
    print(f"Database: {settings.database_url[:50]}...")

    db = await get_database()
    await init_schema(db)
    print("Database schema initialized")

    yield

    await close_database()
    print("Shutting down Bid Master API")


app = FastAPI(
    title="Bid Master API",
    description="招投标智能分析工具箱 - AI驱动的招标文件智能提取、模拟编制、开标报价分析",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Rate limiter ──────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────
# 注意：allow_origins=["*"] + allow_credentials=True 违反 CORS 规范，
# 浏览器会拒绝（Access-Control-Allow-Origin 不能是 * 当 credentials 为 true）。
# 生产环境通过 Vercel rewrite 代理请求（同源），CORS 不生效；
# 此配置仅为前端直连后端（本地开发/调试）时使用。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "https://bid-master-web.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global error handlers ─────────────────────────────────────


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.message,
            "code": exc.code,
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    import traceback
    print(f"UNHANDLED ERROR: {request.method} {request.url.path}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": f"Internal server error: {exc}",
            "code": "INTERNAL_ERROR",
        },
    )


# ── Routers ───────────────────────────────────────────────────
app.include_router(health.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(extract.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(statistics.router, prefix="/api")
app.include_router(data.router, prefix="/api")
app.include_router(simulate.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(api_keys.router, prefix="/api")
app.include_router(logs.router, prefix="/api")


# ── Request logging middleware ────────────────────────────────
import time
from app.infrastructure.log_collector import add_log


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/logs"):
        level = "error" if response.status_code >= 400 else "info"
        add_log(
            level=level,
            category="request",
            message=f"{request.method} {path} {response.status_code} {duration:.2f}s",
            user_id=None,
        )
    return response


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
