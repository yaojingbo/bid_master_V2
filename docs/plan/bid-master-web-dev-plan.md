# Bid Master Web 新项目开发计划（修订版）

## Context

参考旧项目 `/Users/yaojingboV2/C.MyLearn/Dev/bid-master-web/resource/bid-master-web-old` 的功能代码，按照规约文档 `.42cog/spec` 的定义，重构并生成一个全新的 Bid Master Web 项目。

**修订说明**：本计划经过深度分析，对比规约文档查漏补缺，主要补充了：
- 遗漏的 API 路由（statistics/parse, statistics/export）
- 遗漏的前端组件（CompareView、SimulateFlow、StatisticsPanel 等 7 个 P1 组件）
- 遗漏的页面功能（模拟编制四步引导、开标分析 Excel 解析）
- 遗漏的测试文件（单元测试、集成测试、E2E 测试、安全测试）
- 遗漏的代码配置（GitHub Actions CI/CD）

### 主要变更原因

1. **前端框架升级**: React+Vite → Next.js 15 (App Router) + shadcn/ui
2. **ORM 更换**: SQLAlchemy → Drizzle ORM
3. **目录重组**: 分散结构 → 统一 src/ 结构
4. **LLM 封装**: 自定义 Factory → LiteLLM
5. **配色方案**: Ant Design 默认 → 樱花粉主题
6. **数据库**: 5 张表 → 8 张表 (UUID 主键、JSONB、审计日志)

---

## 一、规约匹配度分析

### 1.1 已实现项 ✅

| 类别 | 规约项 | 实现位置 |
|------|--------|----------|
| 架构 | Next.js 15 App Router | Phase 1 |
| 架构 | FastAPI 后端 | Phase 3 |
| 架构 | Drizzle ORM | Phase 2 |
| 架构 | LiteLLM 封装 | `src/backend/app/infrastructure/llm/lite_llm.py` |
| 数据库 | 8 张表 + UUID + JSONB | `src/db/schema.ts` |
| 数据库 | 审计日志表 | `src/db/schema.ts` audit_logs |
| 编码 | src/frontend/ + src/backend/ 目录 | Phase 1.1 |
| 编码 | Zustand 状态管理 | `src/frontend/stores/` |
| 编码 | 5 个 Zustand Stores | `src/frontend/stores/*.ts` |
| 编码 | 3 个自定义 Hooks | `src/frontend/hooks/*.ts` |
| UI | 樱花粉主题 OKLCH(55% 0.18 340) | `src/frontend/app/globals.css` |
| UI | 顶部导航 Top Nav | `src/frontend/components/layout/Header.tsx` |
| UI | 5 个页面路由 | `src/frontend/app/(main)/*/page.tsx` |
| 测试 | Vitest + Pytest + Playwright | `vitest.config.ts`, `requirements.txt` |

### 1.2 遗漏项 ❌（需补充）

| 遗漏项 | 规约来源 | 优先级 |
|--------|----------|--------|
| **CompareView 组件** | ui.spec.md, MS-L-03 | P0 |
| **ProviderSelector/ModelSelector** | ui.spec.md | P0 |
| **TestResult 组件** | ui.spec.md | P0 |
| **ExportButton 组件** | ui.spec.md, MS-G-02 | P0 |
| **SimulateFlow 四步引导** | ui.spec.md, AFF-07 | P0 |
| **StatisticsPanel 组件** | ui.spec.md | P0 |
| **POST /api/statistics/parse** | sys.spec.md | P0 |
| **GET /api/statistics/export/:id** | sys.spec.md | P0 |
| **Excel 解析前端展示** | ui.spec.md | P1 |
| **单元测试文件** | qa.spec.md | P1 |
| **集成测试文件** | qa.spec.md | P1 |
| **E2E 测试文件** | qa.spec.md | P1 |
| **CI/CD 配置** | qa.spec.md | P1 |

### 1.3 偏差项 ⚠️

