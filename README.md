# Bid Master Web — 招投标智能分析工具箱

面向招投标全流程的智能分析 Web 应用，覆盖招标文件要素提取、招标文件模拟编制、开标报价分析三大核心场景，内置多 AI 模型支持与流式交互。

## 功能概览

| 模块 | 说明 |
|------|------|
| **要素提取** | 从 PDF/Markdown 招标文件中提取资质要求、评标办法、业绩门槛、定标方法、合同条款五大要素，支持单文件提取与批量对比 |
| **模拟编制** | 四步引导式流程：PDF 转换 → 结构化提取 → 跨项目对比 → 基于模板生成同类型招标文件，支持设计/施工/设备三类项目 |
| **开标分析** | 解析 Excel/CSV 开标一览表，自动计算报价排名、降价幅度、离散系数等统计指标，AI 生成综合分析报告 |
| **AI 设置** | 支持 OpenAI / DeepSeek / 阿里百炼 / Claude / MiniMax / Ollama 多供应商切换与连接测试 |

## 技术栈

**后端**
- FastAPI + Uvicorn（Python 3.12+）
- SQLAlchemy 2.x（async） + SQLite / PostgreSQL
- 多 AI 供应商抽象层（OpenAI / Claude / Ollama）
- markitdown、pandoc、pandas 处理多格式文件

**前端**
- React 19 + TypeScript + Vite 8
- Ant Design 6 + Tailwind CSS 4
- ECharts 6（图表）
- Axios + SSE（流式响应）

## 目录结构

```
bid-master-web/
├── src/                      # 源代码
├── tests/                    # 测试套件
├── demo/                     # 演示/原型代码
├── resource/                # 参考资料
├── spec/                     # 规约文档
│   ├── ai/                   # AI 生成的规约草稿
│   └── hi/                   # 人工确认的正式规约
├── docs/                     # 文档（research/、bug-fix-summary/、plan/、error-log/、guide/、templates/）
├── notes/                    # 个人笔记（按成员子目录）
├── chats/                    # 对话记录（按成员子目录）
├── .42cog/                   # 认知敏捷法文档
├── .42plugin/                # 本地技能库
├── CLAUDE.md                 # Claude Code 指南
└── .42plugin.yml             # 插件安装清单
```

## 快速开始

### 环境要求

- Python 3.12+
- Node.js 18+

### 一键启动

```bash
# Windows
start.bat

# Git Bash / WSL
./start.sh
```

脚本会同时启动后端（端口 8000）和前端（端口 5173）。

### 手动启动

```bash
# 1. 后端
cd backend
pip install -r requirements.txt
cp .env.example .env          # 填入 AI 供应商密钥
uvicorn app.main:app --reload --port 8000

# 2. 前端
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173 即可使用。

## AI 供应商配置

通过环境变量或前端「设置」页面配置，支持以下供应商：

| 环境变量 | 供应商 |
|---------|--------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `OPENAI_API_KEY` | OpenAI |
| `CLAUDE_API_KEY` | Anthropic Claude |
| `MINIMAX_API_KEY` | MiniMax |
| `OLLAMA_BASE_URL` | 本地 Ollama |

## 部署

- **Docker**：使用项目根目录 `Dockerfile` 构建镜像
- **Vercel**：前端部署，API 请求通过 `vercel.json` rewrite 转发
- **Railway**：支持自动部署，通过环境变量配置 AI 密钥

## API 概览

| 路径前缀 | 功能 |
|---------|------|
| `/api/files` | 文件上传、批量上传、列表、删除 |
| `/api/extract` | 单文件/批量要素提取、门槛分析（SSE 流式） |
| `/api/opening` | 报价统计分析、AI 综合分析报告（SSE） |
| `/api/simulate` | 模拟编制四步流程（SSE） |
| `/api/data` | 数据统计与 CRUD |
| `/api/settings` | AI 供应商查询、切换、连接测试 |
| `/api/health` | 健康检查 |