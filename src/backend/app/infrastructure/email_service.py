"""
SMTP 邮件发送服务。
"""
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import aiosmtplib
from app.config import get_settings

logger = logging.getLogger(__name__)


async def send_verification_code(email: str, code: str) -> bool:
    settings = get_settings()
    subject = "Bid Master - 邮箱验证码"
    body = f"""您好，

您的邮箱验证码为：

    {code}

验证码有效期为 5 分钟，请尽快完成注册。

如果这不是您的操作，请忽略此邮件。

—— Bid Master 团队"""

    return await _send_email(email, subject, body, settings)


async def send_reset_link(email: str, token: str) -> bool:
    settings = get_settings()
    link = f"{settings.frontend_url}/reset-password?token={token}"
    subject = "Bid Master - 重置密码"
    body = f"""您好，

您请求了密码重置，请点击以下链接设置新密码：

    {link}

链接有效期为 30 分钟。如果这不是您的操作，请忽略此邮件。

—— Bid Master 团队"""

    return await _send_email(email, subject, body, settings)


async def _send_email(to: str, subject: str, body: str, settings) -> bool:
    if not settings.smtp_host:
        logger.warning(f"SMTP 未配置，邮件未发送。收件人: {to}, 主题: {subject}")
        logger.info(f"邮件内容:\n{body}")
        return True

    msg = MIMEMultipart()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            use_tls=settings.smtp_port == 465,
            start_tls=settings.smtp_port == 587,
        )
        return True
    except Exception as e:
        logger.error(f"邮件发送失败: {e}")
        return False
