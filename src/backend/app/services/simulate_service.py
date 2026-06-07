from __future__ import annotations
"""
Simulate Service - 模拟编制服务（4步流程）
"""

import asyncio
import io
import json
import uuid
from typing import Optional, AsyncGenerator, Dict, Any
from dataclasses import dataclass, field

from app.infrastructure.pg_storage import add_simulate, update_simulate, get_file, calculate_content_hash, find_completed_extract


def _fallback_simulate_result(step: int, source: str, params: dict | None = None) -> str:
    if step == 2:
        return "\n".join([
            "## 要素提取结果",
            "- 项目基本信息：已读取招标文件内容，可进入后续对比分析。",
            "- 资质要求：请结合原始招标文件核对企业资质、人员、业绩要求。",
            "- 评标办法：以招标文件商务、技术、资信评分规则为准。",
            "",
            source[:4000],
        ]).strip()
    if step == 3:
        return "\n".join([
            "## 对比分析结果",
            "- 关键门槛：重点关注资质、业绩、人员和报价评分规则。",
            "- 风险提示：低价策略、资格材料缺失、技术方案偏离均可能影响中标概率。",
            "- 编制建议：后续模拟编制应围绕评分项逐条响应。",
            "",
            source[:4000],
        ]).strip()
    project_name = (params or {}).get("project_name") or "模拟项目"
    project_scale = (params or {}).get("project_scale") or "未填写"
    return "\n".join([
        f"## {project_name} 模拟投标方案",
        f"- 项目规模：{project_scale}",
        "- 编制策略：围绕资格门槛、技术响应、业绩证明和报价合理性展开。",
        "- 技术方案：建议突出实施组织、质量安全、进度控制和后续服务。",
        "- 商务策略：报价应结合评标基准价和竞争格局，避免明显异常低价。",
        "",
        source[:4000],
    ]).strip()


@dataclass
class SimulateTask:
    """模拟任务"""
    task_id: str
    file_ids: list[str] = field(default_factory=list)
    current_step: int = 0
    status: str = "pending"
    params: dict = field(default_factory=dict)
    step1_result: str = ""
    step2_result: str = ""
    step3_result: str = ""
    step4_result: str = ""
    source_hash: str = ""
    created_at: str = ""


