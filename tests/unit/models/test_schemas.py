"""Unit tests for Pydantic schemas."""
import pytest
from pydantic import ValidationError
from app.models.schemas import (
    FileUploadResponse,
    ElementExtractionRequest,
    StatisticsRequest,
    AIProviderConfig,
)


class TestFileUploadResponse:
    """Test cases for FileUploadResponse schema."""

    def test_valid_response(self):
        """Test valid response."""
        response = FileUploadResponse(
            file_id="123",
            filename="test.pdf",
            size=1024,
            status="uploaded",
        )
        assert response.file_id == "123"
        assert response.filename == "test.pdf"

    def test_missing_required_field(self):
        """Test missing required field."""
        with pytest.raises(ValidationError):
            FileUploadResponse(filename="test.pdf")


class TestElementExtractionRequest:
    """Test cases for ElementExtractionRequest schema."""

    def test_valid_request(self):
        """Test valid request."""
        request = ElementExtractionRequest(
            file_id="123",
            prompts=["资质要求", "评标办法"],
        )
        assert len(request.prompts) == 2

    def test_empty_prompts(self):
        """Test empty prompts list."""
        with pytest.raises(ValidationError):
            ElementExtractionRequest(file_id="123", prompts=[])

    def test_prompts_too_long(self):
        """Test prompts list too long."""
        with pytest.raises(ValidationError):
            ElementExtractionRequest(
                file_id="123",
                prompts=["test"] * 21,  # Max is 20
            )


class TestStatisticsRequest:
    """Test cases for StatisticsRequest schema."""

    def test_valid_with_prices(self):
        """Test valid request with prices."""
        request = StatisticsRequest(prices=[100, 200, 300])
        assert len(request.prices) == 3

    def test_valid_with_file_id(self):
        """Test valid request with file_id."""
        request = StatisticsRequest(fileId="123")
        assert request.fileId == "123"

    def test_empty_request(self):
        """Test empty request."""
        with pytest.raises(ValidationError):
            StatisticsRequest()

    def test_invalid_prices(self):
        """Test invalid prices."""
        with pytest.raises(ValidationError):
            StatisticsRequest(prices=[-100])  # Negative price


class TestAIProviderConfig:
    """Test cases for AIProviderConfig schema."""

    def test_valid_config(self):
        """Test valid config."""
        config = AIProviderConfig(
            provider="openai",
            model="gpt-4o",
            api_key="sk-test",
        )
        assert config.provider == "openai"

    def test_missing_api_key(self):
        """Test missing api_key for custom provider."""
        with pytest.raises(ValidationError):
            AIProviderConfig(provider="openai", model="gpt-4o")