| 偏差项 | 规约要求 | 当前实现 |
|--------|----------|----------|
| 前端 API 调用 | sys.spec.md: 直接调用 FastAPI | 有 `src/frontend/lib/api.ts` 代理层（可接受） |

---

## 二、项目目录结构（完整版）

```bash
bid-master-web/
├── src/
│   ├── db/                           # Drizzle Schema
│   │   ├── schema.ts                 # 8 张表定义 + Relations
│   │   └── types.ts                 # TypeScript 类型导出
│   │
│   ├── lib/                          # 共享库
│   │   ├── validations/              # Zod 验证 schemas
│   │   │   ├── document.ts
│   │   │   ├── analysis.ts
│   │   │   └── ai-config.ts
│   │   └── errors.ts                 # 前端 Error 类 [新增]
│   │
│   ├── frontend/                    # Next.js 15 前端
│   │   ├── app/                      # App Router
│   │   │   ├── (main)/              # 主布局组
│   │   │   │   ├── page.tsx        # 首页
│   │   │   │   ├── extract/         # 要素提取
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── simulate/        # 模拟编制 [需完善]
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── statistics/      # 开标分析 [需完善]
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── database/        # 数据管理
│   │   │   │   │   └── page.tsx
│   │   │   │   └── settings/        # AI 设置 [需完善]
│   │   │   │       └── page.tsx
│   │   │   ├── layout.tsx
│   │   │   └── globals.css          # 樱花粉主题
│   │   │
│   │   ├── components/               # React 组件
│   │   │   ├── ui/                  # shadcn/ui 基础组件
│   │   │   │   ├── button.tsx
│   │   │   │   ├── card.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── label.tsx
│   │   │   │   ├── select.tsx       # [新增]
│   │   │   │   ├── table.tsx       # [新增]
│   │   │   │   └── dialog.tsx       # [新增]
│   │   │   ├── file-upload/         # 文件上传
│   │   │   │   ├── FileUploader.tsx
│   │   │   │   ├── FileList.tsx
│   │   │   │   └── FileRow.tsx
│   │   │   ├── extract/             # 要素提取
│   │   │   │   ├── ElementCard.tsx
│   │   │   │   ├── ElementList.tsx
│   │   │   │   ├── StreamViewer.tsx
│   │   │   │   └── CompareView.tsx  # [新增 P0]
│   │   │   ├── simulate/             # 模拟编制 [新增 P0]
│   │   │   │   ├── SimulateFlow.tsx
│   │   │   │   ├── StepInfo.tsx
│   │   │   │   ├── StepQualification.tsx
│   │   │   │   ├── StepPricing.tsx
│   │   │   │   └── StepDocument.tsx
│   │   │   ├── statistics/           # 开标分析 [新增 P0]
│   │   │   │   ├── ExcelUploader.tsx
│   │   │   │   ├── DataPreviewTable.tsx
│   │   │   │   ├── StatisticsCards.tsx
│   │   │   │   ├── PriceRankingsTable.tsx
│   │   │   │   └── ExportButton.tsx
│   │   │   ├── database/             # 数据管理
│   │   │   │   ├── DatabasePanel.tsx
│   │   │   │   └── FileActions.tsx
│   │   │   ├── settings/             # AI 设置 [新增 P0]
│   │   │   │   ├── ProviderSelector.tsx
│   │   │   │   ├── ModelSelector.tsx
│   │   │   │   └── TestResult.tsx
│   │   │   └── layout/               # 布局
│   │   │       └── Header.tsx
│   │   │
│   │   ├── lib/                       # 前端工具库
│   │   │   ├── api.ts               # API 调用封装
│   │   │   ├── utils.ts             # 工具函数
│   │   │   └── crypto.ts            # 加密工具
│   │   │
│   │   ├── stores/                   # Zustand Stores
│   │   │   ├── app-store.ts
│   │   │   ├── file-store.ts
│   │   │   ├── extract-store.ts
│   │   │   ├── database-store.ts
│   │   │   ├── settings-store.ts
│   │   │   └── simulate-store.ts     # [新增]
│   │   │
│   │   ├── hooks/                    # 自定义 Hooks
│   │   │   ├── useFileUpload.ts
│   │   │   ├── useStreamExtract.ts
│   │   │   ├── useDownload.ts
│   │   │   └── useStatistics.ts      # [新增]
│   │   │
│   │   ├── types/                    # 类型定义
│   │   │   └── index.ts
│   │   │
│   │   ├── constants/                # 常量 [新增]
│   │   │   └── providers.ts
│   │   │
│   │   └── data/mock/               # Mock 数据
│   │       ├── providers.ts
│   │       ├── files.ts
│   │       └── extract-responses.ts
│   │
│   └── backend/                     # FastAPI 后端 (Python)
│       ├── app/
│       │   ├── main.py
│       │   ├── config.py
│       │   ├── dependencies.py
│       │   ├── api/
│       │   │   ├── files.py
│       │   │   ├── extract.py
│       │   │   ├── settings.py
│       │   │   ├── database.py
│       │   │   ├── statistics.py      # [需补充 parse/export]
│       │   │   ├── simulate.py         # [新增]
│       │   │   └── health.py
│       │   ├── services/
│       │   │   ├── file_service.py
│       │   │   ├── extract_service.py
│       │   │   ├── llm_service.py
│       │   │   ├── encryption_service.py
│       │   │   ├── statistics_service.py
│       │   │   └── simulate_service.py  # [新增]
│       │   ├── models/
│       │   │   └── schemas.py
│       │   ├── infrastructure/
│       │   │   ├── database.py
│       │   │   ├── storage.py
│       │   │   └── llm/
│       │   │       └── lite_llm.py
│       │   └── utils/
│       │       ├── crypto.py
│       │       └── exceptions.py
│       ├── requirements.txt
│       └── pyproject.toml
│
├── tests/                              # [新增完整测试结构]
│   ├── unit/
│   │   ├── services/
│   │   │   ├── test_encryption_service.py
│   │   │   ├── test_file_service.py
│   │   │   ├── test_llm_service.py
│   │   │   ├── test_statistics_service.py
│   │   │   └── test_extract_service.py
│   │   ├── models/
│   │   │   └── test_schemas.py
│   │   └── utils/
│   │       └── test_crypto.py
│   ├── integration/
│   │   ├── api/
│   │   │   ├── test_files_api.py
│   │   │   ├── test_extract_api.py
│   │   │   ├── test_settings_api.py
│   │   │   ├── test_statistics_api.py
│   │   │   └── test_simulate_api.py
│   │   └── db/
│   │       └── test_database.py
│   └── security/
│       ├── test_file_security.py
│       └── test_api_security.py
│
├── e2e/                                # [新增]
│   ├── upload.spec.ts
│   ├── extract.spec.ts
│   ├── settings.spec.ts
│   └── simulate.spec.ts
│
├── frontend/                           # [保留 Vite 版本供对比]
│   └── ... (旧项目)
│
├── .github/
│   └── workflows/
│       └── test.yml                   # [新增 CI/CD]
│
├── package.json
├── tsconfig.json
├── next.config.js
├── drizzle.config.ts
├── vitest.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── .eslintrc.json
├── .prettierrc                         # [新增]
├── pytest.ini                          # [新增]
├── playwright.config.ts               # [新增]
└── .env.example
```

