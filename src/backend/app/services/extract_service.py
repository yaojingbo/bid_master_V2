from __future__ import annotations
"""
Extract service for document element extraction using LLM.
"""
import io
from typing import AsyncGenerator, Dict, Any, Optional
import json

from app.services.llm_service import LLMService
from app.services.file_service import FileService
from app.infrastructure.mock_storage import add_extract


def extract_text_from_pdf(content: bytes, max_pages: int = 30) -> str:
    """从PDF二进制内容中提取文本"""
    import pdfplumber
    text = ""
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for i, page in enumerate(pdf.pages[:max_pages]):
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text


def extract_text_from_docx(content: bytes) -> str:
    """从 .docx 二进制内容中提取文本（含段落和表格）"""
    from docx import Document
    doc = Document(io.BytesIO(content))
    parts = []

    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)

    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            parts.append(" | ".join(cells))

    return "\n".join(parts)


def extract_text_from_xlsx(content: bytes) -> str:
    """从 .xlsx 二进制内容中提取文本（按 sheet 组织）"""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    parts = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        parts.append(f"## Sheet: {sheet_name}")
        for row in ws.iter_rows(values_only=True):
            row_values = [str(c) if c is not None else "" for c in row]
            line = " | ".join(row_values).strip()
            if line:
                parts.append(line)
        parts.append("")

    wb.close()
    return "\n".join(parts)


def extract_text_from_xls(content: bytes) -> str:
    """从 .xls（旧格式）二进制内容中提取文本"""
    import xlrd
    wb = xlrd.open_workbook(file_contents=content)
    parts = []

    for sheet_name in wb.sheet_names():
        ws = wb.sheet_by_name(sheet_name)
        parts.append(f"## Sheet: {sheet_name}")
        for row_idx in range(ws.nrows):
            row_values = [str(ws.cell_value(row_idx, col_idx)) for col_idx in range(ws.ncols)]
            line = " | ".join(row_values).strip()
            if line:
                parts.append(line)
        parts.append("")

    return "\n".join(parts)


# OLE2 magic bytes (XLS, DOC)
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def extract_text_from_content(content: bytes) -> str:
    """根据文件内容自动判断格式并提取文本（magic bytes 检测）"""
    # PDF
    if content[:4] == b"%PDF":
        return extract_text_from_pdf(content)

    # ZIP-based: DOCX or XLSX
    if content[:4] == b"PK\x03\x04":
        import zipfile
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                names = zf.namelist()
                if any("word/" in n for n in names):
                    return extract_text_from_docx(content)
                elif any("xl/" in n for n in names):
                    return extract_text_from_xlsx(content)
        except Exception:
            pass
        return ""

    # OLE2: XLS
    if content[:8] == _OLE2_MAGIC:
        try:
            return extract_text_from_xls(content)
        except Exception:
            pass
        return ""

    # Plain text (Markdown, CSV, TXT...)
    for encoding in ["utf-8", "gbk", "gb2312", "latin-1"]:
        try:
            return content.decode(encoding)
        except (UnicodeDecodeError, ValueError):
            continue

    return ""


