"""
邮件发送服务（Brevo HTTP API）。
"""
import logging

import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)

BREVO_API = "https://api.brevo.com/v3/smtp/email"


async def send_verification_code(email: str, code: str) -> tuple[bool, str]:
    settings = get_settings()
    subject = "Bid Master - 邮箱验证码"
    text = f"""您好，

您的邮箱验证码为：

    {code}

验证码有效期为 5 分钟，请尽快完成注册。

如果这不是您的操作，请忽略此邮件。

—— Bid Master 团队"""

    return await _send_email(email, subject, text, settings)


async def send_reset_link(email: str, token: str) -> tuple[bool, str]:
    settings = get_settings()
    link = f"{settings.frontend_url}/reset-password?token={token}"
    subject = "Bid Master - 重置密码"
    text = f"""您好，

您请求了密码重置，请点击以下链接设置新密码：

    {link}

链接有效期为 30 分钟。如果这不是您的操作，请忽略此邮件。

—— Bid Master 团队"""

    return await _send_email(email, subject, text, settings)


async def _send_email(to: str, subject: str, text: str, settings) -> tuple[bool, str]:
    if not settings.brevo_api_key:
        logger.warning(f"Brevo API Key 未配置，邮件未发送。收件人: {to}, 主题: {subject}")
        logger.info(f"邮件内容:\n{text}")
        return True, ""

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                BREVO_API,
                headers={
                    "api-key": settings.brevo_api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "sender": {
                        "name": "Bid Master",
                        "email": settings.brevo_from,
                    },
                    "to": [{"email": to}],
                    "subject": subject,
                    "textContent": text,
                },
            )
            if resp.status_code in (200, 201):
                logger.info(f"邮件已发送: to={to}, subject={subject}")
                return True, ""
            else:
                error_msg = f"Brevo 返回错误: {resp.status_code} {resp.text}"
                logger.error(error_msg)
                return False, error_msg
    except Exception as e:
        error_msg = f"邮件发送异常: {e}"
        logger.error(error_msg)
        return False, error_msg