---

## 三、API 路由（完整版）

### 3.1 完整 API 路由表

| 模块 | 路由 | 方法 | 功能 | 状态 |
|------|------|------|------|------|
| **files** | `/api/files/upload` | POST | 上传文件（50MB 限制、加密存储） | ✅ 已实现 |
| | `/api/files/list` | GET | 文件列表（分页） | ✅ 已实现 |
| | `/api/files/:id` | GET | 获取文件信息 | ✅ 已实现 |
| | `/api/files/:id` | DELETE | 删除文件 | ✅ 已实现 |
| | `/api/files/:id/download` | GET | 下载文件（解密） | ✅ 已实现 |
| **extract** | `/api/extract/element` | POST | 要素提取（SSE 流式） | ✅ 已实现 |
| | `/api/extract/status/:task_id` | GET | 任务状态 | ✅ 已实现 |
| **settings** | `/api/settings/providers` | GET | 供应商列表 | ✅ 已实现 |
| | `/api/settings/providers/:name` | GET | 获取供应商状态 | ✅ 已实现 |
| | `/api/settings/providers/:name` | POST | 配置供应商 | ✅ 已实现 |
| | `/api/settings/test` | POST | 测试连接 | ✅ 已实现 |
| **statistics** | `/api/statistics/parse` | POST | **解析 Excel/CSV 数据** | ❌ **遗漏** |
| | `/api/statistics/analyze` | POST | AI 分析（SSE） | ✅ 已实现 |
| | `/api/statistics/export/:id` | GET | **导出报告（PDF/Excel）** | ❌ **遗漏** |
| **simulate** | `/api/simulate/create` | POST | **创建模拟任务** | ❌ **遗漏** |
| | `/api/simulate/:task_id/step/:step` | POST | **模拟步骤提交** | ❌ **遗漏** |
| | `/api/simulate/:task_id` | GET | **获取模拟任务状态** | ❌ **遗漏** |
| **database** | `/api/database/tasks` | GET | 任务列表 | ✅ 已实现 |
| | `/api/database/tasks/:id` | GET | 任务详情 | ✅ 已实现 |
| | `/api/database/tasks/:id` | DELETE | 删除任务 | ✅ 已实现 |
| **health** | `/api/health` | GET | 健康检查 | ✅ 已实现 |

