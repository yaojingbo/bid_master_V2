"""Unit tests for EncryptionService."""
import pytest
from app.services.encryption_service import EncryptionService


class TestEncryptionService:
    """Test cases for EncryptionService."""

    @pytest.fixture
    def service(self):
        """Create a service instance with test key."""
        return EncryptionService(fernet_key=None)

    def test_encrypt_decrypt_text(self, service):
        """Test encrypting and decrypting text."""
        original = "Hello, Bid Master!"
        encrypted = service.encrypt_text(original)
        decrypted = service.decrypt_text(encrypted)
        assert decrypted == original

    def test_encrypt_returns_different_output(self, service):
        """Test that encryption produces different output."""
        original = "Test message"
        encrypted = service.encrypt_text(original)
        assert encrypted != original
        assert encrypted.endswith("==")

    def test_encrypt_file(self, service, tmp_path):
        """Test encrypting a file."""
        test_file = tmp_path / "test.txt"
        test_content = b"Secret content"
        test_file.write_bytes(test_content)

        encrypted_file = service.encrypt_file(str(test_file))
        assert encrypted_file.exists()
        assert encrypted_file.read_bytes() != test_content

    def test_decrypt_file(self, service, tmp_path):
        """Test decrypting a file."""
        test_file = tmp_path / "test.txt"
        test_content = b"Secret content"
        test_file.write_bytes(test_content)

        encrypted_file = service.encrypt_file(str(test_file))
        decrypted_file = service.decrypt_file(str(encrypted_file))

        assert decrypted_file.read_bytes() == test_content

    def test_encrypt_large_content(self, service):
        """Test encrypting large content."""
        large_content = "x" * 10 * 1024 * 1024  # 10MB
        encrypted = service.encrypt_text(large_content)
        decrypted = service.decrypt_text(encrypted)
        assert decrypted == large_content

    def test_empty_string(self, service):
        """Test encrypting empty string."""
        original = ""
        encrypted = service.encrypt_text(original)
        decrypted = service.decrypt_text(encrypted)
        assert decrypted == original
