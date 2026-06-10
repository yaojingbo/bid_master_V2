from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.infrastructure.llm.lite_llm import LiteLLMService
from app.services.extract_service import (
    _elements_from_plain_text,
    _normalize_elements,
    _parse_llm_json_response,
    extract_text_from_content,
)
from app.services.prompt_builder import get_prompt_builder


APP_NAME = "Bid Master CLI"
MAX_CHARS = 200000


class CliError(Exception):
    pass


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    try:
        asyncio.run(run_command(args))
    except CliError as error:
        print_error(str(error))
        raise SystemExit(1) from error
    except KeyboardInterrupt:
        print("\n已取消")
        raise SystemExit(130)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bidmaster",
        description="招投标智能分析工具箱",
    )
    parser.add_argument("-v", "--version", action="version", version="Bid Master CLI 1.0.0")

    subparsers = parser.add_subparsers(dest="command")

    extract_parser = subparsers.add_parser("extract", help="提取招标文件关键内容")
    add_file_options(extract_parser)
    extract_parser.add_argument("-f", "--format", choices=["md", "json"], default="md", help="输出格式，默认 md")
    extract_parser.add_argument("--provider", default=None, help="AI 供应商，默认读取 AI_PROVIDER")
    extract_parser.add_argument("--model", default=None, help="模型名称")

    analyze_parser = subparsers.add_parser("analyze", help="生成招标文件分析报告")
    add_file_options(analyze_parser)
    analyze_parser.add_argument("--provider", default=None, help="AI 供应商，默认读取 AI_PROVIDER")
    analyze_parser.add_argument("--model", default=None, help="模型名称")

    quote_parser = subparsers.add_parser("quote", help="分析开标报价文件")
    add_file_options(quote_parser)
    quote_parser.add_argument("-f", "--format", choices=["md", "json"], default="md", help="输出格式，默认 md")
    quote_parser.add_argument("--modules", default=None, help="分析模块，多个模块用英文逗号分隔")

    return parser


def add_file_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("file", help="输入文件路径")
    parser.add_argument("-o", "--out", default=None, help="输出文件路径")


async def run_command(args: argparse.Namespace) -> None:
    if args.command == "extract":
        await run_extract(args)
    elif args.command == "analyze":
        await run_analyze(args)
    elif args.command == "quote":
        run_quote(args)
    else:
        raise CliError(f"未知命令：{args.command}")


async def run_extract(args: argparse.Namespace) -> None:
    input_path = resolve_input_file(args.file)
    output_path = resolve_output_file(args.out, input_path, "summary", args.format)
    provider = resolve_provider(args.provider)

    print_header(input_path, "招标文件关键内容提取", output_path)
    print_step(1, 4, "正在读取文件...")
    content = input_path.read_bytes()

    print_step(2, 4, "正在解析招标文件内容...")
    text_content = extract_document_text(content)

    print_step(3, 4, "正在提取项目关键信息...")
    elements = await extract_elements(text_content, provider, args.model)

    print_step(4, 4, "正在写入结果文件...")
    if args.format == "json":
        output = json.dumps({"elements": elements}, ensure_ascii=False, indent=2)
    else:
        output = render_extract_markdown(input_path, elements)
    write_output(output_path, output)

    print("\n提取完成\n")
    print_extract_summary(elements)
    print(f"\n结果已保存：{output_path}")


async def run_analyze(args: argparse.Namespace) -> None:
    input_path = resolve_input_file(args.file)
    output_path = resolve_output_file(args.out, input_path, "analysis", "md")
    provider = resolve_provider(args.provider)

    print_header(input_path, "招标文件智能分析", output_path)
    print_step(1, 5, "正在读取文件...")
    content = input_path.read_bytes()

    print_step(2, 5, "正在解析文档结构...")
    text_content = extract_document_text(content)

    print_step(3, 5, "正在提取评分规则与资格条件...")
    truncated = truncate_text(text_content)

    print_step(4, 5, "正在识别投标风险...")
    report = await analyze_document(truncated, provider, args.model)

    print_step(5, 5, "正在生成分析报告...")
    write_output(output_path, report)

    print("\n分析完成\n")
    print_analysis_summary(report)
    print(f"\n结果已保存：{output_path}")


def run_quote(args: argparse.Namespace) -> None:
    from app.api.statistics import compute_all_dimensions, parse_opening_excel, _fallback_opening_analysis

    input_path = resolve_input_file(args.file)
    output_format = args.format
    output_path = resolve_output_file(args.out, input_path, "quote-report", output_format)
    modules = [item.strip() for item in args.modules.split(",") if item.strip()] if args.modules else None

    print_header(input_path, "开标报价分析", output_path)
    print_step(1, 4, "正在读取报价文件...")
    content = input_path.read_bytes()

    print_step(2, 4, "正在识别供应商报价...")
    try:
        parsed = parse_opening_excel(content, input_path.name)
    except ValueError as error:
        raise CliError(str(error)) from error
    except Exception as error:
        raise CliError(f"无法解析报价文件，请确认表格包含投标人和报价列：{error}") from error

    print_step(3, 4, "正在计算报价区间...")
    result = compute_all_dimensions(parsed["bidders"], parsed["meta"], modules)

    print_step(4, 4, "正在生成报价分析报告...")
    if output_format == "json":
        output = json.dumps(result, ensure_ascii=False, indent=2)
    else:
        output = _fallback_opening_analysis(result)
    write_output(output_path, output)

    print("\n分析完成\n")
    print_quote_summary(result)
    print(f"\n结果已保存：{output_path}")


