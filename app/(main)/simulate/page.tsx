"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  Plus,
  Loader2,
  Upload,
  Copy,
  Download,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { PageHeader } from "@/components/layout/PageHeader";
import { TaskProgress } from "@/components/ui/TaskProgress";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useFileStore } from "@/stores/file-store";
import { useTaskStore } from "@/stores/task-store";

// 4 步流程定义
const steps = [
  { key: 1, label: "PDF转换", desc: "将上传文件转换为文本" },
  { key: 2, label: "要素提取", desc: "AI 提取招标文件关键要素" },
  { key: 3, label: "对比分析", desc: "多维度对比分析" },
  { key: 4, label: "模拟编制", desc: "生成模拟投标文件" },
];

const simulatePhases = [
  { key: "connecting", label: "连接服务" },
  { key: "processing", label: "处理中" },
  { key: "generating", label: "AI 生成" },
  { key: "completing", label: "完成" },
];

const projectTypes = [
  { value: "design", label: "设计类" },
  { value: "construction", label: "施工类" },
  { value: "equipment", label: "设备类" },
];

interface TaskData {
  taskId: string;
  currentStep: number;
  status: string;
  fileIds: string[];
  params: Record<string, string>;
  step1Result: string;
  step2Result: string;
  step3Result: string;
  step4Result: string;
}

