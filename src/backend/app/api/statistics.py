from __future__ import annotations
"""
Opening/statistics analysis API routes with comprehensive 6-dimension analysis.
所有端点强制认证。
"""
import io
import json
import logging
import sys
import traceback
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sse_starlette.sse import EventSourceResponse

from app.services.statistics_service import StatisticsService
from app.services.llm_service import LLMService
from app.models.schemas import OpeningAnalysisRequest
from app.utils.auth_dep import get_current_user
from app.infrastructure.mock_storage import add_opening

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/statistics", tags=["statistics"])


def _extract_number(text: str):
    """从文本中提取第一个数字。"""
    import re
    m = re.search(r"(\d+\.?\d*)", str(text).strip())
    return float(m.group(1)) if m else None


def _extract_final_price(text: str):
    """从备注中提取最终报价。"""
    import re
    patterns = [
        r"最终报价[：:]*\s*(\d+\.?\d*)\s*万元",
        r"最终报价[：:]*\s*(\d+\.?\d*)",
        r"二次报价[：:]*\s*(\d+\.?\d*)\s*万元",
    ]
    for pat in patterns:
        m = re.search(pat, str(text))
        if m:
            return float(m.group(1))
    return None


def parse_opening_excel(content: bytes, filename: str) -> dict:
    """
    解析开标一览表 Excel/CSV 文件。

    使用 header=None 将全部行作为数据处理，手动查找表头行，
    兼容表头行不在第一行的招标表格格式。
    """
    import re

    if filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content), header=None, encoding="utf-8")
    elif filename.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content), header=None)
    else:
        raise ValueError("不支持的文件格式，请使用 Excel 或 CSV")

    # 全部转为字符串
    df = df.fillna("").astype(str)

    # =========================================================================
    # 1. 提取项目元数据
    # =========================================================================
    meta = {
        "project_name": "",
        "bid_number": "",
        "opening_time": "",
        "opening_location": "",
        "max_price": None,
        "benchmark_price": None,
        "d_value": None,
    }

    # 搜索前 5 行找项目名称和招标编号
    for idx in range(min(5, len(df))):
        for cell in df.iloc[idx]:
            cell = str(cell).strip()
            if not cell:
                continue
            m = re.match(r"项目名称[：:]\s*(.+)", cell)
            if m:
                meta["project_name"] = m.group(1).strip()
            elif not meta["project_name"] and idx == 0 and not any(
                kw in cell for kw in ["序号", "投标", "报价", "标段", "开标", "评标"]
            ):
                meta["project_name"] = cell

            m2 = re.search(r"(?:招标|项目)编号[：:]\s*(\S+)", cell)
            if m2:
                meta["bid_number"] = m2.group(1).strip()

    # 搜索最后 10 行找限价/基准价/D值
    for idx in range(max(0, len(df) - 10), len(df)):
        row = df.iloc[idx]
        for col_idx, cell in enumerate(row):
            cell = str(cell).strip()
            if "最高投标限价" in cell or "最高限价" in cell:
                for j in range(col_idx + 1, len(row)):
                    val = _extract_number(str(row.iloc[j]).strip())
                    if val is not None:
                        meta["max_price"] = val
                        break
            elif "评标基准价" in cell or "基准价" in cell:
                for j in range(col_idx + 1, len(row)):
                    val = _extract_number(str(row.iloc[j]).strip())
                    if val is not None:
                        meta["benchmark_price"] = val
                        break
            elif cell in ("D值",) or cell.startswith("D值"):
                for j in range(col_idx + 1, len(row)):
                    val = _extract_number(str(row.iloc[j]).strip())
                    if val is not None:
                        meta["d_value"] = val
                        break

    # =========================================================================
    # 2. 查找表头行和列映射
    # =========================================================================
    header_row = None
    col_map = {}
    raw_headers = []
    column_mapping = {}

    for idx, row in df.iterrows():
        row_text = " ".join(str(c) for c in row.values)
        has_bidder_kw = any(kw in row_text for kw in ["投标人", "投标单位", "单位名称"])
        has_price_kw = any(kw in row_text for kw in ["报价", "投标价"])
        if has_bidder_kw and has_price_kw:
            header_row = idx
            for col_idx, cell in enumerate(row):
                cell = str(cell).strip()
                if not cell or cell == "nan":
                    continue
                raw_headers.append(cell)
                if any(kw in cell for kw in ["投标人", "投标单位", "单位名称"]):
                    col_map["name"] = col_idx
                    column_mapping[cell] = "name"
                elif any(kw in cell for kw in ["制造商", "产地", "品牌"]):
                    col_map["manufacturer"] = col_idx
                    column_mapping[cell] = "manufacturer"
                elif any(kw in cell for kw in ["投标价", "投标报价", "首次报价"]) and "最终" not in cell:
                    col_map["bid_price"] = col_idx
                    column_mapping[cell] = "bid_price"
                elif "资信" in cell:
                    col_map["credit_score"] = col_idx
                    column_mapping[cell] = "credit_score"
                elif "技术标" in cell or "技术分" in cell:
                    col_map["technical_score"] = col_idx
                    column_mapping[cell] = "technical_score"
                elif "商务标" in cell or "商务分" in cell:
                    col_map["commercial_score"] = col_idx
                    column_mapping[cell] = "commercial_score"
                elif cell == "合计" or "总得分" in cell or "综合评分" in cell:
                    col_map["total_score"] = col_idx
                    column_mapping[cell] = "total_score"
                elif "备注" in cell:
                    col_map["remarks"] = col_idx
                    column_mapping[cell] = "remarks"
            # Fallback: 如果没找到 bid_price，找任意包含"报价"的列
            if "bid_price" not in col_map:
                for col_idx, cell in enumerate(row):
                    cell = str(cell).strip()
                    if "报价" in cell and "比较" not in cell and "方式" not in cell:
                        col_map["bid_price"] = col_idx
                        if cell not in column_mapping:
                            column_mapping[cell] = "bid_price"
                        break
            break

    # =========================================================================
    # 3. 提取投标人数据
    # =========================================================================
    bidders = []

    if header_row is not None:
        for idx in range(header_row + 1, len(df)):
            row = df.iloc[idx]
            name = str(row.iloc[col_map.get("name", 0)]).strip()
            if not name or name == "nan" or name.startswith("合计") or name.startswith("小计"):
                continue
            # 跳过汇总行
            row_text = " ".join(str(c) for c in row)
            if any(kw in row_text for kw in ["最高投标限价", "评标基准价", "D值"]):
                continue

            bid_price_str = str(row.iloc[col_map.get("bid_price", 1)]).strip()
            bid_price = _extract_number(bid_price_str)

            remarks = str(row.iloc[col_map.get("remarks", len(row) - 1)]).strip()
            final_price = _extract_final_price(remarks)

            bidder = {
                "name": name,
                "manufacturer": str(row.iloc[col_map.get("manufacturer", 1)]).strip() if "manufacturer" in col_map else "",
                "bid_price": bid_price,
                "final_price": final_price,
                "credit_score": _extract_number(str(row.iloc[col_map["credit_score"]]).strip()) if "credit_score" in col_map else 0,
                "technical_score": _extract_number(str(row.iloc[col_map["technical_score"]]).strip()) if "technical_score" in col_map else 0,
                "commercial_score": _extract_number(str(row.iloc[col_map["commercial_score"]]).strip()) if "commercial_score" in col_map else 0,
                "total_score": _extract_number(str(row.iloc[col_map["total_score"]]).strip()) if "total_score" in col_map else 0,
                "remarks": remarks,
            }
            bidders.append(bidder)

    # 转换为 records 格式（兼容旧版 compute_all_dimensions）
    records = []
    for b in bidders:
        records.append({k: v for k, v in b.items()})

    return {
        "meta": meta,
        "bidders": bidders,
        "records": records,
        "columns": list(col_map.keys()) if col_map else [],
        "raw_headers": raw_headers,
        "column_mapping": column_mapping,
        "row_count": len(bidders),
    }


