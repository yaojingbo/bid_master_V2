from __future__ import annotations
"""
LiteLLM integration for multi-provider LLM support.
"""
import os
import time
from typing import AsyncGenerator, Any

from app.config import get_settings


class LiteLLMService:
    """LLM service using LiteLLM for unified multi-provider access."""

    # Model mappings - must use litellm provider prefix format
    MODEL_MAP = {
        "openai": "openai/gpt-4o",
        "deepseek": "deepseek/deepseek-v4-pro",
        "claude": "anthropic/claude-sonnet-4-20250514",
        "dashscope": "openai/qwen-turbo",
        "zhipu": "openai/glm-4-flash",
        "minimax": "openai/MiniMax-M2.7",
        "ollama": "ollama/llama3",
    }

    def __init__(self):
        self.settings = get_settings()

    def _get_api_key(self, provider: str, user_id: str = None) -> str:
        """Get API key for provider. Checks user-stored key first, then falls back to env vars."""
        # 1. Check user-stored key (encrypted in mock_storage)
        if user_id:
            try:
                from app.infrastructure.mock_storage import get_api_key as _get_user_key
                encrypted = _get_user_key(user_id, provider)
                if encrypted:
                    from app.services.encryption_service import get_encryption_service
                    return get_encryption_service().decrypt(encrypted.encode()).decode()
            except Exception:
                pass

        # 2. Fall back to environment variable
        key_map = {
            "openai": self.settings.openai_api_key,
            "deepseek": self.settings.deepseek_api_key,
            "claude": self.settings.claude_api_key,
            "dashscope": self.settings.dashscope_api_key,
            "zhipu": self.settings.zhipu_api_key,
            "minimax": self.settings.minimax_api_key,
            "ollama": self.settings.ollama_base_url,
        }
        return key_map.get(provider, "")

    def _get_model_name(self, provider: str, model: str = None) -> str:
        """Get model name for provider with litellm prefix format."""
        if model:
            # If model already has provider prefix, use as-is
            if "/" in model:
                return model
            # Otherwise add provider prefix for litellm
            provider_prefixes = {
                "deepseek": "deepseek/",
                "openai": "openai/",
                "claude": "anthropic/",
                "dashscope": "openai/",
                "zhipu": "openai/",
                "minimax": "openai/",
                "ollama": "ollama/",
            }
            prefix = provider_prefixes.get(provider, f"{provider}/")
            return f"{prefix}{model}"
        return self.MODEL_MAP.get(provider, "gpt-4o")

    async def complete(
        self,
        provider: str,
        messages: list[dict],
        model: str = None,
        stream: bool = True,
        user_id: str = None,
    ) -> AsyncGenerator[str, None] | str:
        """
        Call LLM with messages.

        Args:
            provider: LLM provider name
            messages: Chat messages
            model: Optional model override
            stream: Whether to stream response
            user_id: Optional user ID for per-user API key lookup

        Yields:
            Response chunks if streaming
        """
        try:
            from litellm import acompletion

            model_name = self._get_model_name(provider, model)
            api_key = self._get_api_key(provider, user_id)

            # Configure based on provider
            kwargs = {
                "model": model_name,
                "messages": messages,
                "stream": stream,
            }

            # Add provider-specific settings
            if provider == "ollama":
                kwargs["api_base"] = self.settings.ollama_base_url
            else:
                kwargs["api_key"] = api_key

            response = await acompletion(**kwargs)

            if stream:
                async for chunk in response:
                    content = chunk.choices[0].delta.content
                    if content:
                        yield content
            else:
                yield response.choices[0].message.content

        except Exception as e:
            yield f"Error: {str(e)}"

    async def test_connection(self, provider: str, user_id: str = None) -> dict[str, Any]:
        """
        Test connection to a provider.

        Args:
            provider: Provider name
            user_id: Optional user ID for per-user API key lookup

        Returns:
            Dict with success status, latency, and optional error
        """
        # 先检查是否有可用的 API Key
        api_key = self._get_api_key(provider, user_id)
        if not api_key and provider != "ollama":
            return {
                "success": False,
                "error": f"未配置 {provider} 的 API Key",
                "message": "Connection failed",
            }

        start_time = time.time()

        try:
            messages = [{"role": "user", "content": "Hi"}]
            response_text = ""
            async for chunk in self.complete(provider, messages, stream=False, user_id=user_id):
                response_text += chunk

            if response_text.startswith("Error:"):
                return {
                    "success": False,
                    "error": response_text,
                    "message": "Connection failed",
                }

            latency_ms = int((time.time() - start_time) * 1000)
            return {
                "success": True,
                "message": "Connection successful",
                "latencyMs": latency_ms,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "message": "Connection failed",
            }

    @staticmethod
    def get_providers() -> list[dict]:
        """Get list of supported providers with their models."""
        return [
            {
                "id": "deepseek",
                "name": "DeepSeek",
                "models": ["deepseek-v4-pro", "deepseek-v4-flash"],
            },
            {
                "id": "dashscope",
                "name": "阿里百炼",
                "models": ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-coder-turbo"],
            },
            {
                "id": "zhipu",
                "name": "智谱 AI",
                "models": ["glm-4-flash", "glm-4", "glm-5"],
            },
            {
                "id": "minimax",
                "name": "MiniMax",
                "models": ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2-Her"],
            },
            {
                "id": "openai",
                "name": "OpenAI",
                "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
            },
            {
                "id": "claude",
                "name": "Claude",
                "models": ["claude-sonnet-4-20250514", "claude-opus-4-5-20251101"],
            },
            {
                "id": "ollama",
                "name": "Ollama (本地)",
                "models": ["llama3", "mixtral", "codellama"],
            },
        ]


# Global LLM service instance
_llm_service: LiteLLMService | None = None


def get_llm_service() -> LiteLLMService:
    """Get or create LLM service instance."""
    global _llm_service
    if _llm_service is None:
        _llm_service = LiteLLMService()
    return _llm_service