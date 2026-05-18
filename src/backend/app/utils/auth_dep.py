"""
FastAPI dependency for extracting and validating current user from JWT token.
"""
from fastapi import Depends, HTTPException, Request
from app.utils.crypto import decode_token
from app.config import get_settings
from app.infrastructure.mock_storage import get_user_by_id


async def get_current_user(request: Request) -> dict:
    """Extract and validate user from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未认证")

    token = auth_header[7:]
    payload = decode_token(token, get_settings().jwt_secret)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="无效或过期的 token")

    user_id = payload.get("sub")
    user = get_user_by_id(user_id)
    if not user or not user.get("is_active"):
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")

    return {"id": user["id"], "username": user["username"], "email": user.get("email"), "role": user["role"]}