def resolve_input_file(file_path: str) -> Path:
    path = Path(file_path).expanduser().resolve()
    if not path.exists():
        raise CliError(f"无法读取文件 {file_path}\n\n可能原因：\n- 文件路径不存在\n- 当前目录不是文件所在目录\n\n你可以尝试：\n  bidmaster extract ./docs/tender.pdf --out tender-summary.md")
    if not path.is_file():
        raise CliError(f"输入路径不是文件：{file_path}")
    return path


def resolve_output_file(out: str | None, input_path: Path, suffix: str, output_format: str) -> Path:
    if out:
        return Path(out).expanduser().resolve()
    return input_path.with_name(f"{input_path.stem}-{suffix}.{output_format}").resolve()


def resolve_provider(provider: str | None) -> str:
    return provider or get_settings().ai_provider or "deepseek"


def extract_document_text(content: bytes) -> str:
    text_content, needs_ocr = extract_text_from_content(content)
    if needs_ocr:
        raise CliError("当前文件疑似扫描件 PDF，第一版 CLI 暂不支持本地 OCR。请先使用 Web 端 OCR，或上传可复制文本的 PDF/DOCX 文件。")
    if not text_content.strip():
        raise CliError("文档内容为空或无法解析，请确认文件格式为 PDF、DOCX、XLSX、CSV、Markdown 或 TXT。")
    return text_content


def truncate_text(text: str) -> str:
    if len(text) <= MAX_CHARS:
        return text
    return text[:MAX_CHARS] + f"\n\n[文档已截断，共 {len(text)} 字符]"


async def extract_elements(text_content: str, provider: str, model: str | None) -> list[dict[str, Any]]:
    builder = get_prompt_builder()
    messages = [
        {"role": "system", "content": builder.build_extract_system_prompt("brief")},
        {"role": "user", "content": builder.build_extract_user_prompt(truncate_text(text_content)) + "\n\n请只输出 JSON，不要输出 Markdown 代码块、解释文字或额外前后缀。"},
    ]
    response = await complete_text(provider, messages, model)
    try:
        _, elements = _parse_llm_json_response(response)
        return _normalize_elements(elements, response)
    except json.JSONDecodeError:
        return _elements_from_plain_text(response)


async def analyze_document(text_content: str, provider: str, model: str | None) -> str:
    messages = [
        {
            "role": "system",
            "content": "你是招投标文件分析专家。请输出面向招投标从业人员的 Markdown 报告，重点说明项目关键信息、资格条件、评分重点、投标风险和响应建议。",
        },
        {
            "role": "user",
            "content": f"请分析以下招标文件内容，并生成可直接保存的 Markdown 报告。\n\n---\n\n# 招标文件内容\n\n{text_content}",
        },
    ]
    report = await complete_text(provider, messages, model)
    if not report.strip():
        raise CliError("AI 未返回分析内容，请检查模型配置后重试。")
    return report.strip() + "\n"


async def complete_text(provider: str, messages: list[dict[str, str]], model: str | None) -> str:
    service = LiteLLMService()
    chunks: list[str] = []
    try:
        async for chunk in service.complete(provider, messages, model=model, stream=True):
            chunks.append(chunk)
    except Exception as error:
        raise CliError(f"AI 分析失败：{error}\n\n你可以尝试：\n  1. 在 .env.local 或 src/backend/.env 中配置对应供应商 API Key\n  2. 使用 --provider 指定可用供应商\n  3. 本地演示时设置 DEMO_MODE=true") from error
    return "".join(chunks).strip()


def render_extract_markdown(input_path: Path, elements: list[dict[str, Any]]) -> str:
    lines = [
        f"# {input_path.stem} 关键内容提取",
        "",
        f"- 来源文件：{input_path.name}",
        f"- 提取要素：{len(elements)} 项",
        "",
    ]
    for element in elements:
        name = str(element.get("name") or "分析结果").strip()
        content = str(element.get("content") or "未识别").strip()
        lines.extend([f"## {name}", "", content, ""])
    return "\n".join(lines).rstrip() + "\n"


def write_output(output_path: Path, content: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")


def print_header(input_path: Path, task_type: str, output_path: Path) -> None:
    print(APP_NAME)
    print()
    print(f"输入文件：{input_path}")
    print(f"任务类型：{task_type}")
    print(f"输出文件：{output_path}")
    print()


def print_step(current: int, total: int, message: str) -> None:
    print(f"[{current}/{total}] {message}")


def print_extract_summary(elements: list[dict[str, Any]]) -> None:
    for element in elements[:6]:
        name = str(element.get("name") or "分析结果").strip()
        content = " ".join(str(element.get("content") or "").split())
        preview = content[:80] + ("..." if len(content) > 80 else "")
        print(f"{name}：{preview or '未识别'}")


def print_analysis_summary(report: str) -> None:
    lines = [line.strip("- ").strip() for line in report.splitlines() if line.strip().startswith("-")]
    if not lines:
        print("报告已生成，可打开 Markdown 文件查看完整内容。")
        return
    print("核心结论：")
    for line in lines[:4]:
        print(f"- {line}")


def print_quote_summary(result: dict[str, Any]) -> None:
    stats = result.get("bid_stats") or {}
    ranking = result.get("bid_ranking") or []
    print(f"供应商数量：{result.get('bidder_count', 0)}")
    if stats:
        print(f"最低报价：{stats.get('min', '未识别')}")
        print(f"最高报价：{stats.get('max', '未识别')}")
        print(f"平均报价：{stats.get('mean', '未识别')}")
    if ranking:
        print("\n报价排名：")
        for item in ranking[:3]:
            print(f"{item.get('rank')}. {item.get('name')}    {item.get('price')}")


def print_error(message: str) -> None:
    print(f"错误：{message}")


if __name__ == "__main__":
    main()
