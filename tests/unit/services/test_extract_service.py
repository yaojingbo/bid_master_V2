"""Unit tests for ExtractService."""
import pytest
from unittest.mock import MagicMock, patch
from app.services.extract_service import ExtractService


class TestExtractService:
    """Test cases for ExtractService."""

    @pytest.fixture
    def service(self):
        """Create a service instance."""
        return ExtractService()

    def test_extract_elements_success(self, service):
        """Test successful element extraction."""
        with patch.object(service, "llm_service") as mock_llm:
            mock_llm.chat.return_value = '{"资质要求": "test", "评标办法": "test2"}'
            result = service.extract_elements("Test content", ["资质要求", "评标办法"])

            assert "资质要求" in result
            assert "评标办法" in result

    def test_extract_elements_empty_prompts(self, service):
        """Test extraction with empty prompts."""
        with pytest.raises(ValueError, match="No prompts provided"):
            service.extract_elements("Test content", [])

    def test_extract_elements_file_not_found(self, service):
        """Test extraction with non-existent file."""
        with pytest.raises(FileNotFoundError):
            service.extract_elements("/nonexistent/file.pdf", ["资质要求"])

    def test_stream_extract_elements(self, service):
        """Test streaming element extraction."""
        with patch.object(service, "llm_service") as mock_llm:
            mock_llm.stream_chat.return_value = iter([
                '{"资质要求": "test"',
                ', "评标办法": "test2"}',
            ])
            result = list(service.stream_extract_elements("Test content", ["资质要求", "评标办法"]))
            assert len(result) > 0

    def test_get_extraction_template(self, service):
        """Test getting extraction template."""
        template = service.get_extraction_template()

        assert "招标项目" in template
        assert "资质要求" in template
        assert "评标办法" in template

    def test_validate_extraction_result(self, service):
        """Test validating extraction result."""
        valid_result = {"资质要求": "test", "评标办法": "test2"}
        assert service.validate_extraction_result(valid_result) is True

        invalid_result = {"invalid": "test"}
        assert service.validate_extraction_result(invalid_result) is False
