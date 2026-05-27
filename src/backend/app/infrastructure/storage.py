from __future__ import annotations
"""
File storage with encryption support using Fernet.
文件内容加密后存入 PostgreSQL（BYTEA 列），确保 Railway 部署后数据持久化。
"""
import uuid
from cryptography.fernet import Fernet
from typing import Optional

from app.config import get_settings
from app.infrastructure.pg_storage import get_file_content


class StorageService:
    """File storage service with Fernet encryption, backed by PostgreSQL."""

    def __init__(self, fernet_key: str = None):
        settings = get_settings()
        self.fernet_key = fernet_key or settings.fernet_key

        # Initialize Fernet cipher
        if self.fernet_key:
            self.cipher = Fernet(self.fernet_key.encode())
        else:
            # Generate a key for development (NOT for production)
            self.cipher = Fernet(Fernet.generate_key())

    async def save(self, content: bytes, original_name: str) -> tuple[str, str]:
        """
        Encrypt content and return (file_id, placeholder_path).

        实际存储由调用方通过 pg_storage.add_file(..., encrypted_content=...) 写入数据库。
        这里只负责生成 ID 和加密内容。

        Args:
            content: File content bytes
            original_name: Original filename

        Returns:
            Tuple of (file_id, placeholder_path)
        """
        file_id = str(uuid.uuid4())
        encrypted_content = self.cipher.encrypt(content)
        # placeholder_path 仅保留兼容性，实际内容在 encrypted_content 列
        return file_id, f"pg://{file_id}", encrypted_content

    async def read(self, file_id: str) -> bytes:
        """
        Read and decrypt file content from PostgreSQL.

        Args:
            file_id: File identifier

        Returns:
            Decrypted file content
        """
        encrypted_content = await get_file_content(file_id)
        if encrypted_content is None:
            raise FileNotFoundError(f"File not found: {file_id}")

        # Decrypt
        return self.cipher.decrypt(encrypted_content)

    async def delete(self, file_id: str) -> bool:
        """
        Delete is handled by pg_storage.delete_file which removes the entire row.

        Args:
            file_id: File identifier

        Returns:
            True (row deletion is handled elsewhere)
        """
        return True

    async def exists(self, file_id: str) -> bool:
        """Check if file exists in database."""
        content = await get_file_content(file_id)
        return content is not None


# Global storage instance
_storage: Optional[StorageService] = None


def get_storage() -> StorageService:
    """Get or create storage service instance."""
    global _storage
    if _storage is None:
        _storage = StorageService()
    return _storage
