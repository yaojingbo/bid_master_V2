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

from app.infrastructure.mock_storage import add_simulate, update_simulate


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

    def create_task(self, file_ids: list[str], user_id: str = None) -> SimulateTask:
        """创建模拟任务（Step 0）"""
        task_id = f"sim_{uuid.uuid4().hex[:10]}"
        from datetime import datetime
        from app.infrastructure.mock_storage import get_file
        task = SimulateTask(
            task_id=task_id,
            file_ids=file_ids,
            current_step=0,
            status="pending",
            created_at=datetime.now().isoformat(),
        )
        user_tasks = self._get_user_tasks(user_id)
        user_tasks[task_id] = task

        # 根据源文件名生成任务名称
        file_names = []
        for fid in file_ids[:3]:
            f = get_file(fid, user_id)
            if f:
                name = f.get("original_name", "")
                if name:
                    file_names.append(name.rsplit(".", 1)[0])
        ts = datetime.now().strftime("%m%d_%H%M")
        task_name = f"模拟编制_{'_'.join(file_names[:2])}_{ts}" if file_names else f"模拟编制_{ts}"

        add_simulate({
            "task_id": task_id,
            "name": task_name,
            "status": "pending",
            "current_step": 0,
            "params": {},
            "step_results": {},
            "file_ids": file_ids,
            "files": [],
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
                text = extract_text_from_content(content)

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

        update_simulate(task_id, {
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

        combined_text = ""
        for file_id in task.file_ids:
            try:
                content = await file_service.download(file_id)
                text = extract_text_from_content(content)
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

        bg_task = asyncio.create_task(_llm_bg())

        try:
            while True:
                event = await chunk_queue.get()
                if event["type"] == "content":
                    yield {"type": "llm_progress", "message": "正在解析要素...", "phase": "generating", "percentage": 70}
                    yield event
                elif event["type"] == "llm_done":
                    task.step2_result = result_holder["text"]
                    task.current_step = 2
                    task.status = "step3_compare"
                    update_simulate(task_id, {
                        "status": task.status,
                        "current_step": task.current_step,
                        "step_results": {"step1": task.step1_result, "step2": task.step2_result},
                    })
                    _saved = True
                    yield {"type": "done", "data": {"summary": "提取完成"}, "phase": "completing", "percentage": 100}
                    break
                elif event["type"] == "llm_error":
                    yield {"type": "error", "data": {"message": event["error"]}}
                    break
        finally:
            if not _saved:
                if result_holder["done"]:
                    task.step2_result = result_holder["text"]
                    task.current_step = 2
                    task.status = "step3_compare"
                    update_simulate(task_id, {
                        "status": task.status,
                        "current_step": task.current_step,
                        "step_results": {"step1": task.step1_result, "step2": task.step2_result},
                    })
                elif result_holder["text"]:
                    update_simulate(task_id, {
                        "status": "interrupted",
                        "current_step": 1,
                        "step_results": {"step1": task.step1_result},
                    })
                    async def _ensure_save():
                        await bg_task
                        if result_holder["done"]:
                            task.step2_result = result_holder["text"]
                            task.current_step = 2
                            task.status = "step3_compare"
                            update_simulate(task_id, {
                                "status": task.status,
                                "current_step": task.current_step,
                                "step_results": {"step1": task.step1_result, "step2": task.step2_result},
                            })
                    asyncio.create_task(_ensure_save())

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

        bg_task = asyncio.create_task(_llm_bg())

        try:
            while True:
                event = await chunk_queue.get()
                if event["type"] == "content":
                    yield {"type": "llm_progress", "message": "正在对比分析...", "phase": "generating", "percentage": 70}
                    yield event
                elif event["type"] == "llm_done":
                    task.step3_result = result_holder["text"]
                    task.current_step = 3
                    task.status = "step4_simulate"
                    update_simulate(task_id, {
                        "status": task.status,
                        "current_step": task.current_step,
                        "step_results": {"step1": task.step1_result, "step2": task.step2_result, "step3": task.step3_result},
                    })
                    _saved = True
                    yield {"type": "done", "data": {"summary": "对比分析完成"}, "phase": "completing", "percentage": 100}
                    break
                elif event["type"] == "llm_error":
                    yield {"type": "error", "data": {"message": event["error"]}}
                    break
        finally:
            if not _saved:
                if result_holder["done"]:
                    task.step3_result = result_holder["text"]
                    task.current_step = 3
                    task.status = "step4_simulate"
                    update_simulate(task_id, {
                        "status": task.status,
                        "current_step": task.current_step,
                        "step_results": {"step1": task.step1_result, "step2": task.step2_result, "step3": task.step3_result},
                    })
                elif result_holder["text"]:
                    update_simulate(task_id, {"status": "interrupted", "current_step": 2})
                    async def _ensure_save():
                        await bg_task
                        if result_holder["done"]:
                            task.step3_result = result_holder["text"]
                            task.current_step = 3
                            task.status = "step4_simulate"
                            update_simulate(task_id, {
                                "status": task.status,
                                "current_step": task.current_step,
                                "step_results": {"step1": task.step1_result, "step2": task.step2_result, "step3": task.step3_result},
                            })
                    asyncio.create_task(_ensure_save())

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

        bg_task = asyncio.create_task(_llm_bg())

        try:
            while True:
                event = await chunk_queue.get()
                if event["type"] == "content":
                    yield {"type": "llm_progress", "message": "正在组装模拟投标文件...", "phase": "generating", "percentage": 70}
                    yield event
                elif event["type"] == "llm_done":
                    task.step4_result = result_holder["text"]
                    task.current_step = 4
                    task.status = "completed"
                    update_simulate(task_id, {
                        "status": "completed",
                        "current_step": 4,
                        "step_results": {
                            "step1": task.step1_result,
                            "step2": task.step2_result,
                            "step3": task.step3_result,
                            "step4": task.step4_result,
                        },
                    })
                    _saved = True
                    yield {"type": "done", "data": {"summary": "模拟编制完成"}, "phase": "completing", "percentage": 100}
                    break
                elif event["type"] == "llm_error":
                    yield {"type": "error", "data": {"message": event["error"]}}
                    break
        finally:
            if not _saved:
                if result_holder["done"]:
                    task.step4_result = result_holder["text"]
                    task.current_step = 4
                    task.status = "completed"
                    update_simulate(task_id, {
                        "status": "completed",
                        "current_step": 4,
                        "step_results": {
                            "step1": task.step1_result,
                            "step2": task.step2_result,
                            "step3": task.step3_result,
                            "step4": task.step4_result,
                        },
                    })
                elif result_holder["text"]:
                    update_simulate(task_id, {"status": "interrupted", "current_step": 3})
                    async def _ensure_save():
                        await bg_task
                        if result_holder["done"]:
                            task.step4_result = result_holder["text"]
                            task.current_step = 4
                            task.status = "completed"
                            update_simulate(task_id, {
                                "status": "completed",
                                "current_step": 4,
                                "step_results": {
                                    "step1": task.step1_result,
                                    "step2": task.step2_result,
                                    "step3": task.step3_result,
                                    "step4": task.step4_result,
                                },
                            })
                    asyncio.create_task(_ensure_save())


# Global instance
_simulate_service: SimulateService | None = None


def get_simulate_service() -> SimulateService:
    global _simulate_service
    if _simulate_service is None:
        _simulate_service = SimulateService()
    return _simulate_service