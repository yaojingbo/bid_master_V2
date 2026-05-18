"""Unit tests for FileService."""
import pytest
from unittest.mock import MagicMock, patch
from app.services.file_service import FileService


class TestFileService:
    """Test cases for FileService."""

    @pytest.fixture
    def service(self):
        """Create a service instance."""
        return FileService()

    def test_upload_file_success(self, service, tmp_path):
        """Test successful file upload."""
        test_file = tmp_path / "test.pdf"
        test_file.write_bytes(b"PDF content")

        with patch.object(service, "storage_service") as mock_storage:
            mock_storage.store_file.return_value = "stored_file_id"
            result = service.upload_file(str(test_file), "test.pdf")

            assert result["file_id"] == "stored_file_id"
            assert result["filename"] == "test.pdf"

    def test_upload_file_size_limit(self, service, tmp_path):
        """Test file size limit exceeded."""
        # Create a file larger than 50MB
        large_file = tmp_path / "large.pdf"
        large_content = b"x" * (51 * 1024 * 1024)  # 51MB
        large_file.write_bytes(large_content)

        with pytest.raises(ValueError, match="File size exceeds"):
            service.upload_file(str(large_file), "large.pdf")

    def test_upload_unsupported_format(self, service, tmp_path):
        """Test unsupported file format."""
        test_file = tmp_path / "test.exe"
        test_file.write_bytes(b"Executable content")

        with pytest.raises(ValueError, match="Unsupported file format"):
            service.upload_file(str(test_file), "test.exe")

    def test_get_file(self, service):
        """Test getting file info."""
        with patch.object(service, "storage_service") as mock_storage:
            mock_storage.get_file.return_value = {
                "file_id": "123",
                "filename": "test.pdf",
                "size": 1024,
            }
            result = service.get_file("123")
            assert result["file_id"] == "123"

    def test_delete_file(self, service):
        """Test deleting file."""
        with patch.object(service, "storage_service") as mock_storage:
            mock_storage.delete_file.return_value = True
            result = service.delete_file("123")
            assert result is True

    def test_download_file(self, service, tmp_path):
        """Test downloading file."""
        with patch.object(service, "storage_service") as mock_storage:
            encrypted_file = tmp_path / "encrypted"
            encrypted_file.write_bytes(b"encrypted content")
            mock_storage.get_file_path.return_value = str(encrypted_file)

            with patch.object(service, "encryption_service") as mock_enc:
                mock_enc.decrypt_file.return_value = tmp_path / "decrypted"
                mock_enc.decrypt_file.return_value.write_bytes(b"content")

                result = service.download_file("123")
                assert result is not None
