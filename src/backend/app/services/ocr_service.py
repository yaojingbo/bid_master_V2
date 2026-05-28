"""
PDF OCR 服务：使用多模态 LLM 识别图片型 PDF 中的文字。
当 pdfplumber 提取文本量过少时，判定为扫描件，触发 OCR 流程。
"""
from __future__ import annotations

import base64
import io
import logging
from typing import AsyncGenerator, Dict, Any, Optional

from app.infrastructure.llm.lite_llm import LiteLLMService

logger = logging.getLogger(__name__)

# 每个 provider 支持视觉能力的模型列表
# 列表顺序决定优先级：第一个为默认 OCR 模型
VISION_MODELS: dict[str, list[str]] = {
    "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    "claude": ["claude-sonnet-4-20250514", "claude-opus-4-5-20251101"],
    "dashscope": ["qwen-vl-ocr", "qwen3-vl-plus", "qwen-vl-plus", "qwen-vl-max"],
    "zhipu": ["glm-4v-plus", "glm-4v"],
    "ollama": ["llava", "bakllava"],
}

# 不支持 vision 的供应商
_NO_VISION_PROVIDERS = {"deepseek", "minimax"}

# OCR 最大页数（控制 token 消耗）
MAX_OCR_PAGES = 15


def is_vision_capable(provider: str, model: str = None) -> bool:
    """检查 provider/model 是否支持视觉输入。"""
    if provider in _NO_VISION_PROVIDERS:
        return False
    if not model:
        return provider in VISION_MODELS and len(VISION_MODELS[provider]) > 0
    models = VISION_MODELS.get(provider, [])
    if model in models:
        return True
    # 宽松匹配：模型名含 vl / vision / ocr / 4o / glm-4v 等关键词
    keywords = ["vl", "vision", "ocr", "4o", "4v", "llava", "bakllava"]
    model_lower = model.lower()
    return any(kw in model_lower for kw in keywords)


def _find_vision_model(provider: str) -> Optional[str]:
    """在当前 provider 下找一个支持 vision 的模型。"""
    models = VISION_MODELS.get(provider, [])
    return models[0] if models else None


def _get_fallback_provider_model() -> tuple[str, str]:
    """回退到默认的视觉模型（阿里百炼 qwen-vl-ocr，专用 OCR 模型，更易开通）。"""
    return "dashscope", "qwen-vl-ocr"


def pdf_pages_to_images(content: bytes, dpi: int = 150, max_pages: int = MAX_OCR_PAGES) -> list[str]:
    """将 PDF 每页渲染为 base64 编码的 PNG 图片。

    Returns:
        每页图片的 base64 字符串列表
    """
    import fitz  # PyMuPDF

    doc = fitz.open(stream=content, filetype="pdf")
    images: list[str] = []
    zoom = dpi / 72  # PDF 默认 72 DPI
    matrix = fitz.Matrix(zoom, zoom)

    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pix = page.get_pixmap(matrix=matrix)
        img_bytes = pix.tobytes("png")
        images.append(base64.b64encode(img_bytes).decode("utf-8"))

    doc.close()
    return images


def resolve_vision_model(provider: str, model: str = None) -> tuple[str, str]:
    """解析可用的视觉模型，必要时回退。

    Returns:
        (effective_provider, effective_model)
    """
    if is_vision_capable(provider, model):
        return provider, model or _find_vision_model(provider) or _get_fallback_provider_model()[1]

    # 当前 provider 不支持 vision，尝试同 provider 下的视觉模型
    fallback_model = _find_vision_model(provider)
    if fallback_model:
        return provider, fallback_model

    # 彻底回退
    return _get_fallback_provider_model()


async def ocr_pdf(
    content: bytes,
    provider: str,
    model: str = None,
    user_id: str = None,
    progress_callback=None,
) -> str:
    """对图片型 PDF 执行 OCR 识别。

    Args:
        content: PDF 二进制内容
        provider: LLM 供应商
        model: 模型名（可选）
        user_id: 用户 ID（用于 API Key 查找）
        progress_callback: 进度回调，签名为 async callback(page, total)

    Returns:
        识别出的全部文字
    """
    effective_provider, effective_model = resolve_vision_model(provider, model)

    images = pdf_pages_to_images(content)
    total = len(images)

    if total == 0:
        return ""

    llm = LiteLLMService()
    all_text: list[str] = []

    for i, img_b64 in enumerate(images):
        page_num = i + 1

        if progress_callback:
            await progress_callback(page_num, total)

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "请识别并提取这张图片中的所有文字内容。"
                            "保持原始格式，包括标题、段落、表格等结构。"
                            "只输出识别到的文字，不要添加额外说明。"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{img_b64}"},
                    },
                ],
            }
        ]

        try:
            response_text = ""
            async for chunk in llm.complete(
                effective_provider,
                messages,
                model=effective_model,
                stream=False,
                user_id=user_id,
            ):
                response_text += chunk

            if response_text.strip():
                all_text.append(f"--- 第 {page_num} 页 ---\n{response_text.strip()}")
        except Exception as e:
            err_msg = str(e)
            logger.warning("OCR 第 %d 页失败: %s", page_num, e)
            # 401/403 认证错误：API Key 无权限，继续重试其他页也无意义，立即终止
            if "401" in err_msg or "403" in err_msg or "API key" in err_msg.lower() or "Incorrect" in err_msg:
                logger.error("OCR 认证失败，终止剩余页面识别: %s", err_msg[:200])
                raise RuntimeError(f"视觉模型 {effective_provider}/{effective_model} 认证失败，请确认 API Key 有该模型权限")
            all_text.append(f"--- 第 {page_num} 页 ---\n[OCR 识别失败: {err_msg[:80]}]")

    return "\n\n".join(all_text)