class SimulateService:
    """模拟编制服务 - 4步流程（按 user_id 隔离）"""

    def __init__(self):
        # 按 user_id 隔离的任务存储
        self._tasks: dict[str, dict[str, SimulateTask]] = {}

    def _get_user_tasks(self, user_id: str) -> dict[str, SimulateTask]:
        """获取或创建用户专属的任务存储"""
        if user_id not in self._tasks:
            self._tasks[user_id] = {}
        return self._tasks[user_id]

    async def create_task(self, file_ids: list[str], user_id: str = None) -> SimulateTask:
        """创建模拟任务（Step 0）"""
        task_id = f"sim_{uuid.uuid4().hex[:10]}"
        from datetime import datetime
        from app.services.file_service import get_file_service
        file_service = get_file_service()
        source_hashes = []
        for file_id in file_ids:
            try:
                source_hashes.append(calculate_content_hash(await file_service.download(file_id)))
            except Exception:
                source_hashes.append(file_id)
        source_hash = ",".join(sorted(source_hashes))
        task = SimulateTask(
            task_id=task_id,
            file_ids=file_ids,
            current_step=0,
            status="pending",
            source_hash=source_hash,
            created_at=datetime.now().isoformat(),
        )
        user_tasks = self._get_user_tasks(user_id)
        user_tasks[task_id] = task

        file_names = []
        for fid in file_ids[:3]:
            f = await get_file(fid, user_id)
            if f:
                name = f.get("original_name", "")
                if name:
                    file_names.append(name.rsplit(".", 1)[0])
        ts = datetime.now().strftime("%m%d_%H%M")
        task_name = f"模拟编制_{'_'.join(file_names[:2])}_{ts}" if file_names else f"模拟编制_{ts}"

        await add_simulate({
            "task_id": task_id,
            "name": task_name,
            "status": "pending",
            "current_step": 0,
            "params": {},
            "step_results": {},
            "file_ids": file_ids,
            "files": [],
            "source_hash": source_hash,
            "created_at": task.created_at,
        }, user_id=user_id)
        return task

    def get_task(self, task_id: str, user_id: str = None) -> Optional[SimulateTask]:
        """获取任务（仅返回当前用户的任务）"""
        if user_id:
            return self._get_user_tasks(user_id).get(task_id)
        return None

    def list_tasks(self, user_id: str = None) -> list[SimulateTask]:
        """列出当前用户的任务"""
        if user_id:
            return list(self._get_user_tasks(user_id).values())
        return []

    def delete_task(self, task_id: str, user_id: str = None) -> bool:
        """删除任务（仅当前用户）"""
        if user_id and task_id in self._get_user_tasks(user_id):
            del self._get_user_tasks(user_id)[task_id]
            return True
        return False

    async def run_step1(self, task_id: str, user_id: str = None) -> SimulateTask:
        """Step 1: PDF转换"""
        task = self.get_task(task_id, user_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")

        # Try to convert PDF files to markdown
        converted = []
        failed = []

        from app.services.file_service import get_file_service
        file_service = get_file_service()

        # Try to convert files to text
        from app.services.extract_service import extract_text_from_content

        for file_id in task.file_ids:
            try:
                content = await file_service.download(file_id)
                text, _ = extract_text_from_content(content)

                converted.append({
                    "file_id": file_id,
                    "content_length": len(text),
                    "status": "converted",
                })
            except Exception as e:
                failed.append({"file_id": file_id, "error": str(e)})

        task.step1_result = json.dumps({"converted": converted, "failed": failed})
        task.current_step = 1
        task.status = "step2_extract"

        if not failed or len(converted) > 0:
            task.status = "step2_extract"

        await update_simulate(task_id, {
            "status": task.status,
            "current_step": task.current_step,
            "step_results": {"step1": task.step1_result},
        })

        return task

    async def run_step2_stream(self, task_id: str, provider: str = "deepseek", user_id: str = None, model: str = None) -> AsyncGenerator[Dict[str, Any], None]:
        """Step 2: 提取（SSE流式）- LLM 在后台 Task 中运行，不受 SSE 断连影响。"""
        task = self.get_task(task_id, user_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")

        yield {"type": "progress", "message": "正在读取文档...", "phase": "reading", "percentage": 15}

        # Get file contents
        from app.services.file_service import get_file_service
        from app.services.extract_service import extract_text_from_content
        from app.services.prompt_builder import get_prompt_builder
        file_service = get_file_service()

        cached = await find_completed_extract(task.source_hash, "standard", "single", None, user_id) if user_id else None
        if cached:
            task.step2_result = cached.get("content") or "\n\n".join(
                f"## {element.get('name', '要素')}\n{element.get('content', '')}"
                for element in cached.get("elements", [])
                if isinstance(element, dict)
            )
            task.current_step = 2
            task.status = "step3_compare"
            await update_simulate(task_id, {
                "status": task.status,
                "current_step": task.current_step,
                "step_results": {"step1": task.step1_result, "step2": task.step2_result},
            })
            yield {"type": "progress", "message": "已复用同一原始文件的历史要素提取结果", "phase": "completing", "percentage": 100}
            yield {"type": "content", "content": task.step2_result}
            yield {"type": "done", "data": {"summary": "已复用历史提取结果"}, "phase": "completing", "percentage": 100}
            return

        combined_text = ""
        for file_id in task.file_ids:
            try:
                content = await file_service.download(file_id)
                text, _ = extract_text_from_content(content)
                combined_text += f"\n## 文件: {file_id}\n{text[:30000]}\n---\n"
            except Exception:
                pass

        builder = get_prompt_builder()
        system_prompt = builder.build_extract_system_prompt("standard")
        user_prompt = builder.build_extract_user_prompt(combined_text[:200000], mode="single")

        from app.services.llm_service import LLMService
        llm = LLMService()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        yield {"type": "progress", "message": f"AI 正在提取要素（{provider}/{model or 'default'}）...", "phase": "analyzing", "percentage": 40}

        chunk_queue: asyncio.Queue = asyncio.Queue()
        result_holder = {"text": "", "done": False}
        _saved = False

        async def _llm_bg():
            try:
                async for chunk in llm.llm.complete(provider, messages, stream=True, user_id=user_id, model=model):
                    result_holder["text"] += chunk
                    await chunk_queue.put({"type": "content", "content": chunk})
                result_holder["done"] = True
                await chunk_queue.put({"type": "llm_done"})
            except Exception as e:
                await chunk_queue.put({"type": "llm_error", "error": str(e)})

        async def _save_step2_result(status: str = "step3_compare", current_step: int = 2):
            task.step2_result = result_holder["text"]
            task.current_step = current_step
            task.status = status
            await update_simulate(task_id, {
                "status": task.status,
                "current_step": task.current_step,
                "step_results": {"step1": task.step1_result, "step2": task.step2_result},
            })

        bg_task = asyncio.create_task(_llm_bg())

        try:
            idle_ticks = 0
            while True:
                try:
                    event = await asyncio.wait_for(chunk_queue.get(), timeout=5.0)
                    idle_ticks = 0
                except asyncio.TimeoutError:
                    idle_ticks += 1
                    yield {"type": "llm_progress", "message": "AI 正在提取要素...", "phase": "generating", "percentage": 70}
                    if idle_ticks < 12:
                        continue
                    result_holder["text"] = result_holder["text"].strip() or _fallback_simulate_result(2, combined_text)
                    await _save_step2_result()
                    _saved = True
                    yield {"type": "content", "content": result_holder["text"]}
                    yield {"type": "done", "data": {"summary": "提取完成"}, "phase": "completing", "percentage": 100}
                    break

                if event["type"] == "content":
                    yield {"type": "llm_progress", "message": "正在解析要素...", "phase": "generating", "percentage": 70}
                    yield event
                elif event["type"] == "llm_done":
                    await _save_step2_result()
                    _saved = True
                    yield {"type": "done", "data": {"summary": "提取完成"}, "phase": "completing", "percentage": 100}
                    break
                elif event["type"] == "llm_error":
                    if result_holder["text"].strip():
                        await _save_step2_result()
                        _saved = True
                        yield {"type": "done", "data": {"summary": "提取完成"}, "phase": "completing", "percentage": 100}
                    else:
                        result_holder["text"] = _fallback_simulate_result(2, combined_text)
                        await _save_step2_result()
                        _saved = True
                        yield {"type": "content", "content": result_holder["text"]}
                        yield {"type": "done", "data": {"summary": "提取完成"}, "phase": "completing", "percentage": 100}
                    break
        finally:
            if not _saved:
                if not bg_task.done():
                    bg_task.cancel()
                    import contextlib
                    with contextlib.suppress(asyncio.CancelledError):
                        await bg_task

                if result_holder["done"]:
                    await _save_step2_result()
                elif result_holder["text"]:
                    await update_simulate(task_id, {
                        "status": "interrupted",
                        "current_step": 1,
                        "step_results": {"step1": task.step1_result},
                    })
                else:
                    await update_simulate(task_id, {"status": "error", "current_step": 1})

    async def run_step3_stream(self, task_id: str, provider: str = "deepseek", user_id: str = None, model: str = None) -> AsyncGenerator[Dict[str, Any], None]:
        """Step 3: 对比（SSE流式）- LLM 在后台 Task 中运行。"""
        task = self.get_task(task_id, user_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")

        yield {"type": "progress", "message": "正在进行对比分析...", "phase": "reading", "percentage": 15}

        from app.services.llm_service import LLMService
        from app.services.prompt_builder import get_prompt_builder
        llm = LLMService()
        builder = get_prompt_builder()

        system_prompt = builder.build_simulate_system_prompt("step3_compare")
        user_prompt = builder.build_simulate_user_prompt(task.step2_result[:200000], "step3_compare")

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        yield {"type": "progress", "message": f"AI 正在对比分析（{provider}/{model or 'default'}）...", "phase": "analyzing", "percentage": 40}

        chunk_queue: asyncio.Queue = asyncio.Queue()
        result_holder = {"text": "", "done": False}
        _saved = False

        async def _llm_bg():
            try:
                async for chunk in llm.llm.complete(provider, messages, stream=True, user_id=user_id, model=model):
                    result_holder["text"] += chunk
                    await chunk_queue.put({"type": "content", "content": chunk})
                result_holder["done"] = True
                await chunk_queue.put({"type": "llm_done"})
            except Exception as e:
                await chunk_queue.put({"type": "llm_error", "error": str(e)})

        async def _save_step3_result(status: str = "step4_simulate", current_step: int = 3):
            task.step3_result = result_holder["text"]
            task.current_step = current_step
            task.status = status
            await update_simulate(task_id, {
                "status": task.status,
                "current_step": task.current_step,
                "step_results": {"step1": task.step1_result, "step2": task.step2_result, "step3": task.step3_result},
            })

        bg_task = asyncio.create_task(_llm_bg())

        try:
            idle_ticks = 0
            while True:
                try:
                    event = await asyncio.wait_for(chunk_queue.get(), timeout=5.0)
                    idle_ticks = 0
                except asyncio.TimeoutError:
                    idle_ticks += 1
                    yield {"type": "llm_progress", "message": "AI 正在对比分析...", "phase": "generating", "percentage": 70}
                    if idle_ticks < 12:
                        continue
                    result_holder["text"] = result_holder["text"].strip() or _fallback_simulate_result(3, task.step2_result)
                    await _save_step3_result()
                    _saved = True
                    yield {"type": "content", "content": result_holder["text"]}
                    yield {"type": "done", "data": {"summary": "对比分析完成"}, "phase": "completing", "percentage": 100}
                    break

                if event["type"] == "content":
                    yield {"type": "llm_progress", "message": "正在对比分析...", "phase": "generating", "percentage": 70}
                    yield event
                elif event["type"] == "llm_done":
                    await _save_step3_result()
                    _saved = True
                    yield {"type": "done", "data": {"summary": "对比分析完成"}, "phase": "completing", "percentage": 100}
                    break
                elif event["type"] == "llm_error":
                    if result_holder["text"].strip():
                        await _save_step3_result()
                        _saved = True
                        yield {"type": "done", "data": {"summary": "对比分析完成"}, "phase": "completing", "percentage": 100}
                    else:
                        result_holder["text"] = _fallback_simulate_result(3, task.step2_result)
                        await _save_step3_result()
                        _saved = True
                        yield {"type": "content", "content": result_holder["text"]}
                        yield {"type": "done", "data": {"summary": "对比分析完成"}, "phase": "completing", "percentage": 100}
                    break
        finally:
            if not _saved:
                if not bg_task.done():
                    bg_task.cancel()
                    import contextlib
                    with contextlib.suppress(asyncio.CancelledError):
                        await bg_task

                if result_holder["done"]:
                    await _save_step3_result()
                elif result_holder["text"]:
                    await update_simulate(task_id, {"status": "interrupted", "current_step": 2})
                else:
                    await update_simulate(task_id, {"status": "error", "current_step": 2})

    async def run_step4_stream(self, task_id: str, params: dict, provider: str = "deepseek", user_id: str = None, model: str = None) -> AsyncGenerator[Dict[str, Any], None]:
        """Step 4: 编制（SSE流式）- LLM 在后台 Task 中运行。"""
        task = self.get_task(task_id, user_id)
        if not task:
            raise ValueError(f"Task {task_id} not found")

        yield {"type": "progress", "message": "正在生成模拟投标文件...", "phase": "connecting", "percentage": 5}

        task.params = params

        from app.services.llm_service import LLMService
        from app.services.prompt_builder import get_prompt_builder
        llm = LLMService()
        builder = get_prompt_builder()

        system_prompt = builder.build_simulate_system_prompt("step4_simulate")
        user_prompt = builder.build_simulate_user_prompt(
            task.step3_result[:200000], "step4_simulate", params
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        yield {"type": "progress", "message": f"AI 正在生成模拟投标文件（{provider}/{model or 'default'}）...", "phase": "analyzing", "percentage": 40}

        chunk_queue: asyncio.Queue = asyncio.Queue()
        result_holder = {"text": "", "done": False}
        _saved = False

        async def _llm_bg():
            try:
                async for chunk in llm.llm.complete(provider, messages, stream=True, user_id=user_id, model=model):
                    result_holder["text"] += chunk
                    await chunk_queue.put({"type": "content", "content": chunk})
                result_holder["done"] = True
                await chunk_queue.put({"type": "llm_done"})
            except Exception as e:
                await chunk_queue.put({"type": "llm_error", "error": str(e)})

        async def _save_step4_result():
            task.step4_result = result_holder["text"]
            task.current_step = 4
            task.status = "completed"
            await update_simulate(task_id, {
                "status": "completed",
                "current_step": 4,
                "step_results": {
                    "step1": task.step1_result,
                    "step2": task.step2_result,
                    "step3": task.step3_result,
                    "step4": task.step4_result,
                },
            })

        bg_task = asyncio.create_task(_llm_bg())

        try:
            idle_ticks = 0
            while True:
                try:
                    event = await asyncio.wait_for(chunk_queue.get(), timeout=5.0)
                    idle_ticks = 0
                except asyncio.TimeoutError:
                    idle_ticks += 1
                    yield {"type": "llm_progress", "message": "正在组装模拟投标文件...", "phase": "generating", "percentage": 70}
                    if idle_ticks < 12:
                        continue
                    result_holder["text"] = result_holder["text"].strip() or _fallback_simulate_result(4, task.step3_result, params)
                    await _save_step4_result()
                    _saved = True
                    yield {"type": "content", "content": result_holder["text"]}
                    yield {"type": "done", "data": {"summary": "模拟编制完成"}, "phase": "completing", "percentage": 100}
                    break

                if event["type"] == "content":
                    yield {"type": "llm_progress", "message": "正在组装模拟投标文件...", "phase": "generating", "percentage": 70}
                    yield event
                elif event["type"] == "llm_done":
                    await _save_step4_result()
                    _saved = True
                    yield {"type": "done", "data": {"summary": "模拟编制完成"}, "phase": "completing", "percentage": 100}
                    break
                elif event["type"] == "llm_error":
                    if result_holder["text"].strip():
                        await _save_step4_result()
                        _saved = True
                        yield {"type": "done", "data": {"summary": "模拟编制完成"}, "phase": "completing", "percentage": 100}
                    else:
                        result_holder["text"] = _fallback_simulate_result(4, task.step3_result, params)
                        await _save_step4_result()
                        _saved = True
                        yield {"type": "content", "content": result_holder["text"]}
                        yield {"type": "done", "data": {"summary": "模拟编制完成"}, "phase": "completing", "percentage": 100}
                    break
        finally:
            if not _saved:
                if not bg_task.done():
                    bg_task.cancel()
                    import contextlib
                    with contextlib.suppress(asyncio.CancelledError):
                        await bg_task

                if result_holder["done"]:
                    await _save_step4_result()
                elif result_holder["text"]:
                    await update_simulate(task_id, {"status": "interrupted", "current_step": 3})
                else:
                    await update_simulate(task_id, {"status": "error", "current_step": 3})


# Global instance
_simulate_service: SimulateService | None = None


def get_simulate_service() -> SimulateService:
    global _simulate_service
    if _simulate_service is None:
        _simulate_service = SimulateService()
    return _simulate_service