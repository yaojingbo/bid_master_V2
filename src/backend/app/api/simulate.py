from __future__ import annotations
"""
Simulate API routes - 4步模拟编制流程
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sse_starlette.sse import EventSourceResponse

from app.services.simulate_service import SimulateService, get_simulate_service
from app.utils.auth_dep import get_current_user

router = APIRouter(prefix="/simulate", tags=["simulate"])


class CreateSimulateRequest(BaseModel):
    file_ids: List[str]


class SimulateParams(BaseModel):
    project_name: str
    project_type: str
    project_scale: str
    investment_estimate: Optional[str] = ""
    region: Optional[str] = ""
    special_requirements: Optional[str] = ""


class StepRequest(BaseModel):
    provider: Optional[str] = "deepseek"
    params: Optional[dict] = None


simulate_service = get_simulate_service()


@router.post("/create")
async def create_simulate_task(request: CreateSimulateRequest, current_user: dict = Depends(get_current_user)):
    """创建模拟任务（Step 0）"""
    try:
        task = simulate_service.create_task(request.file_ids, user_id=current_user["id"])
        return {
            "success": True,
            "data": {
                "taskId": task.task_id,
                "currentStep": task.current_step,
                "status": task.status,
                "fileIds": task.file_ids,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list")
async def list_simulate_tasks(current_user: dict = Depends(get_current_user)):
    """列出所有模拟任务"""
    tasks = simulate_service.list_tasks()
    return {
        "success": True,
        "data": {
            "tasks": [
                {
                    "taskId": t.task_id,
                    "currentStep": t.current_step,
                    "status": t.status,
                    "fileIds": t.file_ids,
                    "createdAt": t.created_at,
                }
                for t in tasks
            ]
        }
    }


@router.get("/{task_id}")
async def get_simulate_task(task_id: str, current_user: dict = Depends(get_current_user)):
    """获取任务状态"""
    task = simulate_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "success": True,
        "data": {
            "taskId": task.task_id,
            "currentStep": task.current_step,
            "status": task.status,
            "fileIds": task.file_ids,
            "params": task.params,
            "step1Result": task.step1_result,
            "step2Result": task.step2_result,
            "step3Result": task.step3_result,
            "step4Result": task.step4_result,
            "createdAt": task.created_at,
        }
    }


@router.delete("/{task_id}")
async def delete_simulate_task(task_id: str, current_user: dict = Depends(get_current_user)):
    """删除任务"""
    success = simulate_service.delete_task(task_id)
    return {"success": success}


@router.post("/{task_id}/step/1")
async def run_step1(task_id: str, current_user: dict = Depends(get_current_user)):
    """Step 1: PDF转换"""
    try:
        task = await simulate_service.run_step1(task_id)
        return {
            "success": True,
            "data": {
                "taskId": task.task_id,
                "currentStep": task.current_step,
                "status": task.status,
                "step1Result": task.step1_result,
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def stream_step2_generator(task_id: str, provider: str = "deepseek"):
    """Step 2 SSE generator"""
    async for event in simulate_service.run_step2_stream(task_id, provider):
        yield {"event": event.get("type", "message"), "data": json.dumps(event, ensure_ascii=False)}


@router.post("/{task_id}/step/2")
async def run_step2(task_id: str, request: StepRequest = None, current_user: dict = Depends(get_current_user)):
    """Step 2: 提取（SSE流式）"""
    try:
        provider = request.provider if request else "deepseek"
        return EventSourceResponse(stream_step2_generator(task_id, provider))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def stream_step3_generator(task_id: str, provider: str = "deepseek"):
    """Step 3 SSE generator"""
    async for event in simulate_service.run_step3_stream(task_id, provider):
        yield {"event": event.get("type", "message"), "data": json.dumps(event, ensure_ascii=False)}


@router.post("/{task_id}/step/3")
async def run_step3(task_id: str, request: StepRequest = None, current_user: dict = Depends(get_current_user)):
    """Step 3: 对比（SSE流式）"""
    try:
        provider = request.provider if request else "deepseek"
        return EventSourceResponse(stream_step3_generator(task_id, provider))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def stream_step4_generator(task_id: str, params: dict, provider: str = "deepseek"):
    """Step 4 SSE generator"""
    async for event in simulate_service.run_step4_stream(task_id, params, provider):
        yield {"event": event.get("type", "message"), "data": json.dumps(event, ensure_ascii=False)}


@router.post("/{task_id}/step/4")
async def run_step4(task_id: str, params: SimulateParams, current_user: dict = Depends(get_current_user)):
    """Step 4: 编制（SSE流式）"""
    try:
        return EventSourceResponse(
            stream_step4_generator(task_id, params.model_dump(), "deepseek")
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))