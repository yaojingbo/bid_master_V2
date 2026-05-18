"""
Authentication API routes: register, login, refresh, logout, me.
"""
from fastapi import APIRouter, HTTPException, Response, Request
from app.models.schemas import RegisterRequest, LoginRequest, RefreshRequest
from app.infrastructure.mock_storage import add_user, get_user_by_username, get_user_by_email, get_user_by_id
from app.utils.crypto import (
    generate_salt, hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
)
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
async def register(request: RegisterRequest, response: Response):
    """注册新用户（邮箱为登录标识）。"""
    # 检查邮箱是否已被注册
    existing = get_user_by_email(request.email)
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已被注册")

    # 自动生成用户名（如果未提供）
    username = request.username
    if not username:
        base = request.email.split("@")[0].replace(".", "_")
        username = base
        suffix = 1
        while get_user_by_username(username):
            username = f"{base}{suffix}"
            suffix += 1

    # 检查用户名是否已被占用
    if get_user_by_username(username):
        raise HTTPException(status_code=400, detail="用户名已被使用")

    salt = generate_salt()
    password_hash = hash_password(request.password, salt)

    user = add_user({
        "username": username,
        "email": request.email,
        "password_hash": password_hash,
        "salt": salt.hex(),
        "role": "user",
        "is_active": True,
    })

    settings = get_settings()
    access_token = create_access_token(
        {"sub": user["id"], "username": user["username"], "email": user["email"], "role": user["role"]},
        settings.jwt_secret,
        settings.jwt_access_token_expire_minutes,
    )
    refresh_token = create_refresh_token(
        {"sub": user["id"]},
        settings.jwt_secret,
        settings.jwt_refresh_token_expire_days,
    )

    # refresh_token 设为 httpOnly cookie（与登录一致）
    response.set_cookie(
        "refresh_token",
        refresh_token,
        max_age=settings.jwt_refresh_token_expire_days * 86400,
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {"id": user["id"], "username": user["username"], "email": user.get("email"), "role": user["role"]},
    }


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    """邮箱登录。"""
    user = get_user_by_email(request.email)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    salt_bytes = bytes.fromhex(user["salt"])
    if not verify_password(request.password, salt_bytes, user["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    settings = get_settings()
    access_token = create_access_token(
        {"sub": user["id"], "username": user["username"], "email": user.get("email"), "role": user["role"]},
        settings.jwt_secret,
        settings.jwt_access_token_expire_minutes,
    )
    refresh_token = create_refresh_token(
        {"sub": user["id"]},
        settings.jwt_secret,
        settings.jwt_refresh_token_expire_days,
    )

    # refresh_token 设为 httpOnly cookie
    response.set_cookie(
        "refresh_token",
        refresh_token,
        max_age=settings.jwt_refresh_token_expire_days * 86400,
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {"id": user["id"], "username": user["username"], "email": user.get("email"), "role": user["role"]},
    }


@router.post("/refresh")
async def refresh(request: Request):
    """用 httpOnly cookie 中的 refresh_token 获取新的 access_token。"""
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="缺少 refresh token")

    payload = decode_token(refresh_token, get_settings().jwt_secret)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="无效的 refresh token")

    user_id = payload.get("sub")
    user = get_user_by_id(user_id)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")

    settings = get_settings()
    access_token = create_access_token(
        {"sub": user["id"], "username": user["username"], "email": user.get("email"), "role": user["role"]},
        settings.jwt_secret,
        settings.jwt_access_token_expire_minutes,
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/logout")
async def logout(response: Response):
    """退出登录，清除 refresh_token cookie。"""
    response.delete_cookie("refresh_token", secure=True)
    return {"success": True, "message": "已退出登录"}


@router.get("/me")
async def me(request: Request):
    """获取当前用户信息。"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未认证")

    token = auth_header[7:]
    payload = decode_token(token, get_settings().jwt_secret)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="无效或过期的 token")

    user_id = payload.get("sub")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    return {
        "id": user["id"],
        "username": user["username"],
        "email": user.get("email"),
        "role": user["role"],
    }