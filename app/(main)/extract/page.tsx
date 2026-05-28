'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  FileSearch,
  BarChart3,
  Shield,
  Loader2,
  Copy,
  Download,
  CheckCircle2,
  Clock,
  FileText,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { authFetch, authFetchSSE } from '@/lib/auth-fetch';
import { PageHeader } from '@/components/layout/PageHeader';
import { TabNavigation } from '@/components/ui/TabNavigation';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useFileStore } from '@/stores/file-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { mockFiles } from '@/data/mock/providers';
import { listFiles } from '@/lib/data-api';

// 提取阶段定义
const extractPhases = [
  { key: 'reading', label: '读取文档', icon: FileText },
  { key: 'parsing', label: '解析内容', icon: FileSearch },
  { key: 'analyzing', label: 'AI 分析', icon: Sparkles },
  { key: 'extracting', label: '提取要素', icon: CheckCircle2 },
];

// 要素类别
const elementCategories = [
  {
    group: '基本信息',
    items: [{ id: 'basic_info', label: '项目基本信息' }],
  },
  {
    group: '门槛要求',
    items: [
      { id: 'qualification', label: '资质要求' },
      { id: 'experience', label: '业绩要求' },
      { id: 'personnel', label: '人员要求' },
    ],
  },
  {
    group: '评标办法',
    items: [
      { id: 'evaluation_method', label: '评标办法' },
      { id: 'scoring_details', label: '分值分配与评分细则' },
    ],
  },
  {
    group: '商务条款',
    items: [
      { id: 'selection_method', label: '定标方法' },
      { id: 'contract_terms', label: '合同条款' },
    ],
  },
];

const allElementIds = elementCategories.flatMap(g => g.items.map(i => i.id));

const outputTemplates = [
  { value: 'standard', label: '标准要素' },
  { value: 'brief', label: '简版速查' },
];

interface ExtractedElement {
  name: string;
  content: string;
}

const isRealReadyFile = (file: { id: string; status: string }) =>
  file.status === 'ready' && !file.id.startsWith('temp-');