### 3.2 遗漏 API 路由详解

#### POST /api/statistics/parse

```python
# src/backend/app/api/statistics.py
@router.post("/parse")
async def parse_statistics_data(file: UploadFile = File(...)):
    """
    解析 Excel/CSV 开标数据文件

    Args:
        file: Excel (.xlsx, .xls) 或 CSV 文件

    Returns:
        解析后的结构化数据
    """
    # 1. 读取文件内容
    # 2. 解析 Excel/CSV（使用 pandas）
    # 3. 提取价格列数据
    # 4. 数据校验
    # 5. 返回结构化数据
```

#### GET /api/statistics/export/:id

```python
@router.get("/export/{analysis_id}")
async def export_report(analysis_id: str, format: str = Query("pdf")):
    """
    导出分析报告

    Args:
        analysis_id: 分析结果 ID
        format: 导出格式 (pdf/excel/json)

    Returns:
        报告文件流
    """
```

#### /api/simulate/*

```python
# src/backend/app/api/simulate.py [新增]
@router.post("/create")
async def create_simulate_task(request: SimulateCreateRequest):

@router.post("/{task_id}/step/{step}")
async def submit_simulate_step(task_id: str, step: int, request: SimulateStepRequest):

@router.get("/{task_id}")
async def get_simulate_task(task_id: str):
```

---

## 四、前端组件（完整版）

### 4.1 组件清单