ALL_MODULES = {"bid_ranking", "final_ranking", "discount", "statistics", "scores", "benchmark"}


def compute_all_dimensions(bidders: list, meta: dict, modules: list[str] = None) -> dict:
    """
    Compute all 6 analysis dimensions from bidder data.

    Args:
        bidders: List of bidder dicts
        meta: Metadata dict
        modules: Optional list of module keys to compute (None = all)

    Returns:
        Dict with all dimension results
    """
    # 过滤掉前端传入的非后端模块（如 "comprehensive"）
    if modules:
        active_modules = [m for m in modules if m in ALL_MODULES]
        if not active_modules:
            active_modules = list(ALL_MODULES)
    else:
        active_modules = list(ALL_MODULES)

    result = {
        "bidder_count": len(bidders),
        "meta": meta,
        "requested_modules": active_modules,
    }

    try:
        _compute_dimensions(bidders, meta, active_modules, result)
    except Exception as e:
        logger.error("compute_all_dimensions 异常: %s", traceback.format_exc())
        print(f"[BID_MASTER_ERROR] compute_all_dimensions 失败: {traceback.format_exc()}", file=sys.stderr)
        # 重新抛出，让路由层的 except 捕获后返回 HTTP 500
        raise

    return result


def _compute_dimensions(bidders: list, meta: dict, active_modules: list, result: dict):
    """compute_all_dimensions 的实际计算逻辑，分离以便于错误追踪。"""
    bid_prices = [b["bid_price"] for b in bidders if b.get("bid_price") is not None and b["bid_price"] > 0]

    # Module A: 投标价排名
    if "bid_ranking" in active_modules and bid_prices:
        sorted_bidders = sorted(
            [b for b in bidders if b.get("bid_price") is not None and b["bid_price"] > 0],
            key=lambda b: b["bid_price"],
        )
        avg_price = sum(bid_prices) / len(bid_prices)
        min_price = min(bid_prices)

        result["bid_ranking"] = [
            {
                "rank": i + 1,
                "name": b["name"],
                "price": b["bid_price"],
                "deviation_pct": round((b["bid_price"] - avg_price) / avg_price * 100, 2),
                "gap_from_lowest": round(b["bid_price"] - min_price, 2),
            }
            for i, b in enumerate(sorted_bidders)
        ]

    # Module B: 最终报价排名
    if "final_ranking" in active_modules:
        bidders_with_final = [b for b in bidders if b.get("final_price") is not None]
        if bidders_with_final:
            sorted_final = sorted(bidders_with_final, key=lambda b: b["final_price"])
            avg_final = sum(b["final_price"] for b in bidders_with_final) / len(bidders_with_final)
            min_final = min(b["final_price"] for b in bidders_with_final)

            result["final_ranking"] = [
                {
                    "rank": i + 1,
                    "name": b["name"],
                    "price": b["final_price"],
                    "deviation_pct": round((b["final_price"] - avg_final) / avg_final * 100, 2),
                    "gap_from_lowest": round(b["final_price"] - min_final, 2),
                }
                for i, b in enumerate(sorted_final)
            ]
        else:
            result["final_ranking"] = None

    # Module C: 降价分析
    if "discount" in active_modules and bid_prices:
        discount_results = []
        for b in bidders:
            if b.get("final_price") is not None and b.get("bid_price") and b["bid_price"] > 0:
                discount_amount = round(b["bid_price"] - b["final_price"], 2)
                discount_pct = round(discount_amount / b["bid_price"] * 100, 2)

                # Classify strategy
                if discount_pct > 8:
                    strategy = "激进"
                elif discount_pct >= 4:
                    strategy = "适度"
                else:
                    strategy = "保守"

                discount_results.append({
                    "name": b["name"],
                    "bid_price": b["bid_price"],
                    "final_price": b["final_price"],
                    "discount_amount": discount_amount,
                    "discount_pct": discount_pct,
                    "strategy": strategy,
                })
        result["discount_results"] = discount_results

    # Module D: 统计分析
    if "statistics" in active_modules and bid_prices:
        n = len(bid_prices)
        avg = sum(bid_prices) / n
        variance = sum((p - avg) ** 2 for p in bid_prices) / n
        std_dev = variance ** 0.5
        cv = round(std_dev / avg * 100, 2) if avg > 0 else 0
        cv_level = "集中" if cv < 5 else "中等" if cv < 10 else "分散"

        result["bid_stats"] = {
            "max": max(bid_prices),
            "min": min(bid_prices),
            "mean": round(avg, 2),
            "std_dev": round(std_dev, 2),
            "cv": cv,
            "cv_level": cv_level,
            "range": round(max(bid_prices) - min(bid_prices), 2),
            "count": n,
        }

        # Tiers
        tiers = {"低梯队": [], "中梯队": [], "高梯队": []}
        for b in bidders:
            if b.get("bid_price") and b["bid_price"] > 0:
                deviation_pct = (b["bid_price"] - avg) / avg * 100
                tier_name = "低梯队" if deviation_pct <= -5 else "高梯队" if deviation_pct > 5 else "中梯队"
                tiers[tier_name].append({
                    "name": b["name"],
                    "price": b["bid_price"],
                    "deviation_pct": round(deviation_pct, 2),
                })
        result["tiers"] = tiers

        # Final stats if available
        final_prices = [b["final_price"] for b in bidders if b.get("final_price") is not None]
        if final_prices:
            n_f = len(final_prices)
            avg_f = sum(final_prices) / n_f
            var_f = sum((p - avg_f) ** 2 for p in final_prices) / n_f
            std_f = var_f ** 0.5
            cv_f = round(std_f / avg_f * 100, 2) if avg_f > 0 else 0
            cv_level_f = "集中" if cv_f < 5 else "中等" if cv_f < 10 else "分散"

            result["final_stats"] = {
                "max": max(final_prices),
                "min": min(final_prices),
                "mean": round(avg_f, 2),
                "std_dev": round(std_f, 2),
                "cv": cv_f,
                "cv_level": cv_level_f,
                "range": round(max(final_prices) - min(final_prices), 2),
                "count": n_f,
            }

    # Module E: 评分对比
    if "scores" in active_modules:
        scored_bidders = [b for b in bidders if (b.get("total_score") or 0) > 0]
        if scored_bidders:
            sorted_scores = sorted(scored_bidders, key=lambda b: b["total_score"], reverse=True)
            result["score_ranking"] = [
                {
                    "rank": i + 1,
                    "name": b["name"],
                    "credit_score": b.get("credit_score", 0),
                    "technical_score": b.get("technical_score", 0),
                    "commercial_score": b.get("commercial_score", 0),
                    "total_score": b.get("total_score", 0),
                }
                for i, b in enumerate(sorted_scores)
            ]
        else:
            result["score_ranking"] = []

    # Module F: 基准价对比
    if "benchmark" in active_modules and meta.get("benchmark_price") is not None and bid_prices:
        benchmark = meta["benchmark_price"]
        max_price = meta.get("max_price")
        benchmark_results = []

        for b in bidders:
            if b.get("bid_price") and b["bid_price"] > 0:
                deviation = round(b["bid_price"] - benchmark, 2)
                deviation_pct = round(deviation / benchmark * 100, 2)
                below_benchmark = b["bid_price"] <= benchmark

                entry = {
                    "name": b["name"],
                    "price": b["bid_price"],
                    "deviation_from_benchmark": deviation,
                    "deviation_pct": deviation_pct,
                    "below_benchmark": below_benchmark,
                    "total_score": b.get("total_score", 0),
                }

                if max_price:
                    entry["max_price"] = max_price
                    entry["ratio_to_max_pct"] = round(b["bid_price"] / max_price * 100, 2)
                    entry["below_max"] = b["bid_price"] <= max_price

                benchmark_results.append(entry)

        result["benchmark_comparison"] = sorted(
            benchmark_results,
            key=lambda x: abs(x.get("deviation_pct", 0)),
        )
    else:
        result["benchmark_comparison"] = None


