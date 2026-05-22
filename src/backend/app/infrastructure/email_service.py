"""
邮件发送服务（Resend HTTP API）。
"""
import logging

import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"


async def send_verification_code(email: str, code: str) -> bool:
    settings = get_settings()
    subject = "Bid Master - 邮箱验证码"
    text = f"""您好，

您的邮箱验证码为：

    {code}

验证码有效期为 5 分钟，请尽快完成注册。

如果这不是您的操作，请忽略此邮件。

—— Bid Master 团队"""

    return await _send_email(email, subject, text, settings)


async def send_reset_link(email: str, token: str) -> bool:
    settings = get_settings()
    link = f"{settings.frontend_url}/reset-password?token={token}"
    subject = "Bid Master - 重置密码"
    text = f"""您好，

您请求了密码重置，请点击以下链接设置新密码：

    {link}

链接有效期为 30 分钟。如果这不是您的操作，请忽略此邮件。

—— Bid Master 团队"""

    return await _send_email(email, subject, text, settings)


async def _send_email(to: str, subject: str, text: str, settings) -> bool:
    if not settings.resend_api_key:
        logger.warning(f"Resend API Key 未配置，邮件未发送。收件人: {to}, 主题: {subject}")
        logger.info(f"邮件内容:\n{text}")
        return True

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                RESEND_API,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.resend_from,
                    "to": [to],
                    "subject": subject,
                    "text": text,
                },
            )
            if resp.status_code == 200:
                logger.info(f"邮件已发送: to={to}, subject={subject}")
                return True
            else:
                logger.error(f"Resend 返回错误: {resp.status_code} {resp.text}")
                return False
    except Exception as e:
        logger.error(f"邮件发送失败: {e}")
        return False