export default function ExtractPage() {
  const [activeTab, setActiveTab] = useState('single');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('standard');
  const [selectedElements, setSelectedElements] = useState<string[]>(allElementIds);
  const [selectAll, setSelectAll] = useState(true);
  const [thresholdText, setThresholdText] = useState('');

  // SSE 进度状态
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState('');
  const [extractedElements, setExtractedElements] = useState<ExtractedElement[]>([]);
  const [streamRawText, setStreamRawText] = useState('');
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [percentage, setPercentage] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ===========================================================================
  // 持久化：页面卸载时将任务状态保存到 taskStore，返回时恢复
  // ===========================================================================

  // 将关键状态同步到 taskStore（防抖，避免高频 localStorage 写入阻塞主线程）
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isStreaming || isDone || errorMessage || extractedElements.length > 0) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        useTaskStore.getState().updateExtract({
          isStreaming,
          currentPhase,
          progressMessage,
          extractedElements,
          streamRawText,
          isDone,
          errorMessage,
          selectedFileId,
          activeTab,
        });
      }, 200);
    }
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [
    isStreaming,
    currentPhase,
    progressMessage,
    extractedElements,
    streamRawText,
    isDone,
    errorMessage,
    selectedFileId,
    activeTab,
  ]);

  // 页面挂载时：检查 taskStore 中是否有未完成的任务，恢复 UI 状态
  useEffect(() => {
    const saved = useTaskStore.getState().extract;
    if (!saved) return;

    if (saved.selectedFileId?.startsWith('temp-')) {
      useTaskStore.getState().clearExtract();
      setErrorMessage('文件上传未完成，请重新上传后再提取');
      setIsStreaming(false);
      return;
    }

    // 恢复文件选择、Tab 等交互状态
    if (saved.selectedFileId) setSelectedFileId(saved.selectedFileId);
    setActiveTab(saved.activeTab);

    // 恢复提取结果展示状态
    setIsStreaming(saved.isStreaming);
    setCurrentPhase(saved.currentPhase);
    setProgressMessage(saved.progressMessage);
    setExtractedElements(saved.extractedElements);
    setStreamRawText(saved.streamRawText);
    setIsDone(saved.isDone);
    setErrorMessage(saved.errorMessage);

    // 如果任务之前正在处理但未完成（切换页面导致 SSE 断开），轮询后端检查是否已完成
    if (saved.isStreaming && !saved.isDone && !saved.errorMessage && saved.selectedFileId) {
      let retryCount = 0;
      const maxRetries = 30;

      const poll = async () => {
        try {
          const res = await authFetch(`/api/extract/result/by-file/${saved.selectedFileId}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.status === 401) {
            setErrorMessage('登录已失效，请重新登录');
            setIsStreaming(false);
            useTaskStore.getState().clearExtract();
            return;
          }
          if (!res.ok) {
            retryCount++;
            if (retryCount < maxRetries) setTimeout(poll, 1000);
            return;
          }
          const data = await res.json();
          if (data.success && data.data) {
            const content = data.data.content || '';
            try {
              const parsed = JSON.parse(content);
              const elements = parsed.elements || [];
              if (elements.length > 0) {
                setExtractedElements(
                  elements.map((e: { name?: string; content?: string }) => ({
                    name: e.name || '未知要素',
                    content: e.content || '',
                  }))
                );
              }
            } catch {
              setStreamRawText(prev => prev || content);
            }
            const isBackground =
              data.data.status === 'completed_background' ||
              data.data.status === 'completed_disconnected' ||
              data.data.status === 'partial';
            setProgressMessage(isBackground ? 'AI 分析在后台已完成' : '提取完成');
            setIsDone(true);
            setIsStreaming(false);
            setCurrentPhase('extracting');
            useTaskStore.getState().updateExtract({
              isStreaming: false,
              currentPhase: 'extracting',
              progressMessage: isBackground ? 'AI 分析在后台已完成' : '提取完成',
              extractedElements: useTaskStore.getState().extract?.extractedElements || [],
              streamRawText: useTaskStore.getState().extract?.streamRawText || '',
              isDone: true,
              errorMessage: null,
              selectedFileId: saved.selectedFileId,
              activeTab: saved.activeTab,
            });
            return;
          }
          retryCount++;
          if (retryCount < maxRetries) setTimeout(poll, 1000);
        } catch {
          retryCount++;
          if (retryCount < maxRetries) setTimeout(poll, 1000);
        }
      };

      const timer = setTimeout(poll, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { upload } = useFileUpload({
    onSuccess: fileId => setSelectedFileId(fileId),
  });
  const { files, addFile } = useFileStore();
  const { activeProvider, activeModel } = useSettingsStore();

  // 从后端加载真实文件列表
  useEffect(() => {
    listFiles({ page: 1, page_size: 50 })
      .then(res => {
        // 将后端文件同步到 fileStore（用于 extract 页面选择文件）
        for (const f of res.files) {
          addFile({
            id: f.id,
            name: f.original_name,
            size: f.size,
            mimeType: f.type,
            category: 'tender',
            status: 'ready',
            createdAt: f.created_at || new Date().toISOString(),
          });
        }
      })
      .catch(() => {
        /* 静默失败，显示空列表 */
      });
  }, [addFile]);

  const displayFiles = (files.length > 0 ? files : mockFiles).filter(isRealReadyFile);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await upload(file);
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
    if (file) await upload(file);
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    setSelectedElements(checked ? allElementIds : []);
  };

  const handleSelectElement = (id: string) => {
    setSelectedElements(prev => {
      const next = prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id];
      setSelectAll(next.length === allElementIds.length);
      return next;
    });
  };

  const toggleFileSelection = (id: string) => {
    setSelectedFileIds(prev =>
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  const readyFiles = displayFiles;

  const resetExtractionState = () => {
    setCurrentPhase(null);
    setProgressMessage('');
    setExtractedElements([]);
    setStreamRawText('');
    setIsDone(false);
    setErrorMessage(null);
    setPercentage(null);
    useTaskStore.getState().clearExtract();
  };

  const handleExtract = async () => {
    if (!selectedFileId) return;
    resetExtractionState();
    setIsStreaming(true);
    setCurrentPhase('reading');
    setProgressMessage('正在连接服务...');
    abortRef.current = new AbortController();

    try {
      const response = await authFetchSSE('/api/extract/element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          provider: activeProvider,
          model: activeModel,
          template_type:
            activeTab === 'batch'
              ? 'batch'
              : activeTab === 'threshold'
                ? 'threshold'
                : selectedTemplate,
          elements: selectedElements,
          mode: activeTab,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        setErrorMessage(`请求失败: HTTP ${response.status}`);
        setIsStreaming(false);
        return;
      }

      await readSSEStream(response);
      setIsStreaming(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressMessage('已手动停止');
      } else {
        setErrorMessage(err instanceof Error ? err.message : '未知错误');
      }
      setIsStreaming(false);
    }
  };

  // SSE 事件解析（单文件/批量/门槛 共用）
  const processSSEEvent = useCallback((event: Record<string, unknown>) => {
    if (event.phase) setCurrentPhase(event.phase as string);
    if (event.percentage != null) setPercentage(event.percentage as number);

    if (event.type === 'progress') {
      if (!event.phase) setCurrentPhase('parsing');
      setProgressMessage((event.message as string) || '');
    } else if (event.type === 'llm_progress') {
      if (!event.phase) setCurrentPhase('analyzing');
      setProgressMessage((event.message as string) || 'AI 正在分析...');
    } else if (event.type === 'element') {
      if (!event.phase) setCurrentPhase('extracting');
      const elem = (event.data || event) as Record<string, unknown>;
      setExtractedElements(prev => [
        ...prev,
        { name: (elem.name as string) || '未知要素', content: (elem.content as string) || '' },
      ]);
      setStreamRawText(prev => prev + `## ${elem.name}\n${elem.content}\n\n`);
    } else if (event.type === 'done') {
      if (!event.phase) setCurrentPhase('extracting');
      setIsDone(true);
      setPercentage(100);
      setProgressMessage(
        ((event.data as Record<string, unknown>)?.summary as string) || '提取完成'
      );
    } else if (event.type === 'error') {
      setErrorMessage(((event.data as Record<string, unknown>)?.message as string) || '提取失败');
    }
  }, []);

  // 通用 SSE 流读取
  const readSSEStream = useCallback(
    async (response: Response) => {
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedDone = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'done') receivedDone = true;
              processSSEEvent(event);
            } catch {
              // 跳过无法解析的行
            }
          }
        }
      } catch {
        // SSE 流中断（Vercel 超时等），不设为错误，后端会保存结果
        if (!receivedDone) {
          setProgressMessage('连接中断，AI 可能在后台继续处理，请稍后刷新查看结果');
          setIsStreaming(false);
        }
        return;
      }

      // 流正常结束但没有收到 done 事件
      if (!receivedDone) {
        setProgressMessage('分析可能尚未完成，请稍后刷新查看结果');
        setIsStreaming(false);
      }
    },
    [processSSEEvent]
  );

  const handleBatchExtract = async () => {
    if (selectedFileIds.length < 2) return;
    resetExtractionState();
    setIsStreaming(true);
    setCurrentPhase('reading');
    setProgressMessage(`正在连接服务（${selectedFileIds.length} 个文件）...`);
    abortRef.current = new AbortController();

    try {
      const response = await authFetchSSE('/api/extract/element/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileIds: selectedFileIds,
          provider: activeProvider,
          model: activeModel,
          elements: selectedElements,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        setErrorMessage(`请求失败: HTTP ${response.status}`);
        setIsStreaming(false);
        return;
      }

      await readSSEStream(response);
      setIsStreaming(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressMessage('已手动停止');
      } else {
        setErrorMessage(err instanceof Error ? err.message : '未知错误');
      }
      setIsStreaming(false);
    }
  };

  const handleThresholdExtract = async () => {
    if (!selectedFileId || !thresholdText.trim()) return;
    resetExtractionState();
    setIsStreaming(true);
    setCurrentPhase('reading');
    setProgressMessage('正在连接服务...');
    abortRef.current = new AbortController();

    try {
      const response = await authFetchSSE('/api/extract/element/threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          userQualifications: thresholdText,
          provider: activeProvider,
          model: activeModel,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        setErrorMessage(`请求失败: HTTP ${response.status}`);
        setIsStreaming(false);
        return;
      }

      await readSSEStream(response);
      setIsStreaming(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgressMessage('已手动停止');
      } else {
        setErrorMessage(err instanceof Error ? err.message : '未知错误');
      }
      setIsStreaming(false);
    }
  };

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setProgressMessage('已手动停止');
  }, []);

  const handleCopy = useCallback(
    () => navigator.clipboard.writeText(streamRawText),
    [streamRawText]
  );

  const handleDownload = useCallback(() => {
    const blob = new Blob([streamRawText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extract_result.md';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, [streamRawText]);

  const tabs = [
    { key: 'single', label: '单文件提取', icon: FileSearch },
    { key: 'batch', label: '批量对比', icon: BarChart3 },
    { key: 'threshold', label: '门槛分析', icon: Shield },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title="要素提取" description="上传招标文件，AI 按用户要求自动提取关键要素" />

      {/* Tab 导航 */}
      <TabNavigation tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* 上传区域 — input 在 label 外部，用 htmlFor 原生关联，最可靠的跨浏览器方案 */}
      <input
        type="file"
        id="extract-file-input"
        ref={fileInputRef}
        data-testid="file-input"
        className="file-sr-only"
        accept=".pdf,.md,.doc,.docx,.xlsx,.xls"
        onChange={handleUpload}
      />
      <label
        htmlFor="extract-file-input"
        className={cn(
          'border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer flex flex-col items-center gap-4',
          isDragging ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="h-12 w-12 rounded-full bg-primary/10 p-3">
          <Upload className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-lg font-medium">点击或拖拽文件到此区域</p>
          <p className="text-sm text-muted-foreground">
            支持 PDF、Markdown、Word、Excel（最大 50MB）
          </p>
        </div>
      </label>

      {/* 文件列表 + 选项区 分栏布局（单文件提取模式） */}
      {activeTab === 'single' && displayFiles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 左：文件列表 */}
          <div className="md:col-span-1">
            <div className="rounded-xl border border-border">
              <div className="p-4 border-b bg-muted/50">
                <h2 className="font-semibold text-sm">已上传文件</h2>
              </div>
              <div className="divide-y">
                {displayFiles.map(file => (
                  <div
                    key={file.id}
                    data-testid="file-item"
                    data-file-status={file.status}
                    className={cn(
                      'p-3 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors',
                      selectedFileId === file.id && 'bg-primary/5'
                    )}
                    onClick={() => setSelectedFileId(file.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileSearch className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="font-medium text-sm truncate">{file.name}</p>
                    </div>
                    <span
                      className={cn(
                        'px-2 py-1 rounded text-xs shrink-0',
                        file.status === 'ready'
                          ? 'bg-success/10 text-success'
                          : 'bg-warning/10 text-warning'
                      )}
                    >
                      {file.status === 'ready' ? '就绪' : '处理中'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右：选项区 + 操作按钮 */}
          {selectedFileId && (
            <div className="md:col-span-2 space-y-4">
              <div className="rounded-xl border border-border p-6">
                <label className="text-sm text-muted-foreground mb-2 block">输出模板</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={selectedTemplate}
                  onChange={e => setSelectedTemplate(e.target.value)}
                >
                  {outputTemplates.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-border p-6">
                <div className="flex items-center gap-3 mb-4">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={e => handleSelectAll(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">提取全部要素</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {elementCategories.map(cat => (
                    <div key={cat.group}>
                      <p className="text-sm text-muted-foreground mb-2">{cat.group}</p>
                      <div className="space-y-2">
                        {cat.items.map(item => (
                          <label key={item.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedElements.includes(item.id)}
                              onChange={() => handleSelectElement(item.id)}
                              className="w-4 h-4"
                            />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                data-testid="extract-button"
                onClick={handleExtract}
                disabled={isStreaming || selectedElements.length === 0}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
              >
                {isStreaming ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    提取中...
                  </>
                ) : (
                  <>
                    <FileSearch className="h-5 w-5" />
                    开始提取要素
                  </>
                )}
              </button>

              {isStreaming && (
                <button
                  data-testid="stop-button"
                  onClick={handleStop}
                  className="w-full py-2 border rounded-lg text-muted-foreground hover:bg-muted"
                >
                  停止提取
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 批量对比 Tab */}
      {activeTab === 'batch' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border">
            <div className="p-4 border-b bg-muted/50">
              <h2 className="font-semibold">选择要对比的文件（至少 2 个）</h2>
            </div>
            <div className="divide-y">
              {readyFiles.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  还没有已上传的文件，请先在顶部上传
                </div>
              ) : (
                readyFiles.map(file => (
                  <div
                    key={file.id}
                    className={cn(
                      'p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors',
                      selectedFileIds.includes(file.id) && 'bg-primary/5'
                    )}
                    onClick={() => toggleFileSelection(file.id)}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedFileIds.includes(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        className="w-4 h-4"
                        onClick={e => e.stopPropagation()}
                      />
                      <FileSearch className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded text-xs bg-success/10 text-success">
                      就绪
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={e => handleSelectAll(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="font-medium">对比全部要素</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {elementCategories.map(cat => (
                <div key={cat.group}>
                  <p className="text-sm text-muted-foreground mb-2">{cat.group}</p>
                  <div className="space-y-2">
                    {cat.items.map(item => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedElements.includes(item.id)}
                          onChange={() => handleSelectElement(item.id)}
                          className="w-4 h-4"
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            data-testid="batch-button"
            onClick={handleBatchExtract}
            disabled={isStreaming || selectedFileIds.length < 2 || selectedElements.length === 0}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isStreaming ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                对比分析中...
              </>
            ) : (
              <>
                <BarChart3 className="h-5 w-5" />
                开始批量对比（已选 {selectedFileIds.length} 个文件）
              </>
            )}
          </button>

          {isStreaming && (
            <button
              onClick={handleStop}
              className="w-full py-2 rounded-xl border border-border text-muted-foreground hover:bg-muted"
            >
              停止分析
            </button>
          )}
        </div>
      )}

      {/* 门槛分析 Tab */}
      {activeTab === 'threshold' && selectedFileId && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-6">
            <label className="text-sm text-muted-foreground mb-2 block">填写自身资质条件</label>
            <textarea
              data-testid="threshold-textarea"
              className="w-full border rounded p-3 text-sm min-h-[120px]"
              placeholder="请输入您的资质、业绩、人员信息，系统将对比招标文件要求进行匹配分析..."
              value={thresholdText}
              onChange={e => setThresholdText(e.target.value)}
            />
          </div>
          <button
            data-testid="threshold-button"
            onClick={handleThresholdExtract}
            disabled={isStreaming || !thresholdText.trim()}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isStreaming ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                分析中...
              </>
            ) : (
              <>
                <Shield className="h-5 w-5" />
                开始门槛分析
              </>
            )}
          </button>

          {isStreaming && (
            <button
              onClick={handleStop}
              className="w-full py-2 rounded-xl border border-border text-muted-foreground hover:bg-muted"
            >
              停止分析
            </button>
          )}
        </div>
      )}

      {/* 门槛分析无需文件选中提示 */}
      {activeTab === 'threshold' && !selectedFileId && (
        <div className="rounded-xl border border-border p-8 text-center text-muted-foreground text-sm">
          请先在顶部上传并选择一个招标文件
        </div>
      )}

      {/* === 提取进度指示器 === */}
      {(isStreaming || isDone || errorMessage) && (
        <TaskProgress
          phases={extractPhases}
          currentPhase={currentPhase}
          percentage={percentage}
          message={progressMessage}
          isActive={isStreaming}
          isDone={isDone}
          errorMessage={errorMessage}
          showStop={isStreaming}
          onStop={handleStop}
        />
      )}

      {/* === 提取要素卡片展示 === */}
      {(extractedElements.length > 0 || (isDone && streamRawText)) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">提取结果（{extractedElements.length > 0 ? extractedElements.length : 1} 个要素）</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="p-2 hover:bg-muted rounded flex items-center gap-1 text-sm"
                title="复制"
              >
                <Copy className="h-4 w-4" />
                复制
              </button>
              <button
                onClick={handleDownload}
                className="p-2 hover:bg-muted rounded flex items-center gap-1 text-sm"
                title="下载 MD"
              >
                <Download className="h-4 w-4" />
                下载
              </button>
            </div>
          </div>

          {/* 结构化卡片 */}
          {extractedElements.length > 0 && (
          <div className="grid gap-4">
            {extractedElements.map((elem, idx) => (
              <div
                key={idx}
                data-testid="element-card"
                className="border border-rounded-xl border border-border overflow-hidden bg-card"
              >
                <div className="px-4 py-3 bg-muted border-b border-border flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground">{elem.name}</span>
                </div>
                <div className="p-4 max-h-[400px] overflow-auto">
                  <div className="markdown-body text-sm">{elem.content}</div>
                </div>
              </div>
            ))}
          </div>
          )}

          {/* 无结构化要素时显示原始文本 */}
          {extractedElements.length === 0 && streamRawText && (
          <div className="rounded-xl border border-border overflow-hidden bg-card">
            <div className="px-4 py-3 bg-muted border-b border-border">
              <span className="font-medium text-sm text-foreground">分析结果</span>
            </div>
            <div className="p-4 max-h-[600px] overflow-auto">
              <div className="markdown-body text-sm whitespace-pre-wrap">{streamRawText}</div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* 原始流式文本（可选展开） */}
      {streamRawText && extractedElements.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="p-3 bg-muted/50 cursor-pointer text-sm text-muted-foreground">
            查看原始输出
          </summary>
          <div className="p-4 max-h-[300px] overflow-auto">
            <div className="markdown-body text-sm">{streamRawText}</div>
          </div>
        </details>
      )}
    </div>
  );
}