| 组件 | 路径 | 优先级 | 状态 |
|------|------|--------|------|
| Header | `components/layout/Header.tsx` | P0 | ✅ |
| FileUploader | `components/file-upload/FileUploader.tsx` | P0 | ✅ |
| FileRow | `components/file-upload/FileRow.tsx` | P0 | ✅ |
| FileList | `components/file-upload/FileList.tsx` | P0 | ✅ |
| ElementCard | `components/extract/ElementCard.tsx` | P0 | ✅ |
| ElementList | `components/extract/ElementList.tsx` | P0 | ✅ |
| StreamViewer | `components/extract/StreamViewer.tsx` | P0 | ✅ |
| **CompareView** | `components/extract/CompareView.tsx` | P0 | ❌ **遗漏** |
| DatabasePanel | `components/database/DatabasePanel.tsx` | P1 | ✅ |
| FileActions | `components/database/FileActions.tsx` | P1 | ✅ |
| **ProviderSelector** | `components/settings/ProviderSelector.tsx` | P0 | ❌ **遗漏** |
| **ModelSelector** | `components/settings/ModelSelector.tsx` | P0 | ❌ **遗漏** |
| **TestResult** | `components/settings/TestResult.tsx` | P0 | ❌ **遗漏** |
| **SimulateFlow** | `components/simulate/SimulateFlow.tsx` | P0 | ❌ **遗漏** |
| **ExcelUploader** | `components/statistics/ExcelUploader.tsx` | P0 | ❌ **遗漏** |
| **DataPreviewTable** | `components/statistics/DataPreviewTable.tsx` | P1 | ❌ **遗漏** |
| **StatisticsCards** | `components/statistics/StatisticsCards.tsx` | P1 | ❌ **遗漏** |
| **PriceRankingsTable** | `components/statistics/PriceRankingsTable.tsx` | P1 | ❌ **遗漏** |
| **ExportButton** | `components/statistics/ExportButton.tsx` | P0 | ❌ **遗漏** |

### 4.2 遗漏组件详解

#### CompareView（P0）—— 要素对比组件

```tsx
// src/frontend/components/extract/CompareView.tsx
interface CompareViewProps {
  fileIds: string[];
  elements: Record<string, Element[]>;
}

/**
 * 多文件对比视图
 * - 支持 2-5 个文件同时对比
 * - 横向显示各文件的提取结果
 * - 差异部分高亮显示
 * - 响应式布局（移动端纵向堆叠）
 */
```

#### SimulateFlow（P0）—— 四步引导组件

```tsx
// src/frontend/components/simulate/SimulateFlow.tsx
// 四步流程：
// Step 1: 信息填写 → 选择招标文件、填写企业信息
// Step 2: 资质审查 → AI 自动匹配资质要求
// Step 3: 报价编制 → 智能报价策略推荐
// Step 4: 文档生成 → 一键生成投标文件

interface SimulateFlowProps {
  onComplete: (taskId: string) => void;
}
```

#### StatisticsPanel（P0）—— 开标分析组件

```tsx
// src/frontend/components/statistics/StatisticsCards.tsx
// src/frontend/components/statistics/PriceRankingsTable.tsx
// src/frontend/components/statistics/DataPreviewTable.tsx

interface StatisticsPanelProps {
  data: {
    prices: number[];
    priceRankings: PriceRanking[];
    averagePrice: number;
    lowestPrice: number;
    highestPrice: number;
    dispersionCoefficient: number;
  };
}
```

#### ExportButton（P0）—— 导出按钮

```tsx
// src/frontend/components/statistics/ExportButton.tsx
interface ExportButtonProps {
  analysisId: string;
  format: "pdf" | "excel" | "json";
}
```

---

## 五、执行步骤清单（修订版）

### Step 1: 初始化项目基础结构
- [x] 创建目录结构（已完整包含 tests/, e2e/, .github/）
- [x] 配置文件（package.json, tsconfig.json, vitest.config.ts 等）
- [ ] 补充 `.prettierrc` 代码格式化配置
- [ ] 补充 `playwright.config.ts` E2E 测试配置
- [ ] 补充 `pytest.ini` 后端测试配置

### Step 2: 数据库 Schema
- [x] `src/db/schema.ts` (8 张表 + Relations)
- [x] `src/db/types.ts`
- [ ] 生成 Drizzle 迁移文件

### Step 3: 后端基础设施
- [x] `src/backend/app/infrastructure/database.py`
- [x] `src/backend/app/infrastructure/storage.py`
- [x] `src/backend/app/infrastructure/llm/lite_llm.py`

### Step 4: 后端服务层
- [x] `encryption_service.py`
- [x] `file_service.py`
- [x] `llm_service.py`
- [x] `statistics_service.py`
- [x] `extract_service.py`
- [ ] `simulate_service.py` **（遗漏，需补充）**