export default function SimulatePage() {
  const [task, setTask] = useState<TaskData | null>(null);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [runningStep, setRunningStep] = useState<number | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [simPhase, setSimPhase] = useState<string | null>(null);
  const [simPercentage, setSimPercentage] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({ 2: true, 3: true });
  const [params, setParams] = useState({
    project_name: "",
    project_type: "design",
    project_scale: "",
    investment_estimate: "",
    region: "",
    special_requirements: "",
  });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ===========================================================================
  // 持久化：SSE 流式状态跨页面保存
  // ===========================================================================

  // 同步状态到 taskStore（防抖，避免高频 localStorage 写入）
  const simSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (task || isStreaming || streamContent) {
      if (simSyncTimerRef.current) clearTimeout(simSyncTimerRef.current);
      simSyncTimerRef.current = setTimeout(() => {
        useTaskStore.getState().updateSimulate({
          task,
          streamContent,
          isStreaming,
          runningStep,
        });
      }, 200);
    }
    return () => {
      if (simSyncTimerRef.current) clearTimeout(simSyncTimerRef.current);
    };
  }, [task, streamContent, isStreaming, runningStep]);

  // 页面挂载时：恢复状态 + 刷新后端任务数据
  const hasRestored = useRef(false);
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;

    const saved = useTaskStore.getState().simulate;
    if (!saved) return;

    // 恢复任务和流式状态
    setTask(saved.task);
    setStreamContent(saved.streamContent);
    setIsStreaming(saved.isStreaming);
    setRunningStep(saved.runningStep);

    // 如果有 streamContent，展开对应步骤
    if (saved.streamContent && saved.runningStep) {
      setCollapsed((prev) => ({ ...prev, [saved.runningStep!]: false }));
    }

    // 如果之前正在处理中 → 刷新后端状态检查步骤是否已完成
    if (saved.isStreaming && saved.task?.taskId) {
      const timer = setTimeout(async () => {
        try {
          const res = await authFetch(`/api/simulate/${saved.task!.taskId}`);
          const data = await res.json();
          if (data.success && data.data) {
            const t = data.data;
            // 检查是否有新的步骤结果（表示步骤已完成）
            const stepResults = [
              { step: 1, result: t.step1Result },
              { step: 2, result: t.step2Result },
              { step: 3, result: t.step3Result },
              { step: 4, result: t.step4Result },
            ];
            const completedStep = stepResults.find(
              (s) => s.step === saved.runningStep && s.result
            );
            if (completedStep) {
              setStreamContent((prev) =>
                prev + `\n✅ 步骤 ${completedStep.step} 已在后台完成\n`
              );
              setIsStreaming(false);
              setRunningStep(null);
              setTask({
                taskId: t.taskId,
                currentStep: t.currentStep,
                status: t.status,
                fileIds: t.fileIds,
                params: t.params || {},
                step1Result: t.step1Result || "",
                step2Result: t.step2Result || "",
                step3Result: t.step3Result || "",
                step4Result: t.step4Result || "",
              });
            }
          }
        } catch {
          // 静默失败，只是恢复检查
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const { upload } = useFileUpload();
  const { files } = useFileStore();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(file.name);
    await upload(file);
    setUploadingFile(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setUploadingFile(file.name);
    await upload(file);
    setUploadingFile(null);
  };

  const handleCreateTask = async () => {
    // Use uploaded file IDs or mock IDs
    const fileIds = files.length > 0 ? files.map((f) => f.id) : ["mock-file-1"];

    try {
      const res = await authFetch("/api/simulate/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds }),
      });
      const data = await res.json();
      if (data.success) {
        setTask({
          taskId: data.data.taskId,
          currentStep: data.data.currentStep,
          status: data.data.status,
          fileIds: data.data.fileIds,
          params: {},
          step1Result: "",
          step2Result: "",
          step3Result: "",
          step4Result: "",
        });
      }
    } catch (err) {
      console.error("创建任务失败:", err);
    }
  };

  const streamStep = async (stepNum: number, body?: Record<string, unknown>) => {
    if (!task) return;
    setStreamContent("");
    setIsStreaming(true);
    setRunningStep(stepNum);
    setSimPhase("connecting");
    setSimPercentage(null);
    abortRef.current = new AbortController();

    try {
      const res = await authFetch(`/api/simulate/${task.taskId}/step/${stepNum}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        // Step 1 returns JSON, not SSE
        const json = await res.json();
        if (json.success) {
          setTask((prev) =>
            prev ? { ...prev, currentStep: json.data.currentStep, status: json.data.status } : prev
          );
          setStreamContent("✅ PDF转换完成\n");
          setRunningStep(null);
          setIsStreaming(false);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      // Check if this is SSE or JSON
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        if (!res.body) throw new Error("无响应体");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.phase) setSimPhase(event.phase as string);
                if (event.percentage != null) setSimPercentage(event.percentage as number);

                if (event.type === "progress") {
                  if (!event.phase) setSimPhase("processing");
                  setStreamContent((prev) => prev + event.message + "\n");
                } else if (event.type === "content") {
                  if (!simPhase) setSimPhase("generating");
                  setStreamContent((prev) => prev + event.content);
                } else if (event.type === "done") {
                  setSimPhase("completing");
                  setSimPercentage(100);
                  setStreamContent((prev) =>
                    prev + `\n✅ ${event.data?.summary || "步骤完成"}\n`
                  );
                } else if (event.type === "error") {
                  setStreamContent((prev) =>
                    prev + `\n❌ 错误: ${event.data?.message}\n`
                  );
                }
              } catch {
                // skip
              }
            }
          }
        }
      } else {
        // JSON response (Step 1)
        const json = await res.json();
        if (json.success) {
          setTask((prev) =>
            prev ? { ...prev, currentStep: json.data.currentStep, status: json.data.status } : prev
          );
          setStreamContent("✅ PDF转换完成\n");
        }
      }

      setIsStreaming(false);
      setRunningStep(null);

      // Refresh task to get step results
      refreshTask();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStreamContent((prev) => prev + "\n⏹ 已停止\n");
      } else {
        setStreamContent((prev) =>
          prev + `\n❌ 失败: ${err instanceof Error ? err.message : "未知错误"}\n`
        );
      }
      setIsStreaming(false);
      setRunningStep(null);
    }
  };

  const refreshTask = async () => {
    if (!task) return;
    try {
      const res = await authFetch(`/api/simulate/${task.taskId}`);
      const data = await res.json();
      if (data.success) {
        setTask({
          taskId: data.data.taskId,
          currentStep: data.data.currentStep,
          status: data.data.status,
          fileIds: data.data.fileIds,
          params: data.data.params || {},
          step1Result: data.data.step1Result || "",
          step2Result: data.data.step2Result || "",
          step3Result: data.data.step3Result || "",
          step4Result: data.data.step4Result || "",
        });
      }
    } catch {
      // ignore
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setRunningStep(null);
  };

  const copyContent = (text: string) => navigator.clipboard.writeText(text);
  const downloadContent = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const canRunStep = (step: number) => {
    if (!task) return false;
    if (isStreaming) return false;
    if (step === 1) return task.currentStep >= 0;
    return task.currentStep >= step - 1;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title="模拟编制" description="四步引导式生成模拟投标文件" />

      {/* 创建任务区域 */}
      {!task && (
        <>
          <label
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer flex flex-col items-center gap-4",
              isDragging ? "border-primary bg-primary/5" : "hover:border-primary/50"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="sr-only"
              accept=".pdf,.md,.doc,.docx"
              onChange={handleUpload}
            />
            <div className="h-12 w-12 rounded-full bg-primary/10 p-3">
              <Upload className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-lg font-medium">点击上传招标文件</p>
              <p className="text-sm text-muted-foreground">
                支持 PDF、Markdown、Word 格式
              </p>
            </div>
            {uploadingFile && (
              <p className="mt-3 text-sm text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中: {uploadingFile}
              </p>
            )}
            {files.length > 0 && (
              <p className="mt-3 text-sm text-success flex items-center gap-1">
                <CheckCircle className="h-4 w-4" />
                已上传 {files.length} 个文件
              </p>
            )}
          </label>

          <button
            onClick={handleCreateTask}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center justify-center gap-2"
          >
            <Plus className="h-5 w-5" />
            创建模拟任务
          </button>
        </>
      )}

      {/* 步骤指示器 */}
      {task && (
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">任务: {task.taskId}</p>
            <span className="px-3 py-1 bg-primary/10 text-primary rounded text-sm">
              当前: 步骤 {task.currentStep}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                    task.currentStep >= step.key
                      ? "bg-success/10 text-success"
                      : task.currentStep === step.key - 1
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {task.currentStep >= step.key ? <CheckCircle className="h-4 w-4" /> : step.key}
                </div>
                <span className="text-sm font-medium">{step.label}</span>
                {i < steps.length - 1 && (
                  <div className={cn(
                    "w-8 h-[2px]",
                    task.currentStep >= step.key ? "bg-success" : "bg-muted"
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 各步骤操作 */}
      {task && (
        <div className="space-y-4">
          {/* Step 1: PDF转换 */}
          {canRunStep(1) && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="font-semibold mb-2">步骤 1: PDF转换</h2>
              <p className="text-sm text-muted-foreground mb-3">
                将上传的招标文件转换为可处理的文本格式
              </p>
              <button
                onClick={() => streamStep(1)}
                disabled={isStreaming}
                className="px-4 py-2 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {runningStep === 1 ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                开始转换
              </button>
              {task.step1Result && (
                <p className="mt-2 text-sm text-success flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> 转换完成
                </p>
              )}
            </div>
          )}

          {/* Step 2: 提取 */}
          {canRunStep(2) && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="font-semibold mb-2">步骤 2: 要素提取</h2>
              <p className="text-sm text-muted-foreground mb-3">
                AI 从招标文件中提取关键要素（资质、评标办法、业绩等）
              </p>
              <button
                onClick={() => streamStep(2)}
                disabled={isStreaming}
                className="px-4 py-2 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {runningStep === 2 ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                开始提取
              </button>

              {/* 流式内容 */}
              {(isStreaming && runningStep === 2) || streamContent && runningStep === 2 ? (
                <div className="mt-3 space-y-2">
                  {isStreaming && (
                    <TaskProgress
                      phases={simulatePhases}
                      currentPhase={simPhase}
                      percentage={simPercentage}
                      message="AI 正在提取要素..."
                      isActive={isStreaming}
                      isDone={!isStreaming && !!streamContent}
                      showStop
                      onStop={handleStop}
                    />
                  )}
                  <div className="rounded-xl border border-border p-3 max-h-[300px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm">{streamContent}</pre>
                  </div>
                </div>
              ) : null}

              {/* 已完成的结果 */}
              {task.step2Result && !isStreaming && runningStep !== 2 && (
                <details
                  open={!collapsed[2]}
                  className="mt-3"
                >
                  <summary
                    className="cursor-pointer text-sm font-medium flex items-center gap-1"
                    onClick={() => setCollapsed((prev) => ({ ...prev, 2: !prev[2] }))}
                  >
                    {collapsed[2] ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    查看提取结果
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); copyContent(task.step2Result); }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadContent(task.step2Result, "step2_extract.md"); }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </span>
                  </summary>
                  <div className="mt-2 rounded-xl border border-border p-3 max-h-[500px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm">{task.step2Result}</pre>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Step 3: 对比 */}
          {canRunStep(3) && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="font-semibold mb-2">步骤 3: 对比分析</h2>
              <p className="text-sm text-muted-foreground mb-3">
                AI 对提取结果进行六维度对比分析
              </p>
              <button
                onClick={() => streamStep(3)}
                disabled={isStreaming}
                className="px-4 py-2 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {runningStep === 3 ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                开始对比
              </button>

              {(isStreaming && runningStep === 3) || streamContent && runningStep === 3 ? (
                <div className="mt-3 rounded-xl border border-border p-3 max-h-[300px] overflow-auto">
                  <pre className="whitespace-pre-wrap text-sm">{streamContent}</pre>
                  {isStreaming && (
                    <button onClick={handleStop} className="mt-2 px-3 py-1 border rounded text-sm">
                      停止
                    </button>
                  )}
                </div>
              ) : null}

              {task.step3Result && !isStreaming && runningStep !== 3 && (
                <details
                  open={!collapsed[3]}
                  className="mt-3"
                >
                  <summary
                    className="cursor-pointer text-sm font-medium flex items-center gap-1"
                    onClick={() => setCollapsed((prev) => ({ ...prev, 3: !prev[3] }))}
                  >
                    {collapsed[3] ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    查看对比分析结果
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); copyContent(task.step3Result); }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadContent(task.step3Result, "step3_compare.md"); }}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </span>
                  </summary>
                  <div className="mt-2 rounded-xl border border-border p-3 max-h-[600px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm">{task.step3Result}</pre>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Step 4: 编制（参数表单 + SSE） */}
          {canRunStep(4) && (
            <div className="rounded-xl border border-border p-6">
              <h2 className="font-semibold mb-2">步骤 4: 模拟编制</h2>

              {!isStreaming && !task.step4Result && (
                <div className="space-y-3 mb-3">
                  <p className="text-sm text-muted-foreground">
                    填写目标项目参数，AI 将基于对比分析生成模拟投标方案
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">项目名称 *</label>
                      <input
                        className="border rounded px-3 py-2 w-full text-sm"
                        placeholder="例：XX污水处理厂设计项目"
                        value={params.project_name}
                        onChange={(e) => setParams((p) => ({ ...p, project_name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">项目类型 *</label>
                      <select
                        className="border rounded px-3 py-2 w-full text-sm"
                        value={params.project_type}
                        onChange={(e) => setParams((p) => ({ ...p, project_type: e.target.value }))}
                      >
                        {projectTypes.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">项目规模 *</label>
                      <input
                        className="border rounded px-3 py-2 w-full text-sm"
                        placeholder="例：日处理量5万吨"
                        value={params.project_scale}
                        onChange={(e) => setParams((p) => ({ ...p, project_scale: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">投资估算(万元)</label>
                      <input
                        className="border rounded px-3 py-2 w-full text-sm"
                        placeholder="例：8000"
                        value={params.investment_estimate}
                        onChange={(e) => setParams((p) => ({ ...p, investment_estimate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">所属区域</label>
                      <input
                        className="border rounded px-3 py-2 w-full text-sm"
                        placeholder="例：浙江省台州市"
                        value={params.region}
                        onChange={(e) => setParams((p) => ({ ...p, region: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">特殊要求</label>
                      <textarea
                        className="border rounded px-3 py-2 w-full text-sm min-h-[60px]"
                        placeholder="如有特殊要求请填写"
                        value={params.special_requirements}
                        onChange={(e) => setParams((p) => ({ ...p, special_requirements: e.target.value }))}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => streamStep(4, params)}
                    disabled={isStreaming || !params.project_name || !params.project_type || !params.project_scale}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {runningStep === 4 ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    开始编制
                  </button>
                </div>
              )}

              {/* 流式内容 */}
              {(isStreaming && runningStep === 4) || streamContent && runningStep === 4 ? (
                <div className="mt-3 space-y-2">
                  {isStreaming && (
                    <TaskProgress
                      phases={simulatePhases}
                      currentPhase={simPhase}
                      percentage={simPercentage}
                      message="AI 正在生成模拟投标文件..."
                      isActive={isStreaming}
                      isDone={!isStreaming && !!streamContent}
                      showStop
                      onStop={handleStop}
                    />
                  )}
                  <div className="rounded-xl border border-border p-3 max-h-[400px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm">{streamContent}</pre>
                  </div>
                </div>
              ) : null}

              {/* 完成结果 */}
              {task.step4Result && !isStreaming && runningStep !== 4 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium flex items-center gap-1">
                      <CheckCircle className="h-5 w-5 text-success" />
                      模拟编制完成
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyContent(task.step4Result)}
                        className="p-2 hover:bg-muted rounded flex items-center gap-1 text-sm"
                      >
                        <Copy className="h-4 w-4" /> 复制
                      </button>
                      <button
                        onClick={() => downloadContent(task.step4Result, "simulate_result.md")}
                        className="p-2 hover:bg-muted rounded flex items-center gap-1 text-sm"
                      >
                        <Download className="h-4 w-4" /> 下载
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-6 max-h-[800px] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm">{task.step4Result}</pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}