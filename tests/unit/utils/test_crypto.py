"""Unit tests for crypto utilities."""
import pytest
from app.utils.crypto import generate_key, encrypt_data, decrypt_data


class TestCrypto:
    """Test cases for crypto utilities."""

    def test_generate_key(self):
        """Test key generation."""
        key = generate_key()
        assert key is not None
        assert len(key) > 0

    def test_encrypt_decrypt_data(self):
        """Test encryption and decryption."""
        original = b"Secret data"
        encrypted = encrypt_data(original)
        decrypted = decrypt_data(encrypted)

        assert decrypted == original
        assert encrypted != original

    def test_encrypt_returns_bytes(self):
        """Test that encryption returns bytes."""
        encrypted = encrypt_data(b"test")
        assert isinstance(encrypted, bytes)

    def test_different_data_produces_different_encrypted(self):
        """Test that different data produces different encrypted output."""
        data1 = b"test1"
        data2 = b"test2"
        encrypted1 = encrypt_data(data1)
        encrypted2 = encrypt_data(data2)
        assert encrypted1 != encrypted2

    def test_empty_data(self):
        """Test encrypting empty data."""
        encrypted = encrypt_data(b"")
        decrypted = decrypt_data(encrypted)
        assert decrypted == b""