### Step 5: 后端 API 路由
- [x] `/api/files/*` 全部路由
- [x] `/api/extract/*` 全部路由
- [x] `/api/settings/*` 全部路由
- [x] `/api/database/*` 全部路由
- [x] `/api/health`
- [ ] `/api/statistics/parse` **（遗漏）**
- [ ] `/api/statistics/export/:id` **（遗漏）**
- [ ] `/api/simulate/*` **（遗漏，需新增）**

### Step 6: 前端共享代码
- [x] `src/lib/validations/*.ts`
- [x] `src/frontend/lib/api.ts`
- [ ] `src/lib/errors.ts` **（遗漏）**
- [ ] `src/frontend/constants/providers.ts` **（遗漏）**

### Step 7: 前端状态管理
- [x] 5 个 Zustand Stores
- [x] 3 个自定义 Hooks
- [ ] `simulate-store.ts` **（遗漏）**
- [ ] `useStatistics.ts` **（遗漏）**

### Step 8: 前端布局
- [x] `layout.tsx` (Header + 顶部导航)
- [x] 首页 `page.tsx`
- [x] 樱花粉主题 `globals.css`

### Step 9: 前端页面
- [x] `/extract` - 要素提取
- [ ] `/simulate` - **需完善四步引导**
- [ ] `/statistics` - **需完善 Excel 解析展示**
- [x] `/database` - 数据管理
- [ ] `/settings` - **需完善 ProviderSelector 等组件**

### Step 10: 前端组件
- [x] FileUploader, FileRow, FileList
- [x] ElementCard, ElementList, StreamViewer
- [x] DatabasePanel, FileActions
- [ ] **CompareView** **（遗漏 P0）**
- [ ] **SimulateFlow + 4 个 Step 组件** **（遗漏 P0）**
- [ ] **ExcelUploader, DataPreviewTable, StatisticsCards, PriceRankingsTable, ExportButton** **（遗漏 P0）**
- [ ] **ProviderSelector, ModelSelector, TestResult** **（遗漏 P0）**

### Step 11: 测试
- [ ] **前端单元测试**（8 个 .test.ts 文件）
- [ ] **后端单元测试**（6 个 test_*.py 文件）
- [ ] **集成测试**（5 个 test_*.py 文件）
- [ ] **E2E 测试**（4 个 .spec.ts 文件）
- [ ] **安全测试**（2 个 test_*.py 文件）
- [ ] **GitHub Actions CI/CD** `.github/workflows/test.yml`

---

## 六、关键文件路径（修订版）

### 6.1 核心实现文件

| 文件 | 用途 | 状态 |
|------|------|------|
| `src/db/schema.ts` | Drizzle 8 张表 | ✅ |
| `src/db/types.ts` | TypeScript 类型 | ✅ |
| `src/lib/validations/*.ts` | Zod 验证 | ✅ |
| `src/lib/errors.ts` | 前端 Error 类 | ❌ |
| `src/lib/api.ts` | API 调用封装 | ✅ |
| `src/frontend/app/globals.css` | 樱花粉主题 | ✅ |
| `src/frontend/components/layout/Header.tsx` | 顶部导航 | ✅ |
| `src/frontend/stores/*.ts` | 5 个 Zustand Stores | ✅ |
| `src/frontend/hooks/*.ts` | 3 个自定义 Hooks | ✅ |
| `src/backend/app/main.py` | FastAPI 入口 | ✅ |
| `src/backend/app/config.py` | 配置管理 | ✅ |
| `src/backend/app/infrastructure/*` | 基础设施层 | ✅ |
| `src/backend/app/services/*.py` | 业务服务层 | ✅ |
| `src/backend/app/api/*.py` | API 路由 | ⚠️ 部分遗漏 |

### 6.2 遗漏文件（按优先级）