def get_available_modules(columns: list[str], meta: dict) -> list[dict]:
    """根据检测到的列和元数据，返回可用的分析维度列表。"""
    has_bid_price = "bid_price" in columns
    has_final = any(c in columns for c in ["final_price", "remarks"])
    has_scores = any(c in columns for c in ["credit_score", "technical_score", "commercial_score", "total_score"])
    has_benchmark = meta.get("benchmark_price") is not None

    modules = [
        {
            "key": "bid_ranking",
            "label": "投标价排名",
            "available": has_bid_price,
            "description": "按投标价从低到高排序，计算偏离均值比例" if has_bid_price else "表格中未检测到投标价数据",
        },
        {
            "key": "final_ranking",
            "label": "最终报价排名",
            "available": has_final,
            "description": "按最终报价从低到高排序" if has_final else "表格中未检测到备注/最终报价数据",
        },
        {
            "key": "discount",
            "label": "降价分析",
            "available": has_bid_price and has_final,
            "description": "投标价 vs 最终报价降价幅度与策略分类" if (has_bid_price and has_final) else "需要投标价和最终报价数据",
        },
        {
            "key": "statistics",
            "label": "统计分析",
            "available": has_bid_price,
            "description": "均值/标准差/离散系数/梯队分布" if has_bid_price else "表格中未检测到投标价数据",
        },
        {
            "key": "scores",
            "label": "评分对比",
            "available": has_scores,
            "description": "资信/技术/商务/综合评分排名对比" if has_scores else "表格中未检测到评分数据（资信/技术/商务/合计）",
        },
        {
            "key": "benchmark",
            "label": "基准价对比",
            "available": has_benchmark,
            "description": "各投标报价与评标基准价的偏离分析" if has_benchmark else "表格中未检测到评标基准价数据",
        },
        {
            "key": "comprehensive",
            "label": "综合分析 (AI)",
            "available": True,
            "description": "AI 对分析结果进行综合解读与策略建议",
        },
    ]
    return modules


