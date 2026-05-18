"""
数据管理 API 路由：统一的 CRUD 接口，覆盖文件/模拟/开标/提取四大模块。
当前使用内存 mock 数据，数据库连接后将切换为 Drizzle ORM。
所有端点强制认证，按 user_id 隔离数据。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional
from urllib.parse import quote

from app.infrastructure.mock_storage import (
    get_stats, list_files, get_file, delete_file,
    list_simulates, get_simulate, delete_simulate,
    list_openings, get_opening, delete_opening,
    list_extracts, get_extract, delete_extract,
)
from app.services.file_service import get_file_service
from app.utils.auth_dep import get_current_user

router = APIRouter(prefix="/data", tags=["data"])


# --- 统计概览 ---


@router.get("/stats")
async def api_get_stats(current_user: dict = Depends(get_current_user)):
    """获取各模块数据总数。"""
    return get_stats(user_id=current_user["id"])


# --- 文件管理 ---


@router.get("/files")
async def api_list_files(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    file_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """分页列出文件，可按类型筛选。"""
    return list_files(page, page_size, file_type, user_id=current_user["id"])


@router.get("/files/{file_id}")
async def api_get_file(file_id: str, current_user: dict = Depends(get_current_user)):
    """获取单个文件详情。"""
    record = get_file(file_id, user_id=current_user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    return {"file": record}


@router.delete("/files/{file_id}")
async def api_delete_file(file_id: str, current_user: dict = Depends(get_current_user)):
    """删除文件。"""
    deleted = delete_file(file_id, user_id=current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="File not found")
    return {"success": True}


@router.get("/files/{file_id}/download")
async def api_download_file(file_id: str, current_user: dict = Depends(get_current_user)):
    """下载原始文件（加密存储，解密后返回）。"""
    record = get_file(file_id, user_id=current_user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        file_service = get_file_service()
        content = await file_service.download(file_id)
        filename = record.get("original_name", file_id)
        encoded_filename = quote(filename)
        return StreamingResponse(
            iter([content]),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=\"{encoded_filename}\"; filename*=UTF-8''{encoded_filename}"
            }
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件不存在（演示数据无法下载，请上传真实文件）")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{file_id}/preview")
async def api_preview_file(file_id: str, current_user: dict = Depends(get_current_user)):
    """预览文件（inline 返回，浏览器直接渲染）。"""
    record = get_file(file_id, user_id=current_user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        file_service = get_file_service()
        content = await file_service.download(file_id)
        mime_map = {
            "pdf": "application/pdf",
            "word": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "csv": "text/csv",
            "markdown": "text/markdown",
        }
        mime_type = mime_map.get(record.get("type", ""), "application/octet-stream")
        filename = record.get("original_name", file_id)
        encoded_filename = quote(filename)
        return StreamingResponse(
            iter([content]),
            media_type=mime_type,
            headers={
                "Content-Disposition": f"inline; filename=\"{encoded_filename}\"; filename*=UTF-8''{encoded_filename}"
            }
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="文件不存在（演示数据无法预览，请上传真实文件）")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- 模拟任务 ---


@router.get("/simulates")
async def api_list_simulates(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """分页列出模拟任务，可按状态筛选。"""
    return list_simulates(page, page_size, status, user_id=current_user["id"])


@router.get("/simulates/{task_id}")
async def api_get_simulate(task_id: str, current_user: dict = Depends(get_current_user)):
    """获取模拟任务详情。"""
    record = get_simulate(task_id, user_id=current_user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": record}


@router.delete("/simulates/{task_id}")
async def api_delete_simulate(task_id: str, current_user: dict = Depends(get_current_user)):
    """删除模拟任务。"""
    deleted = delete_simulate(task_id, user_id=current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True}


# --- 开标结果 ---


@router.get("/openings")
async def api_list_openings(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """分页列出开标分析结果。"""
    return list_openings(page, page_size, user_id=current_user["id"])


@router.get("/openings/{task_id}")
async def api_get_opening(task_id: str, current_user: dict = Depends(get_current_user)):
    """获取开标结果详情。"""
    record = get_opening(task_id, user_id=current_user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="Result not found")
    return record


@router.delete("/openings/{task_id}")
async def api_delete_opening(task_id: str, current_user: dict = Depends(get_current_user)):
    """删除开标结果。"""
    deleted = delete_opening(task_id, user_id=current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Result not found")
    return {"success": True}


# --- 提取结果 ---


@router.get("/extracts")
async def api_list_extracts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """分页列出提取结果。"""
    return list_extracts(page, page_size, user_id=current_user["id"])


@router.get("/extracts/{result_id}")
async def api_get_extract(result_id: str, current_user: dict = Depends(get_current_user)):
    """获取提取结果详情。"""
    record = get_extract(result_id, user_id=current_user["id"])
    if not record:
        raise HTTPException(status_code=404, detail="Result not found")
    return record


@router.delete("/extracts/{result_id}")
async def api_delete_extract(result_id: str, current_user: dict = Depends(get_current_user)):
    """删除提取结果。"""
    deleted = delete_extract(result_id, user_id=current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Result not found")
    return {"success": True}