class ExtractService:
    """Service for extracting elements from tender documents."""

    def __init__(
        self,
        llm_service: LLMService = None,
        file_service: FileService = None,
    ):
        self.llm = llm_service or LLMService()
        self.file_service = file_service or FileService()

    async def extract_elements_stream(
        self,
        document_id: str,
        provider: str = "deepseek",
        model: Optional[str] = None,
        template_type: str = "standard",
        elements: Optional[list[str]] = None,
        mode: str = "single",
        params: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Extract elements from document with SSE streaming.

        Args:
            document_id: 文件 UUID
            provider: LLM 供应商
            model: 模型名
            template_type: standard | brief | batch | threshold
            elements: 指定提取的要素 key 列表
            mode: single | batch | threshold
            params: 额外参数（如 threshold 模式的 user_qualifications）
        """
        from app.services.prompt_builder import get_prompt_builder

        try:
            yield {"type": "progress", "message": "正在读取文档...", "phase": "reading", "percentage": 5}

            content = await self.file_service.download(document_id)

            text_content = extract_text_from_content(content)

            if not text_content.strip():
                yield {"type": "error", "data": {"message": "文档内容为空或无法解析"}}
                return

            yield {"type": "progress", "message": f"文档解析完成（{len(text_content)}字符），正在分析...", "phase": "parsing", "percentage": 20}

            # 文档截断（200K 字符，约 50K token，与旧项目对齐）
            MAX_CHARS = 200000
            truncated = text_content[:MAX_CHARS]
            if len(text_content) > MAX_CHARS:
                truncated += f"\n\n[文档已截断，共 {len(text_content)} 字符]"

            # 用 PromptBuilder 构建 prompt（注入领域知识 + 提取规则 + 输出模板）
            builder = get_prompt_builder()
            system_prompt = builder.build_extract_system_prompt(template_type, elements)
            user_prompt = builder.build_extract_user_prompt(truncated, mode, params)

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            # Notify frontend that AI analysis is starting
            yield {"type": "progress", "message": "AI 正在分析文档内容，请稍候...", "phase": "analyzing", "percentage": 30}

            # LLM 流式调用 + 进度推送 + JSON 解析
            async for event in self._stream_llm_with_progress(
                provider, messages, model, document_id, template_type, user_id
            ):
                yield event

        except Exception as e:
            yield {"type": "error", "data": {"message": str(e)}}

    async def _stream_llm_with_progress(
        self,
        provider: str,
        messages: list[dict],
        model: Optional[str],
        file_id: str,
        template_type: str,
        user_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """LLM 流式调用 + 进度推送 + JSON 解析。LLM 在后台 Task 中运行，不受 SSE 断连影响。"""
        import asyncio
        chunk_queue: asyncio.Queue = asyncio.Queue()
        result_holder = {"text": "", "done": False, "error": None}
        _saved = False

        async def _llm_background_task():
            """后台运行 LLM 调用，chunks 推入 Queue。即使 SSE 断连也会继续运行。"""
            try:
                count = 0
                async for chunk in self.llm.llm.complete(provider, messages, model=model, stream=True):
                    result_holder["text"] += chunk
                    count += 1
                    await chunk_queue.put({"type": "chunk", "count": count})
                result_holder["done"] = True
                await chunk_queue.put({"type": "llm_done"})
            except Exception as e:
                result_holder["error"] = str(e)
                await chunk_queue.put({"type": "llm_error", "error": str(e)})

        background_task = asyncio.create_task(_llm_background_task())

        try:
            while True:
                event = await chunk_queue.get()
                if event["type"] == "chunk":
                    if event["count"] % 15 == 0:
                        yield {"type": "llm_progress", "message": "AI 正在分析文档内容...", "phase": "analyzing", "percentage": min(30 + event["count"] // 3, 85)}
                elif event["type"] == "llm_done":
                    # LLM 完成，解析并保存
                    full_response = result_holder["text"]
                    try:
                        json_start = full_response.find("{")
                        json_end = full_response.rfind("}") + 1
                        if json_start != -1 and json_end > json_start:
                            json_str = full_response[json_start:json_end]
                            parsed = json.loads(json_str)
                            if isinstance(parsed, dict) and "elements" in parsed:
                                found_elements = parsed["elements"]
                            elif isinstance(parsed, dict):
                                found_elements = next(
                                    (v for v in parsed.values()
                                     if isinstance(v, list) and v and isinstance(v[0], dict)),
                                    [],
                                )
                            elif isinstance(parsed, list):
                                found_elements = parsed
                            else:
                                found_elements = []

                            add_extract({
                                "file_id": file_id,
                                "template_type": template_type,
                                "mode": provider,
                                "content": json_str,
                                "status": "completed",
                            }, user_id=user_id)
                            _saved = True

                            for element in found_elements:
                                yield {"type": "element", "data": element, "phase": "extracting", "percentage": 90}
                            yield {
                                "type": "done",
                                "data": {"summary": "文档分析完成", "elementCount": len(found_elements)},
                                "phase": "extracting",
                                "percentage": 100,
                            }
                        else:
                            add_extract({
                                "file_id": file_id,
                                "template_type": template_type,
                                "mode": provider,
                                "content": full_response,
                                "status": "completed_text",
                            }, user_id=user_id)
                            _saved = True
                            yield {
                                "type": "done",
                                "data": {"summary": "文档分析完成（文本格式）", "elementCount": 0},
                            }
                    except json.JSONDecodeError:
                        add_extract({
                            "file_id": file_id,
                            "template_type": template_type,
                            "mode": provider,
                            "content": full_response,
                            "status": "completed_json_error",
                        }, user_id=user_id)
                        _saved = True
                        yield {
                            "type": "done",
                            "data": {"summary": "文档分析完成，但JSON解析失败", "elementCount": 0},
                        }
                    break
                elif event["type"] == "llm_error":
                    yield {"type": "error", "data": {"message": event["error"]}}
                    break

        finally:
            # SSE generator 被取消（客户端断连）时的处理
            if not _saved:
                if result_holder["done"]:
                    # LLM 已完成但 SSE 流在推送结果时断开 — 保存完整结果
                    full_response = result_holder["text"]
                    add_extract({
                        "file_id": file_id,
                        "template_type": template_type,
                        "mode": provider,
                        "content": full_response,
                        "status": "completed_disconnected",
                    }, user_id=user_id)
                elif result_holder["text"]:
                    # LLM 还在运行但有部分结果 — 保存部分结果
                    add_extract({
                        "file_id": file_id,
                        "template_type": template_type,
                        "mode": provider,
                        "content": result_holder["text"],
                        "status": "partial",
                    }, user_id=user_id)
                    # 不取消 background_task，让它继续运行到完成
                    # background_task 完成后会自动释放资源
                    # 但我们需要确保它完成后也保存结果
                    async def _ensure_save_on_completion():
                        await background_task
                        if result_holder["done"] and not _saved:
                            add_extract({
                                "file_id": file_id,
                                "template_type": template_type,
                                "mode": provider,
                                "content": result_holder["text"],
                                "status": "completed_background",
                            }, user_id=user_id)
                    asyncio.create_task(_ensure_save_on_completion())

    async def extract_batch_stream(
        self,
        file_ids: list[str],
        provider: str = "deepseek",
        model: Optional[str] = None,
        elements: Optional[list[str]] = None,
        user_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """批量对比：并行下载多个文件 → 合并 → batch 模板 → LLM 对比。"""
        from app.services.prompt_builder import get_prompt_builder
        import asyncio

        try:
            total = len(file_ids)
            yield {"type": "progress", "message": f"正在读取 {total} 个文件..."}

            # 并行下载 + 解析所有文件
            async def fetch_and_parse(fid: str) -> tuple[str, str]:
                try:
                    content = await self.file_service.download(fid)
                    text = extract_text_from_content(content)
                    return fid, text
                except Exception as e:
                    return fid, f"[读取失败: {e}]"

            results = await asyncio.gather(*[fetch_and_parse(fid) for fid in file_ids])

            # 合并文本
            all_parts = []
            success_count = 0
            for fid, text in results:
                if not text.strip():
                    all_parts.append(f"## 文件: {fid}\n[内容为空]\n")
                elif text.startswith("[读取失败"):
                    all_parts.append(f"## 文件: {fid}\n{text}\n")
                else:
                    success_count += 1
                    all_parts.append(f"## 文件: {fid}\n{text[:50000]}\n")

            if success_count < 2:
                yield {"type": "error", "data": {"message": f"至少需要 2 个有效文件，当前仅有 {success_count} 个"}}
                return

            combined = "\n\n---\n\n".join(all_parts)
            MAX_CHARS = 200000
            if len(combined) > MAX_CHARS:
                combined = combined[:MAX_CHARS] + f"\n\n[内容已截断，共 {len(combined)} 字符]"

            yield {"type": "progress", "message": f"{success_count} 个文件读取完成，正在对比分析..."}

            builder = get_prompt_builder()
            system_prompt = builder.build_extract_system_prompt("batch", elements)
            user_prompt = builder.build_extract_user_prompt(combined, mode="batch")

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            yield {"type": "progress", "message": "AI 正在对比分析多份招标文件..."}

            async for event in self._stream_llm_with_progress(
                provider, messages, model, ",".join(file_ids), "batch", user_id
            ):
                yield event

        except Exception as e:
            yield {"type": "error", "data": {"message": str(e)}}

    async def extract_threshold_stream(
        self,
        file_id: str,
        user_qualifications: str,
        provider: str = "deepseek",
        model: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """门槛分析：下载文件 → threshold 模板 + 用户资质 → LLM 逐项比对。"""
        from app.services.prompt_builder import get_prompt_builder

        try:
            yield {"type": "progress", "message": "正在读取招标文件..."}

            content = await self.file_service.download(file_id)
            text_content = extract_text_from_content(content)

            if not text_content.strip():
                yield {"type": "error", "data": {"message": "文档内容为空或无法解析"}}
                return

            yield {"type": "progress", "message": f"文档解析完成（{len(text_content)}字符），正在比对分析..."}

            MAX_CHARS = 200000
            truncated = text_content[:MAX_CHARS]

            builder = get_prompt_builder()
            system_prompt = builder.build_extract_system_prompt("threshold")
            user_prompt = builder.build_extract_user_prompt(
                truncated, mode="threshold", params={"user_qualifications": user_qualifications}
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            yield {"type": "progress", "message": "AI 正在逐项比对门槛要求..."}

            async for event in self._stream_llm_with_progress(
                provider, messages, model, file_id, "threshold", user_id
            ):
                yield event

        except Exception as e:
            yield {"type": "error", "data": {"message": str(e)}}


_extract_service: ExtractService | None = None


def get_extract_service() -> ExtractService:
    """Get or create extract service instance."""
    global _extract_service
    if _extract_service is None:
        _extract_service = ExtractService()
    return _extract_service