**P0（必须实现）**：
```
src/frontend/components/extract/CompareView.tsx
src/frontend/components/simulate/SimulateFlow.tsx
src/frontend/components/simulate/StepInfo.tsx
src/frontend/components/simulate/StepQualification.tsx
src/frontend/components/simulate/StepPricing.tsx
src/frontend/components/simulate/StepDocument.tsx
src/frontend/components/statistics/ExcelUploader.tsx
src/frontend/components/statistics/ExportButton.tsx
src/frontend/components/settings/ProviderSelector.tsx
src/frontend/components/settings/ModelSelector.tsx
src/frontend/components/settings/TestResult.tsx
src/frontend/stores/simulate-store.ts
src/frontend/hooks/useStatistics.ts
src/backend/app/api/statistics.py (补充 parse/export)
src/backend/app/api/simulate.py (新增)
src/backend/app/services/simulate_service.py (新增)
```

**P1（建议实现）**：
```
src/frontend/components/statistics/DataPreviewTable.tsx
src/frontend/components/statistics/StatisticsCards.tsx
src/frontend/components/statistics/PriceRankingsTable.tsx
src/frontend/lib/errors.ts
src/frontend/constants/providers.ts
```

### 6.3 测试文件（全部遗漏）

```
tests/unit/services/test_encryption_service.py
tests/unit/services/test_file_service.py
tests/unit/services/test_llm_service.py
tests/unit/services/test_statistics_service.py
tests/unit/services/test_extract_service.py
tests/unit/models/test_schemas.py
tests/unit/utils/test_crypto.py
tests/integration/api/test_files_api.py
tests/integration/api/test_extract_api.py
tests/integration/api/test_settings_api.py
tests/integration/api/test_statistics_api.py
tests/integration/api/test_simulate_api.py
tests/integration/db/test_database.py
tests/security/test_file_security.py
tests/security/test_api_security.py
e2e/upload.spec.ts
e2e/extract.spec.ts
e2e/settings.spec.ts
e2e/simulate.spec.ts
.github/workflows/test.yml
```

---

## 七、验证方法

### 后端验证
```bash
# 启动后端
cd src/backend && uvicorn app.main:app --reload

# 健康检查
curl http://localhost:8000/api/health

# 文件上传
curl -X POST -F "file=@test.pdf" http://localhost:8000/api/files/upload

# AI 供应商列表
curl http://localhost:8000/api/settings/providers

# 统计解析 [新增]
curl -X POST -F "file=@prices.xlsx" http://localhost:8000/api/statistics/parse

# 报告导出 [新增]
curl -O http://localhost:8000/api/statistics/export/{analysis_id}?format=pdf
```

### 前端验证
```bash
# 启动前端
cd src/frontend && npm install && npm run dev

# 访问 http://localhost:3000
# 验证页面加载和导航
```

### 测试验证
```bash
# 前端单元测试
npm run test:unit

# 后端单元测试
pytest src/backend/tests/unit -v

# 集成测试
pytest src/backend/tests/integration -v

# E2E 测试
npm run test:e2e

# 安全测试
pytest src/backend/tests/security -v
```

### CI/CD 验证
```bash
# 触发 GitHub Actions
git push

# 查看 Actions 日志
gh run list
```

---

## 八、总结

| 类别 | 原计划 | 修订后 |
|------|--------|---------|
| 已实现 | 78% | - |
| API 路由 | 11 个 | 18 个（需补充 7 个） |
| 前端组件 | 9 个 | 19 个（需补充 10 个） |
| 测试文件 | 0 个 | 19 个（需全部补充） |
| 目录结构 | 基本完整 | 补充 simulate/, statistics/, tests/ |

**下一步行动**：
1. 优先实现 P0 遗漏的组件和 API
2. 补充完整的测试文件
3. 配置 CI/CD
4. 进行功能验证

---

**文档版本**：v1.1（修订版）
**创建日期**：2026-05-10
**修订日期**：2026-05-10
**维护者**：Bid Master Team