"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileUp,
  FlaskConical,
  BarChart3,
  FileSearch,
  Eye,
  Download,
  Trash2,
  X,
  Archive,
} from "lucide-react";
import JSZip from "jszip";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { TabNavigation } from "@/components/ui/TabNavigation";
import {
  getStats,
  listFiles,
  downloadFile as apiDownloadFile,
  downloadBlob,
  previewFileUrl,
  deleteFile as apiDeleteFile,
  listSimulates,
  deleteSimulate as apiDeleteSimulate,
  listOpenings,
  deleteOpening as apiDeleteOpening,
  listExtracts,
  deleteExtract as apiDeleteExtract,
  batchDownloadFiles,
} from "@/lib/data-api";
import { useFileStore } from "@/stores/file-store";
import type {
  DataStats,
  FileRecord,
  SimulateTaskRecord,
  OpeningResultRecord,
  ExtractResultRecord,
} from "@/lib/data-api";

// --- 工具函数 ---

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 19);
};

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: "bg-warning/10 text-warning", text: "待处理" },
  step1_convert: { color: "bg-primary/10 text-primary", text: "Step 1 转换" },
  step2_extract: { color: "bg-primary/10 text-primary", text: "Step 2 提取" },
  step3_compare: { color: "bg-primary/10 text-primary", text: "Step 3 对比" },
  step4_simulate: { color: "bg-primary/10 text-primary", text: "Step 4 编制" },
  completed: { color: "bg-success/10 text-success", text: "已完成" },
  failed: { color: "bg-destructive/10 text-destructive", text: "失败" },
};

const fileTypeColor: Record<string, string> = {
  pdf: "bg-destructive/10 text-destructive",
  excel: "bg-success/10 text-success",
  csv: "bg-success/10 text-success",
  markdown: "bg-primary/10 text-primary",
  word: "bg-secondary/10 text-secondary",
};

// --- Markdown 内容生成器（复用详情弹窗逻辑）---

function generateSimulateMarkdown(task: SimulateTaskRecord): string {
  const lines = Object.entries(task.step_results || {}).map(([key, val]) => {
    const label =
      key === "step1" ? "Step 1: PDF转换"
      : key === "step2" ? "Step 2: 要素提取"
      : key === "step3" ? "Step 3: 对比分析"
      : "Step 4: 模拟编制";
    const content = typeof val === "string" ? val : JSON.stringify(val, null, 2);
    return `## ${label}\n\n${content}`;
  });
  return `# 模拟任务 ${task.task_id}\n\n${lines.join("\n\n")}`;
}

function generateOpeningMarkdown(result: OpeningResultRecord): string {
  const meta = result.meta || {};
  const stats = result.bid_stats || ({} as any);
  const lines = [
    `# 开标分析报告`,
    ``,
    `- 项目名称: ${(meta as any).project_name || result.id}`,
    `- 项目编号: ${(meta as any).bid_number || "-"}`,
    `- 投标人数量: ${result.bidder_count || "?"}`,
    `- 分析时间: ${result.created_at || "-"}`,
  ];
  if ((meta as any).max_price) lines.push(`- 最高限价: ¥${(meta as any).max_price.toLocaleString()}`);
  if ((meta as any).benchmark_price) lines.push(`- 评标基准价: ¥${(meta as any).benchmark_price.toLocaleString()}`);

  if (result.bid_ranking?.length) {
    lines.push(``, `## 投标价排名`, ``);
    lines.push(`| 排名 | 投标人 | 报价(万元) |`, "|------|--------|----------|");
    for (const r of result.bid_ranking) {
      lines.push(`| ${r.rank} | ${r.name} | ¥${r.price.toLocaleString()} |`);
    }
  }

  if (stats.mean !== undefined) {
    lines.push(``, `## 统计指标`, ``);
    lines.push(`| 指标 | 值 |`, "|------|-----|");
    lines.push(`| 均值 | ¥${stats.mean.toLocaleString()} |`);
    const sd = stats.std_dev ?? stats.std;
    if (sd !== undefined) lines.push(`| 标准差 | ${sd} |`);
    if (stats.cv !== undefined) lines.push(`| 离散系数 | ${stats.cv}% (${stats.cv_level || "-"}) |`);
    lines.push(`| 最小值 | ¥${stats.min?.toLocaleString()} |`);
    lines.push(`| 最大值 | ¥${stats.max?.toLocaleString()} |`);
    if (stats.range !== undefined) lines.push(`| 极差 | ¥${stats.range.toLocaleString()} |`);
  }

  const discount = (result as any).discount_results;
  if (discount?.length) {
    lines.push(``, `## 降价分析`, ``);
    for (const r of discount) {
      lines.push(`- ${r.name}: 降幅 ${r.discount_pct}% (${r.strategy})`);
    }
  }

  if ((result as any).ai_analysis) {
    lines.push(``, `## AI 综合分析`, ``, (result as any).ai_analysis);
  }

  return lines.join("\n");
}

function generateExtractMarkdown(result: ExtractResultRecord): string {
  return result.content || "";
}

// --- 主组件 ---

