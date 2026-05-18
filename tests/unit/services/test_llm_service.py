"""Unit tests for LLMService."""
import pytest
from unittest.mock import MagicMock, patch
from app.services.llm_service import LLMService


class TestLLMService:
    """Test cases for LLMService."""

    @pytest.fixture
    def service(self):
        """Create a service instance."""
        with patch("app.services.llm_service.LiteLLMClient"):
            return LLMService()

    def test_chat_success(self, service):
        """Test successful chat completion."""
        with patch.object(service, "client") as mock_client:
            mock_client.chat.return_value = "Test response"
            result = service.chat("Test prompt")
            assert result == "Test response"

    def test_chat_with_system_prompt(self, service):
        """Test chat with system prompt."""
        with patch.object(service, "client") as mock_client:
            mock_client.chat.return_value = "Response"
            result = service.chat("User prompt", system_prompt="System prompt")
            assert result == "Response"

    def test_stream_chat(self, service):
        """Test streaming chat."""
        with patch.object(service, "client") as mock_client:
            mock_client.stream_chat.return_value = iter(["chunk1", "chunk2"])
            result = list(service.stream_chat("Test prompt"))
            assert len(result) == 2

    def test_get_available_providers(self, service):
        """Test getting available providers."""
        with patch.object(service, "client") as mock_client:
            mock_client.get_providers.return_value = ["openai", "anthropic"]
            result = service.get_available_providers()
            assert "openai" in result
            assert "anthropic" in result

    def test_switch_provider(self, service):
        """Test switching provider."""
        with patch.object(service, "client") as mock_client:
            service.switch_provider("anthropic")
            mock_client.set_provider.assert_called_once_with("anthropic")

    def test_switch_model(self, service):
        """Test switching model."""
        with patch.object(service, "client") as mock_client:
            service.switch_model("claude-opus-4-7")
            mock_client.set_model.assert_called_once_with("claude-opus-4-7")

    def test_get_token_usage(self, service):
        """Test getting token usage."""
        with patch.object(service, "client") as mock_client:
            mock_client.get_token_usage.return_value = {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
            }
            result = service.get_token_usage()
            assert result["total_tokens"] == 150
