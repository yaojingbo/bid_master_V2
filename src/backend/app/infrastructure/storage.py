from __future__ import annotations
"""
File storage with encryption support using Fernet.
"""
import os
import uuid
import aiofiles
from pathlib import Path
from cryptography.fernet import Fernet
from typing import BinaryIO, Optional

from app.config import get_settings


class StorageService:
    """File storage service with Fernet encryption."""

    def __init__(self, upload_dir: str = None, fernet_key: str = None):
        settings = get_settings()
        self.upload_dir = Path(upload_dir or settings.upload_dir)
        self.fernet_key = fernet_key or settings.fernet_key

        # Ensure upload directory exists
        self.upload_dir.mkdir(parents=True, exist_ok=True)

        # Initialize Fernet cipher
        if self.fernet_key:
            self.cipher = Fernet(self.fernet_key.encode())
        else:
            # Generate a key for development (NOT for production)
            self.cipher = Fernet(Fernet.generate_key())

    def _get_file_path(self, file_id: str) -> Path:
        """Get storage path for a file."""
        return self.upload_dir / f"{file_id}.enc"

    async def save(self, content: bytes, original_name: str) -> tuple[str, str]:
        """
        Save encrypted file and return (file_id, encrypted_path).

        Args:
            content: File content bytes
            original_name: Original filename

        Returns:
            Tuple of (file_id, encrypted_path)
        """
        file_id = str(uuid.uuid4())
        file_path = self._get_file_path(file_id)

        # Encrypt content
        encrypted_content = self.cipher.encrypt(content)

        # Write to disk
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(encrypted_content)

        return file_id, str(file_path)

    async def read(self, file_id: str) -> bytes:
        """
        Read and decrypt file content.

        Args:
            file_id: File identifier

        Returns:
            Decrypted file content
        """
        file_path = self._get_file_path(file_id)

        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_id}")

        # Read encrypted content
        async with aiofiles.open(file_path, 'rb') as f:
            encrypted_content = await f.read()

        # Decrypt
        return self.cipher.decrypt(encrypted_content)

    async def delete(self, file_id: str) -> bool:
        """
        Delete encrypted file.

        Args:
            file_id: File identifier

        Returns:
            True if deleted, False if not found
        """
        file_path = self._get_file_path(file_id)

        if file_path.exists():
            file_path.unlink()
            return True
        return False

    async def exists(self, file_id: str) -> bool:
        """Check if file exists."""
        return self._get_file_path(file_id).exists()


# Global storage instance
_storage: Optional[StorageService] = None


def get_storage() -> StorageService:
    """Get or create storage service instance."""
    global _storage
    if _storage is None:
        _storage = StorageService()
    return _storage