export default function DatabasePage() {
  const [activeTab, setActiveTab] = useState("files");
  const loadedTabs = useState(new Set(["files"]))[0];

  // 统计
  const [stats, setStats] = useState<DataStats>({
    files: 0,
    simulate_tasks: 0,
    opening_results: 0,
    extract_results: 0,
  });

  // 文件
  const [filesData, setFilesData] = useState<FileRecord[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesPage, setFilesPage] = useState(1);
  const [fileTypeFilter, setFileTypeFilter] = useState<string | undefined>();
  const [fileDetail, setFileDetail] = useState<FileRecord | null>(null);

  // 模拟任务
  const [simulatesData, setSimulatesData] = useState<SimulateTaskRecord[]>([]);
  const [simulatesLoading, setSimulatesLoading] = useState(false);
  const [simulatesTotal, setSimulatesTotal] = useState(0);
  const [simulatesPage, setSimulatesPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [simulateDetail, setSimulateDetail] = useState<SimulateTaskRecord | null>(null);

  // 开标结果
  const [openingsData, setOpeningsData] = useState<OpeningResultRecord[]>([]);
  const [openingsLoading, setOpeningsLoading] = useState(false);
  const [openingsTotal, setOpeningsTotal] = useState(0);
  const [openingsPage, setOpeningsPage] = useState(1);
  const [openingDetail, setOpeningDetail] = useState<OpeningResultRecord | null>(null);

  // 提取结果
  const [extractsData, setExtractsData] = useState<ExtractResultRecord[]>([]);
  const [extractsLoading, setExtractsLoading] = useState(false);
  const [extractsTotal, setExtractsTotal] = useState(0);
  const [extractsPage, setExtractsPage] = useState(1);
  const [extractDetail, setExtractDetail] = useState<ExtractResultRecord | null>(null);

  // 确认弹窗
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // 下载中状态
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);

  // 多选状态
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedSimulates, setSelectedSimulates] = useState<Set<string>>(new Set());
  const [selectedOpenings, setSelectedOpenings] = useState<Set<string>>(new Set());
  const [selectedExtracts, setSelectedExtracts] = useState<Set<string>>(new Set());

  // --- 数据加载 ---

  const loadStats = useCallback(async () => {
    try {
      const s = await getStats();
      setStats(s);
    } catch {
      /* 忽略 */
    }
  }, []);

  const fetchFiles = useCallback(
    async (page = 1) => {
      setFilesLoading(true);
      try {
        const res = await listFiles({
          page,
          page_size: 20,
          file_type: fileTypeFilter,
        });
        setFilesData(res.files);
        setFilesTotal(res.total);
        setFilesPage(page);
      } catch (err) {
        console.error("加载文件失败:", err);
      } finally {
        setFilesLoading(false);
      }
    },
    [fileTypeFilter]
  );

  const fetchSimulates = useCallback(
    async (page = 1) => {
      setSimulatesLoading(true);
      try {
        const res = await listSimulates({
          page,
          page_size: 20,
          status: statusFilter,
        });
        setSimulatesData(res.tasks);
        setSimulatesTotal(res.total);
        setSimulatesPage(page);
      } catch (err) {
        console.error("加载模拟任务失败:", err);
      } finally {
        setSimulatesLoading(false);
      }
    },
    [statusFilter]
  );

  const fetchOpenings = useCallback(async (page = 1) => {
    setOpeningsLoading(true);
    try {
      const res = await listOpenings({ page, page_size: 20 });
      setOpeningsData(res.results);
      setOpeningsTotal(res.total);
      setOpeningsPage(page);
    } catch (err) {
      console.error("加载开标结果失败:", err);
    } finally {
      setOpeningsLoading(false);
    }
  }, []);

  const fetchExtracts = useCallback(async (page = 1) => {
    setExtractsLoading(true);
    try {
      const res = await listExtracts({ page, page_size: 20 });
      setExtractsData(res.results);
      setExtractsTotal(res.total);
      setExtractsPage(page);
    } catch (err) {
      console.error("加载提取结果失败:", err);
    } finally {
      setExtractsLoading(false);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadStats();
    fetchFiles();
  }, [loadStats, fetchFiles]);

  // 筛选变化时重新加载
  useEffect(() => {
    fetchFiles(1);
  }, [fileTypeFilter, fetchFiles]);

  useEffect(() => {
    if (loadedTabs.has("simulates")) fetchSimulates(1);
  }, [statusFilter, fetchSimulates, loadedTabs]);

  // --- 下载处理 ---

  const handleDownloadFile = async (file: FileRecord) => {
    setDownloadingId(file.id);
    setDownloadError(null);
    try {
      const blob = await apiDownloadFile(file.id);
      downloadBlob(blob, file.original_name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "下载失败";
      setDownloadError(msg);
      console.error("下载文件失败:", err);
    } finally {
      setDownloadingId(null);
    }
  };

  // --- 删除处理 ---

  const handleDeleteFile = async (id: string) => {
    try {
      await apiDeleteFile(id);
      useFileStore.getState().removeFile(id);
      fetchFiles(filesPage);
      loadStats();
    } catch (err) {
      console.error("删除文件失败:", err);
    }
  };

  const handleDeleteSimulate = async (taskId: string) => {
    try {
      await apiDeleteSimulate(taskId);
      fetchSimulates(simulatesPage);
      loadStats();
    } catch (err) {
      console.error("删除模拟任务失败:", err);
    }
  };

  const handleDeleteOpening = async (taskId: string) => {
    try {
      await apiDeleteOpening(taskId);
      fetchOpenings(openingsPage);
      loadStats();
    } catch (err) {
      console.error("删除开标结果失败:", err);
    }
  };

  const handleDeleteExtract = async (resultId: string) => {
    try {
      await apiDeleteExtract(resultId);
      fetchExtracts(extractsPage);
      loadStats();
    } catch (err) {
      console.error("删除提取结果失败:", err);
    }
  };

  // --- 批量操作处理 ---

  const handleBatchDeleteFiles = async () => {
    if (selectedFiles.size === 0) return;
    setConfirmAction({
      title: "批量删除文件",
      message: `确定删除选中的 ${selectedFiles.size} 个文件？`,
      onConfirm: async () => {
        for (const id of selectedFiles) {
          try {
            await apiDeleteFile(id);
          } catch { /* ignore individual failures */ }
        }
        setSelectedFiles(new Set());
        fetchFiles(filesPage);
        loadStats();
      },
    });
  };

  const handleBatchDownloadFiles = async () => {
    if (selectedFiles.size === 0) return;
    setBatchDownloading(true);
    setDownloadError(null);
    try {
      const ids = Array.from(selectedFiles);
      const blob = await batchDownloadFiles(ids);
      downloadBlob(blob, "batch_download.zip");
      setSelectedFiles(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "批量下载失败";
      setDownloadError(msg);
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleBatchDeleteSimulates = async () => {
    if (selectedSimulates.size === 0) return;
    setConfirmAction({
      title: "批量删除任务",
      message: `确定删除选中的 ${selectedSimulates.size} 个模拟任务？`,
      onConfirm: async () => {
        for (const id of selectedSimulates) {
          try {
            await apiDeleteSimulate(id);
          } catch { /* ignore individual failures */ }
        }
        setSelectedSimulates(new Set());
        fetchSimulates(simulatesPage);
        loadStats();
      },
    });
  };

  const handleBatchDownloadSimulates = async () => {
    if (selectedSimulates.size === 0) return;
    setBatchDownloading(true);
    setDownloadError(null);
    try {
      const zip = new JSZip();
      const selected = simulatesData.filter((t) => selectedSimulates.has(t.task_id));
      for (const task of selected) {
        zip.file(`simulate_${task.task_id}.md`, generateSimulateMarkdown(task));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "simulate_reports.zip");
      setSelectedSimulates(new Set());
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "批量下载失败");
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleBatchDeleteOpenings = async () => {
    if (selectedOpenings.size === 0) return;
    setConfirmAction({
      title: "批量删除开标结果",
      message: `确定删除选中的 ${selectedOpenings.size} 个开标结果？`,
      onConfirm: async () => {
        for (const id of selectedOpenings) {
          try {
            await apiDeleteOpening(id);
          } catch { /* ignore individual failures */ }
        }
        setSelectedOpenings(new Set());
        fetchOpenings(openingsPage);
        loadStats();
      },
    });
  };

  const handleBatchDownloadOpenings = async () => {
    if (selectedOpenings.size === 0) return;
    setBatchDownloading(true);
    setDownloadError(null);
    try {
      const zip = new JSZip();
      const selected = openingsData.filter((o) => selectedOpenings.has(o.id));
      for (const r of selected) {
        zip.file(`opening_${r.id}.md`, generateOpeningMarkdown(r));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "opening_reports.zip");
      setSelectedOpenings(new Set());
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "批量下载失败");
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleBatchDeleteExtracts = async () => {
    if (selectedExtracts.size === 0) return;
    setConfirmAction({
      title: "批量删除提取结果",
      message: `确定删除选中的 ${selectedExtracts.size} 个提取结果？`,
      onConfirm: async () => {
        for (const id of selectedExtracts) {
          try {
            await apiDeleteExtract(id);
          } catch { /* ignore individual failures */ }
        }
        setSelectedExtracts(new Set());
        fetchExtracts(extractsPage);
        loadStats();
      },
    });
  };

  const handleBatchDownloadExtracts = async () => {
    if (selectedExtracts.size === 0) return;
    setBatchDownloading(true);
    setDownloadError(null);
    try {
      const zip = new JSZip();
      const selected = extractsData.filter((e) => selectedExtracts.has(e.id));
      for (const r of selected) {
        const filename = `extract_${r.id}_${r.template_type}.md`;
        zip.file(filename, generateExtractMarkdown(r));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "extract_results.zip");
      setSelectedExtracts(new Set());
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "批量下载失败");
    } finally {
      setBatchDownloading(false);
    }
  };

  // --- 多选处理 ---

  const toggleFileSelect = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFileSelect = (ids: string[]) => {
    setSelectedFiles((prev) => {
      if (prev.size === ids.length) return new Set();
      return new Set(ids);
    });
  };

  const toggleSimulateSelect = (id: string) => {
    setSelectedSimulates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllSimulateSelect = (ids: string[]) => {
    setSelectedSimulates((prev) => {
      if (prev.size === ids.length) return new Set();
      return new Set(ids);
    });
  };

  const toggleOpeningSelect = (id: string) => {
    setSelectedOpenings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOpeningSelect = (ids: string[]) => {
    setSelectedOpenings((prev) => {
      if (prev.size === ids.length) return new Set();
      return new Set(ids);
    });
  };

  const toggleExtractSelect = (id: string) => {
    setSelectedExtracts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllExtractSelect = (ids: string[]) => {
    setSelectedExtracts((prev) => {
      if (prev.size === ids.length) return new Set();
      return new Set(ids);
    });
  };

  // --- Tab 切换懒加载 ---

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (!loadedTabs.has(key)) {
      loadedTabs.add(key);
      if (key === "simulates") fetchSimulates();
      else if (key === "openings") fetchOpenings();
      else if (key === "extracts") fetchExtracts();
    }
  };

  // --- 渲染辅助 ---

  const tabs = [
    { key: "files", label: "文件管理", icon: FileUp },
    { key: "simulates", label: "模拟任务", icon: FlaskConical },
    { key: "openings", label: "开标结果", icon: BarChart3 },
    { key: "extracts", label: "提取结果", icon: FileSearch },
  ];

  const StatCard = ({
    label,
    value,
    icon: Icon,
    color,
  }: {
    label: string;
    value: number;
    icon: React.ElementType;
    color: string;
  }) => (
    <div className="rounded-xl border border-border p-6 flex items-center gap-4">
      <div className={cn("rounded-full p-3", color)}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );

  const Pagination = ({
    page,
    total,
    onPageChange,
  }: {
    page: number;
    total: number;
    onPageChange: (p: number) => void;
  }) => {
    const totalPages = Math.ceil(total / 20) || 1;
    return (
      <div className="flex items-center justify-between p-3 border-t text-sm">
        <span className="text-muted-foreground">共 {total} 条</span>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 border rounded hover:bg-muted disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            className="px-3 py-1 border rounded hover:bg-muted disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    );
  };

  // --- 渲染 ---

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title="数据管理" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="文件"
          value={stats.files}
          icon={FileUp}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label="模拟任务"
          value={stats.simulate_tasks}
          icon={FlaskConical}
          color="bg-secondary/10 text-secondary"
        />
        <StatCard
          label="开标结果"
          value={stats.opening_results}
          icon={BarChart3}
          color="bg-success/10 text-success"
        />
        <StatCard
          label="提取结果"
          value={stats.extract_results}
          icon={FileSearch}
          color="bg-primary/10 text-primary"
        />
      </div>

      {/* Tab 导航 */}
      <TabNavigation tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* 下载错误提示 */}
      {downloadError && (
        <div className="p-4 rounded-lg bg-destructive/10 text-destructive flex items-center justify-between">
          <span>{downloadError}</span>
          <button className="p-1 hover:bg-muted rounded" onClick={() => setDownloadError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* --- 文件管理 Tab --- */}
      {activeTab === "files" && (
        <div>
          {/* 批量操作栏 */}
          {selectedFiles.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
              <span className="text-sm">
                已选择 <strong>{selectedFiles.size}</strong> 个文件
              </span>
              <button
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm flex items-center gap-1.5 disabled:opacity-50"
                onClick={handleBatchDownloadFiles}
                disabled={batchDownloading}
              >
                {batchDownloading ? (
                  <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                批量下载
              </button>
              <button
                className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 text-sm flex items-center gap-1.5"
                onClick={handleBatchDeleteFiles}
              >
                <Trash2 className="h-4 w-4" />
                批量删除
              </button>
              <button
                className="px-3 py-1.5 border rounded hover:bg-muted text-sm"
                onClick={() => setSelectedFiles(new Set())}
              >
                取消选择
              </button>
            </div>
          )}

          {/* 筛选 */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm text-muted-foreground">文件类型：</span>
            <select
              className="border rounded px-3 py-1 text-sm"
              value={fileTypeFilter || ""}
              onChange={(e) =>
                setFileTypeFilter(e.target.value || undefined)
              }
            >
              <option value="">全部类型</option>
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
              <option value="csv">CSV</option>
              <option value="markdown">Markdown</option>
              <option value="word">Word</option>
            </select>
          </div>

          {/* 表格 */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-semibold text-sm w-10">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={filesData.length > 0 && selectedFiles.size === filesData.length}
                      onChange={() => toggleAllFileSelect(filesData.map((f) => f.id))}
                    />
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">ID</th>
                  <th className="p-3 text-left font-semibold text-sm">
                    文件名
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">大小</th>
                  <th className="p-3 text-left font-semibold text-sm">类型</th>
                  <th className="p-3 text-left font-semibold text-sm">
                    上传时间
                  </th>
                  <th className="p-3 text-right font-semibold text-sm">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filesLoading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-8 text-center text-muted-foreground"
                    >
                      加载中...
                    </td>
                  </tr>
                ) : filesData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-8 text-center text-muted-foreground"
                    >
                      暂无文件
                    </td>
                  </tr>
                ) : (
                  filesData.map((file) => (
                    <tr key={file.id} className={cn("hover:bg-muted/30", selectedFiles.has(file.id) && "bg-primary/5")}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedFiles.has(file.id)}
                          onChange={() => toggleFileSelect(file.id)}
                        />
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {file.id}
                      </td>
                      <td className="p-3 font-medium">{file.original_name}</td>
                      <td className="p-3 text-muted-foreground">
                        {formatSize(file.size)}
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            "px-2 py-1 rounded text-xs",
                            fileTypeColor[file.type] || "bg-muted text-muted-foreground"
                          )}
                        >
                          {file.type}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground text-sm">
                        {formatDate(file.created_at)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="p-2 hover:bg-muted rounded"
                            title="查看详情"
                            onClick={() => setFileDetail(file)}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            className="p-2 hover:bg-primary/10 text-primary rounded"
                            title="预览文件"
                            onClick={() => window.open(previewFileUrl(file.id), '_blank')}
                          >
                            <FileUp className="h-4 w-4" />
                          </button>
                          <button
                            className={cn("p-2 hover:bg-primary/10 text-primary rounded", downloadingId === file.id && "opacity-50")}
                            title="下载"
                            disabled={downloadingId === file.id}
                            onClick={() => handleDownloadFile(file)}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            className="p-2 hover:bg-destructive/10 text-destructive rounded"
                            title="删除"
                            onClick={() =>
                              setConfirmAction({
                                title: "确认删除",
                                message: `删除文件「${file.original_name}」？`,
                                onConfirm: () => handleDeleteFile(file.id),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <Pagination
              page={filesPage}
              total={filesTotal}
              onPageChange={fetchFiles}
            />
          </div>
        </div>
      )}

      {/* --- 模拟任务 Tab --- */}
      {activeTab === "simulates" && (
        <div>
          {/* 批量操作栏 */}
          {selectedSimulates.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
              <span className="text-sm">
                已选择 <strong>{selectedSimulates.size}</strong> 个任务
              </span>
              <button
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm flex items-center gap-1.5 disabled:opacity-50"
                onClick={handleBatchDownloadSimulates}
                disabled={batchDownloading}
              >
                {batchDownloading ? (
                  <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                批量下载
              </button>
              <button
                className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 text-sm flex items-center gap-1.5"
                onClick={handleBatchDeleteSimulates}
              >
                <Trash2 className="h-4 w-4" />
                批量删除
              </button>
              <button
                className="px-3 py-1.5 border rounded hover:bg-muted text-sm"
                onClick={() => setSelectedSimulates(new Set())}
              >
                取消选择
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm text-muted-foreground">状态：</span>
            <select
              className="border rounded px-3 py-1 text-sm"
              value={statusFilter || ""}
              onChange={(e) =>
                setStatusFilter(e.target.value || undefined)
              }
            >
              <option value="">全部状态</option>
              {Object.entries(statusMap).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.text}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-semibold text-sm w-10">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={simulatesData.length > 0 && selectedSimulates.size === simulatesData.length}
                      onChange={() => toggleAllSimulateSelect(simulatesData.map((t) => t.task_id))}
                    />
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">
                    名称
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">状态</th>
                  <th className="p-3 text-left font-semibold text-sm">
                    当前步骤
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">
                    创建时间
                  </th>
                  <th className="p-3 text-right font-semibold text-sm">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {simulatesLoading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-muted-foreground"
                    >
                      加载中...
                    </td>
                  </tr>
                ) : simulatesData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-muted-foreground"
                    >
                      暂无模拟任务
                    </td>
                  </tr>
                ) : (
                  simulatesData.map((task) => (
                    <tr key={task.task_id} className={cn("hover:bg-muted/30", selectedSimulates.has(task.task_id) && "bg-primary/5")}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedSimulates.has(task.task_id)}
                          onChange={() => toggleSimulateSelect(task.task_id)}
                        />
                      </td>
                      <td className="p-3 text-sm font-medium">
                        {task.name || task.task_id}
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            "px-2 py-1 rounded text-xs",
                            (statusMap[task.status] || {
                              color: "bg-muted text-muted-foreground",
                            }).color
                          )}
                        >
                          {(statusMap[task.status] || { text: task.status }).text}
                        </span>
                      </td>
                      <td className="p-3 text-sm">
                        Step {task.current_step}/4
                      </td>
                      <td className="p-3 text-muted-foreground text-sm">
                        {formatDate(task.created_at)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="p-2 hover:bg-muted rounded"
                            title="查看"
                            onClick={() => setSimulateDetail(task)}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            className="p-2 hover:bg-destructive/10 text-destructive rounded"
                            title="删除"
                            onClick={() =>
                              setConfirmAction({
                                title: "确认删除",
                                message: `删除任务「${task.task_id}」？`,
                                onConfirm: () =>
                                  handleDeleteSimulate(task.task_id),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <Pagination
              page={simulatesPage}
              total={simulatesTotal}
              onPageChange={fetchSimulates}
            />
          </div>
        </div>
      )}

      {/* --- 开标结果 Tab --- */}
      {activeTab === "openings" && (
        <div>
          {/* 批量操作栏 */}
          {selectedOpenings.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
              <span className="text-sm">
                已选择 <strong>{selectedOpenings.size}</strong> 个开标结果
              </span>
              <button
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm flex items-center gap-1.5 disabled:opacity-50"
                onClick={handleBatchDownloadOpenings}
                disabled={batchDownloading}
              >
                {batchDownloading ? (
                  <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                批量下载
              </button>
              <button
                className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 text-sm flex items-center gap-1.5"
                onClick={handleBatchDeleteOpenings}
              >
                <Trash2 className="h-4 w-4" />
                批量删除
              </button>
              <button
                className="px-3 py-1.5 border rounded hover:bg-muted text-sm"
                onClick={() => setSelectedOpenings(new Set())}
              >
                取消选择
              </button>
            </div>
          )}

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-semibold text-sm w-10">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={openingsData.length > 0 && selectedOpenings.size === openingsData.length}
                      onChange={() => toggleAllOpeningSelect(openingsData.map((o) => o.id))}
                    />
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">名称</th>
                <th className="p-3 text-left font-semibold text-sm">
                  投标人数量
                </th>
                <th className="p-3 text-left font-semibold text-sm">
                  创建时间
                </th>
                <th className="p-3 text-right font-semibold text-sm">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {openingsLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="p-8 text-center text-muted-foreground"
                  >
                    加载中...
                  </td>
                </tr>
              ) : openingsData.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="p-8 text-center text-muted-foreground"
                  >
                    暂无开标结果
                  </td>
                </tr>
              ) : (
                openingsData.map((result) => (
                  <tr key={result.id} className={cn("hover:bg-muted/30", selectedOpenings.has(result.id) && "bg-primary/5")}>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedOpenings.has(result.id)}
                        onChange={() => toggleOpeningSelect(result.id)}
                      />
                    </td>
                    <td className="p-3 text-sm font-medium">
                      {result.name || result.id}
                    </td>
                    <td className="p-3">{result.bidder_count ?? "-"}</td>
                    <td className="p-3 text-muted-foreground text-sm">
                      {formatDate(result.created_at)}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="p-2 hover:bg-muted rounded"
                          title="查看"
                          onClick={() => setOpeningDetail(result)}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          className="p-2 hover:bg-destructive/10 text-destructive rounded"
                          title="删除"
                          onClick={() =>
                            setConfirmAction({
                              title: "确认删除",
                              message: `删除开标结果「${result.id}」？`,
                              onConfirm: () => handleDeleteOpening(result.id),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination
            page={openingsPage}
            total={openingsTotal}
            onPageChange={fetchOpenings}
          />
        </div>
        </div>
      )}

      {/* --- 提取结果 Tab --- */}
      {activeTab === "extracts" && (
        <div>
          {/* 批量操作栏 */}
          {selectedExtracts.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
              <span className="text-sm">
                已选择 <strong>{selectedExtracts.size}</strong> 个提取结果
              </span>
              <button
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm flex items-center gap-1.5 disabled:opacity-50"
                onClick={handleBatchDownloadExtracts}
                disabled={batchDownloading}
              >
                {batchDownloading ? (
                  <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                批量下载
              </button>
              <button
                className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 text-sm flex items-center gap-1.5"
                onClick={handleBatchDeleteExtracts}
              >
                <Trash2 className="h-4 w-4" />
                批量删除
              </button>
              <button
                className="px-3 py-1.5 border rounded hover:bg-muted text-sm"
                onClick={() => setSelectedExtracts(new Set())}
              >
                取消选择
              </button>
            </div>
          )}

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-semibold text-sm w-10">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={extractsData.length > 0 && selectedExtracts.size === extractsData.length}
                      onChange={() => toggleAllExtractSelect(extractsData.map((e) => e.id))}
                    />
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">名称</th>
                  <th className="p-3 text-left font-semibold text-sm">
                    模板类型
                  </th>
                  <th className="p-3 text-left font-semibold text-sm">模式</th>
                  <th className="p-3 text-left font-semibold text-sm">
                    创建时间
                  </th>
                  <th className="p-3 text-right font-semibold text-sm">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
              {extractsLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="p-8 text-center text-muted-foreground"
                  >
                    加载中...
                  </td>
                </tr>
              ) : extractsData.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="p-8 text-center text-muted-foreground"
                  >
                    暂无提取结果
                  </td>
                </tr>
              ) : (
                extractsData.map((result) => (
                  <tr key={result.id} className={cn("hover:bg-muted/30", selectedExtracts.has(result.id) && "bg-primary/5")}>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedExtracts.has(result.id)}
                        onChange={() => toggleExtractSelect(result.id)}
                      />
                    </td>
                    <td className="p-3 text-sm font-medium">
                      {result.name || result.id}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground">
                        {result.template_type}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-1 rounded text-xs bg-primary/10 text-primary">
                        {result.mode}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground text-sm">
                      {formatDate(result.created_at)}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="p-2 hover:bg-muted rounded"
                          title="查看"
                          onClick={() => setExtractDetail(result)}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          className="p-2 hover:bg-primary/10 text-primary rounded"
                          title="下载 MD"
                          onClick={() => {
                            const blob = new Blob([result.content], {
                              type: "text/markdown;charset=utf-8",
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `extract_${result.id}_${result.template_type}.md`;
                            document.body.appendChild(a);
                            a.click();
                            URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          className="p-2 hover:bg-destructive/10 text-destructive rounded"
                          title="删除"
                          onClick={() =>
                            setConfirmAction({
                              title: "确认删除",
                              message: `删除提取结果「${result.id}」？`,
                              onConfirm: () => handleDeleteExtract(result.id),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination
            page={extractsPage}
            total={extractsTotal}
            onPageChange={fetchExtracts}
          />
        </div>
        </div>
      )}

      {/* --- 确认删除弹窗 --- */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 max-w-sm w-full shadow-lg">
            <h3 className="text-lg font-semibold mb-2">
              {confirmAction.title}
            </h3>
            <p className="text-muted-foreground mb-4">
              {confirmAction.message}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                className="px-4 py-2 border rounded hover:bg-muted"
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
                onClick={() => {
                  confirmAction.onConfirm();
                  setConfirmAction(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 文件详情弹窗 --- */}
      {fileDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg max-w-2xl w-full shadow-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">文件详情</h3>
              <button
                className="p-2 hover:bg-muted rounded"
                onClick={() => setFileDetail(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">ID：</span>
                  {fileDetail.id}
                </div>
                <div>
                  <span className="text-muted-foreground">文件名：</span>
                  {fileDetail.original_name}
                </div>
                <div>
                  <span className="text-muted-foreground">大小：</span>
                  {formatSize(fileDetail.size)}
                </div>
                <div>
                  <span className="text-muted-foreground">类型：</span>
                  <span
                    className={cn(
                      "px-2 py-1 rounded text-xs",
                      fileTypeColor[fileDetail.type] || "bg-muted"
                    )}
                  >
                    {fileDetail.type}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">上传时间：</span>
                  {formatDate(fileDetail.created_at)}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 flex items-center gap-2"
                onClick={() => handleDownloadFile(fileDetail)}
              >
                <Download className="h-4 w-4" />
                下载文件
              </button>
              <button
                className="px-4 py-2 border rounded hover:bg-muted flex items-center gap-2"
                onClick={() => window.open(previewFileUrl(fileDetail.id), '_blank')}
              >
                <Eye className="h-4 w-4" />
                预览
              </button>
              <button
                className="px-4 py-2 border rounded hover:bg-muted"
                onClick={() => setFileDetail(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 模拟任务详情弹窗 --- */}
      {simulateDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg max-w-3xl w-full shadow-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">模拟任务详情</h3>
              <button
                className="p-2 hover:bg-muted rounded"
                onClick={() => setSimulateDetail(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">任务ID：</span>
                  {simulateDetail.task_id}
                </div>
                <div>
                  <span className="text-muted-foreground">状态：</span>
                  <span
                    className={cn(
                      "px-2 py-1 rounded text-xs",
                      (statusMap[simulateDetail.status] || {
                        color: "bg-muted",
                      }).color
                    )}
                  >
                    {simulateDetail.status}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">当前步骤：</span>
                  Step {simulateDetail.current_step}/4
                </div>
                <div>
                  <span className="text-muted-foreground">创建时间：</span>
                  {formatDate(simulateDetail.created_at)}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">关联文件：</span>
                  {(simulateDetail.files || [])
                    .map((f) => f.original_name)
                    .join("、") || "-"}
                </div>
              </div>

              {/* 步骤结果 */}
              {Object.entries(simulateDetail.step_results || {}).map(
                ([key, val]) => (
                  <div key={key} className="rounded-xl border border-border p-3">
                    <span className="px-2 py-1 rounded text-xs bg-primary/10 text-primary mb-2 inline-block">
                      {key === "step1"
                        ? "Step 1: PDF转换"
                        : key === "step2"
                          ? "Step 2: 要素提取"
                          : key === "step3"
                            ? "Step 3: 对比分析"
                            : "Step 4: 模拟编制"}
                    </span>
                    <pre className="text-xs mt-2 whitespace-pre-wrap max-h-48 overflow-auto">
                      {typeof val === "string"
                        ? val
                        : JSON.stringify(val, null, 2)}
                    </pre>
                  </div>
                )
              )}
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 flex items-center gap-2"
                onClick={() => {
                  const lines = Object.entries(simulateDetail.step_results || {})
                    .map(([key, val]) => {
                      const label = key === "step1" ? "Step 1: PDF转换"
                        : key === "step2" ? "Step 2: 要素提取"
                        : key === "step3" ? "Step 3: 对比分析"
                        : "Step 4: 模拟编制";
                      const content = typeof val === "string" ? val : JSON.stringify(val, null, 2);
                      return `## ${label}\n\n${content}`;
                    });
                  const md = `# 模拟任务 ${simulateDetail.task_id}\n\n${lines.join("\n\n")}`;
                  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
                  downloadBlob(blob, `simulate_${simulateDetail.task_id}.md`);
                }}
              >
                <Download className="h-4 w-4" />
                下载结果
              </button>
              <button
                className="px-4 py-2 border rounded hover:bg-muted"
                onClick={() => setSimulateDetail(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 开标结果详情弹窗 --- */}
      {openingDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg max-w-3xl w-full shadow-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">开标结果详情</h3>
              <button
                className="p-2 hover:bg-muted rounded"
                onClick={() => setOpeningDetail(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">ID：</span>
                  {openingDetail.id}
                </div>
                <div>
                  <span className="text-muted-foreground">投标人数量：</span>
                  {openingDetail.bidder_count ?? "-"}
                </div>
              </div>

              {/* 投标价排名 */}
              {openingDetail.bid_ranking && (
                <div>
                  <h4 className="font-semibold mb-2">投标价排名</h4>
                  <table className="w-full rounded-xl border border-border overflow-hidden text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left font-semibold">排名</th>
                        <th className="p-2 text-left font-semibold">投标人</th>
                        <th className="p-2 text-right font-semibold">投标价</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {openingDetail.bid_ranking.map((item) => (
                        <tr key={item.rank} className="hover:bg-muted/30">
                          <td className="p-2">{item.rank}</td>
                          <td className="p-2">{item.name}</td>
                          <td className="p-2 text-right">
                            ¥{item.price.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 统计指标 */}
              {openingDetail.bid_stats && (
                <div>
                  <h4 className="font-semibold mb-2">统计指标</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "均值", value: openingDetail.bid_stats.mean, unit: "¥" },
                      { label: "标准差", value: (openingDetail.bid_stats as any).std_dev ?? (openingDetail.bid_stats as any).std, unit: "" },
                      { label: "离散系数", value: openingDetail.bid_stats.cv, unit: "%" },
                      { label: "最小值", value: openingDetail.bid_stats.min, unit: "¥" },
                      { label: "最大值", value: openingDetail.bid_stats.max, unit: "¥" },
                      { label: "极差", value: openingDetail.bid_stats.range, unit: "¥" },
                    ].map(({ label, value, unit }) => (
                      <div
                        key={label}
                        className="rounded-xl border border-border p-3 text-center"
                      >
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="text-lg font-semibold">
                          {typeof value === "number"
                            ? `${unit}${value.toLocaleString()}`
                            : (value ?? "-")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI 综合分析 */}
              {(openingDetail as any).ai_analysis && (
                <div className="mt-4">
                  <h4 className="font-semibold mb-2">AI 综合分析</h4>
                  <div className="rounded-xl border border-border p-4 max-h-[400px] overflow-auto bg-muted/20">
                    <pre className="whitespace-pre-wrap text-sm">{(openingDetail as any).ai_analysis}</pre>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 flex items-center gap-2"
                onClick={() => {
                  const d = openingDetail;
                  const meta = d.meta || {};
                  const stats = d.bid_stats || ({} as any);
                  const lines = [
                    `# 开标分析报告`,
                    ``,
                    `- 项目名称: ${meta.project_name || d.id}`,
                    `- 项目编号: ${meta.bid_number || "-"}`,
                    `- 投标人数量: ${d.bidder_count || "?"}`,
                    `- 分析时间: ${d.created_at || "-"}`,
                  ];
                  if (meta.max_price) lines.push(`- 最高限价: ¥${meta.max_price.toLocaleString()}`);
                  if (meta.benchmark_price) lines.push(`- 评标基准价: ¥${meta.benchmark_price.toLocaleString()}`);

                  if (d.bid_ranking?.length) {
                    lines.push(``, `## 投标价排名`, ``);
                    lines.push(`| 排名 | 投标人 | 报价(万元) |`,"|------|--------|----------|");
                    for (const r of d.bid_ranking) {
                      lines.push(`| ${r.rank} | ${r.name} | ¥${r.price.toLocaleString()} |`);
                    }
                  }

                  if (stats.mean !== undefined) {
                    lines.push(``, `## 统计指标`, ``);
                    lines.push(`| 指标 | 值 |`,"|------|-----|");
                    lines.push(`| 均值 | ¥${stats.mean.toLocaleString()} |`);
                    const sd = (stats as any).std_dev ?? (stats as any).std;
                    if (sd !== undefined) lines.push(`| 标准差 | ${sd} |`);
                    if (stats.cv !== undefined) lines.push(`| 离散系数 | ${stats.cv}% (${(stats as any).cv_level || "-"}) |`);
                    lines.push(`| 最小值 | ¥${stats.min?.toLocaleString()} |`);
                    lines.push(`| 最大值 | ¥${stats.max?.toLocaleString()} |`);
                    if (stats.range !== undefined) lines.push(`| 极差 | ¥${stats.range.toLocaleString()} |`);
                  }

                  const discount = (d as any).discount_results;
                  if (discount?.length) {
                    lines.push(``, `## 降价分析`, ``);
                    for (const r of discount) {
                      lines.push(`- ${r.name}: 降幅 ${r.discount_pct}% (${r.strategy})`);
                    }
                  }

                  if ((d as any).ai_analysis) {
                    lines.push(``, `## AI 综合分析`, ``, (d as any).ai_analysis);
                  }

                  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
                  downloadBlob(blob, `opening_${d.id}.md`);
                }}
              >
                <Download className="h-4 w-4" />
                下载报告
              </button>
              <button
                className="px-4 py-2 border rounded hover:bg-muted"
                onClick={() => setOpeningDetail(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 提取结果详情弹窗 --- */}
      {extractDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg max-w-2xl w-full shadow-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">提取结果详情</h3>
              <button
                className="p-2 hover:bg-muted rounded"
                onClick={() => setExtractDetail(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">ID：</span>
                  {extractDetail.id}
                </div>
                <div>
                  <span className="text-muted-foreground">模板类型：</span>
                  <span className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground">
                    {extractDetail.template_type}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">模式：</span>
                  <span className="px-2 py-1 rounded text-xs bg-primary/10 text-primary">
                    {extractDetail.mode}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">创建时间：</span>
                  {formatDate(extractDetail.created_at)}
                </div>
              </div>

              {/* 提取内容 */}
              <div>
                <h4 className="font-semibold mb-2">提取内容</h4>
                <div className="rounded-xl border border-border p-6 max-h-96 overflow-auto">
                  <pre className="whitespace-pre-wrap text-sm">
                    {extractDetail.content}
                  </pre>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 flex items-center gap-2"
                onClick={() => {
                  const blob = new Blob([extractDetail.content], {
                    type: "text/markdown;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `extract_${extractDetail.id}_${extractDetail.template_type}.md`;
                  document.body.appendChild(a);
                  a.click();
                  URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                }}
              >
                <Download className="h-4 w-4" />
                下载 MD
              </button>
              <button
                className="px-4 py-2 border rounded hover:bg-muted"
                onClick={() => setExtractDetail(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}