@router.post("/parse")
async def parse_statistics_data(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """解析 Excel/CSV 开标数据，返回检测到的列和可用分析维度。"""
    try:
        content = await file.read()
        parsed = parse_opening_excel(content, file.filename)
        available_modules = get_available_modules(parsed.get("columns", []), parsed.get("meta", {}))
        return {
            "success": True,
            "data": {
                **parsed,
                "available_modules": available_modules,
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze")
async def analyze_opening(request: OpeningAnalysisRequest, current_user: dict = Depends(get_current_user)):
    """
    Comprehensive 6-dimension opening analysis.
    """
    if not request.fileId:
        raise HTTPException(status_code=400, detail="缺少 fileId 参数")

    try:
        from app.services.file_service import get_file_service
        file_service = get_file_service()

        content = await file_service.download(request.fileId)

        # Parse filename from mock storage or use generic
        filename = "bid_opening.xlsx"
        # Try to detect format from content
        try:
            import io
            df = pd.read_excel(io.BytesIO(content))
            filename = "bid_opening.xlsx"
        except Exception:
            try:
                df = pd.read_csv(io.BytesIO(content))
                filename = "bid_opening.csv"
            except Exception:
                filename = "bid_opening.xlsx"

        parsed = parse_opening_excel(content, filename)
        modules = request.modules or None
        result = compute_all_dimensions(parsed["bidders"], parsed["meta"], modules)

        # 保存开标结果到 mock_storage
        add_opening({
            "file_id": request.fileId,
            "bidder_count": result.get("bidder_count", parsed.get("bidder_count", 0)),
            "bid_ranking": result.get("bid_ranking", []),
            "bid_stats": result.get("bid_stats", {}),
            "meta": result.get("meta", parsed.get("meta", {})),
            "status": "completed",
        }, user_id=current_user["id"])

        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze/upload")
async def analyze_opening_upload(
    file: UploadFile = File(...),
    modules: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload file and analyze directly (combined upload + analyze).
    """
    try:
        content = await file.read()
        parsed = parse_opening_excel(content, file.filename)

        module_list = json.loads(modules) if modules else None
        result = compute_all_dimensions(parsed["bidders"], parsed["meta"], module_list)

        # 保存开标结果到 mock_storage
        add_opening({
            "file_id": None,
            "bidder_count": result.get("bidder_count", parsed.get("bidder_count", 0)),
            "bid_ranking": result.get("bid_ranking", []),
            "bid_stats": result.get("bid_stats", {}),
            "meta": result.get("meta", parsed.get("meta", {})),
            "status": "completed",
        }, user_id=current_user["id"])

        return {"success": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def comprehensive_analysis_generator(
    analysis_data: dict,
    provider: str = "deepseek",
    user_id: str = None,
):
    """
    SSE generator for AI comprehensive analysis of opening results.

    LLM 调用解耦到后台 asyncio Task，前端断连不会中断 LLM 调用。
    """
    import asyncio

    llm_service = LLMService()

    yield {
        "event": "progress",
        "data": json.dumps({"type": "progress", "message": "AI 正在生成综合分析..."}),
    }

    # Build analysis prompt
    summary = f"""请对以下开标分析结果进行综合分析，给出专业建议：

投标单位数量: {analysis_data.get('bidder_count', 0)}
项目名称: {analysis_data.get('meta', {}).get('project_name', '未知')}

投标价排名: {json.dumps(analysis_data.get('bid_ranking', []), ensure_ascii=False)}
降价分析: {json.dumps(analysis_data.get('discount_results', []), ensure_ascii=False)}
统计分析: {json.dumps(analysis_data.get('bid_stats', {}), ensure_ascii=False)}
评分对比: {json.dumps(analysis_data.get('score_ranking', []), ensure_ascii=False)}
基准价对比: {json.dumps(analysis_data.get('benchmark_comparison', []), ensure_ascii=False)}

请从以下角度分析：
1. 竞争态势总体评价
2. 价格策略建议
3. 评分趋势分析
4. 中标可能性预测"""

    messages = [
        {"role": "system", "content": "你是一个专业的招投标分析顾问，请基于数据给出客观、专业的分析建议。"},
        {"role": "user", "content": summary},
    ]

    chunk_queue: asyncio.Queue = asyncio.Queue()
    result_holder = {"text": "", "done": False, "error": None}

    async def _llm_background_task():
        """后台运行 LLM 调用，将 chunks 推入 Queue。"""
        try:
            async for chunk in llm_service.llm.complete(provider, messages, stream=True):
                result_holder["text"] += chunk
                await chunk_queue.put({"type": "chunk", "content": chunk})
            result_holder["done"] = True
            await chunk_queue.put({"type": "llm_done"})
        except Exception as e:
            result_holder["error"] = str(e)
            await chunk_queue.put({"type": "llm_error", "error": str(e)})

    background_task = asyncio.create_task(_llm_background_task())

    _saved = False

    try:
        while True:
            event = await chunk_queue.get()
            if event["type"] == "chunk":
                yield {
                    "event": "message",
                    "data": json.dumps({"type": "content", "content": event["content"]}),
                }
            elif event["type"] == "llm_done":
                # LLM 完成，保存完整结果
                full_response = result_holder["text"]
                add_opening({
                    "file_id": analysis_data.get("file_id"),
                    "bidder_count": analysis_data.get("bidder_count", 0),
                    "bid_ranking": analysis_data.get("bid_ranking", []),
                    "bid_stats": analysis_data.get("bid_stats", {}),
                    "meta": analysis_data.get("meta", {}),
                    "ai_analysis": full_response,
                    "status": "completed_disconnected",
                }, user_id=user_id)
                _saved = True

                yield {
                    "event": "done",
                    "data": json.dumps({
                        "type": "done",
                        "data": {"summary": "AI 综合分析完成", "contentLength": len(full_response)},
                    }),
                }
                break
            elif event["type"] == "llm_error":
                yield {
                    "event": "error",
                    "data": json.dumps({"type": "error", "message": event["error"]}),
                }
                break

    finally:
        if not _saved:
            if result_holder["done"]:
                # LLM 完成但 SSE 在保存结果前断开
                add_opening({
                    "file_id": analysis_data.get("file_id"),
                    "bidder_count": analysis_data.get("bidder_count", 0),
                    "bid_ranking": analysis_data.get("bid_ranking", []),
                    "bid_stats": analysis_data.get("bid_stats", {}),
                    "meta": analysis_data.get("meta", {}),
                    "ai_analysis": result_holder["text"],
                    "status": "completed_background",
                }, user_id=user_id)
            elif result_holder["text"]:
                # LLM 还在运行，保存已有部分，等后台 Task 完成后再补全
                add_opening({
                    "file_id": analysis_data.get("file_id"),
                    "bidder_count": analysis_data.get("bidder_count", 0),
                    "bid_ranking": analysis_data.get("bid_ranking", []),
                    "bid_stats": analysis_data.get("bid_stats", {}),
                    "meta": analysis_data.get("meta", {}),
                    "ai_analysis": result_holder["text"],
                    "status": "partial",
                }, user_id=user_id)

                async def _ensure_save_on_completion():
                    await background_task
                    if result_holder["done"] and not _saved:
                        add_opening({
                            "file_id": analysis_data.get("file_id"),
                            "bidder_count": analysis_data.get("bidder_count", 0),
                            "bid_ranking": analysis_data.get("bid_ranking", []),
                            "bid_stats": analysis_data.get("bid_stats", {}),
                            "meta": analysis_data.get("meta", {}),
                            "ai_analysis": result_holder["text"],
                            "status": "completed_background",
                        }, user_id=user_id)

                asyncio.create_task(_ensure_save_on_completion())


@router.post("/analyze/comprehensive")
async def analyze_comprehensive(request: OpeningAnalysisRequest, current_user: dict = Depends(get_current_user)):
    """
    AI comprehensive analysis with SSE streaming.

    First runs 6-dimension analysis, then streams AI comprehensive interpretation.
    """
    try:
        from app.services.file_service import get_file_service
        file_service = get_file_service()

        content = await file_service.download(request.fileId)
        filename = "bid_opening.xlsx"

        parsed = parse_opening_excel(content, filename)
        modules = request.modules or None
        analysis_data = compute_all_dimensions(parsed["bidders"], parsed["meta"], modules)

        return EventSourceResponse(
            comprehensive_analysis_generator(analysis_data, request.provider or "deepseek", user_id=current_user["id"]),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze/comprehensive/upload")
async def analyze_comprehensive_upload(
    file: UploadFile = File(...),
    modules: Optional[str] = Form(None),
    provider: Optional[str] = Form("deepseek"),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload file + analyze + AI comprehensive SSE streaming (all-in-one).
    """
    try:
        content = await file.read()
        parsed = parse_opening_excel(content, file.filename)

        module_list = json.loads(modules) if modules else None
        analysis_data = compute_all_dimensions(parsed["bidders"], parsed["meta"], module_list)

        return EventSourceResponse(
            comprehensive_analysis_generator(analysis_data, provider or "deepseek", user_id=current_user["id"]),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/{analysis_id}")
async def export_report(analysis_id: str, current_user: dict = Depends(get_current_user)):
    """Export analysis report (placeholder)."""
    return {
        "success": True,
        "data": {"analysisId": analysis_id, "format": "json"},
    }