import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  DocumentArrowDownIcon,
  PlayIcon,
  PauseIcon
} from '@heroicons/react/24/outline';

interface PerfettoViewerProps {
  traceUrl?: string;
  onQueryGenerated?: (query: string) => void;
  onSliceSelected?: (slice: any) => void;
  initialQuery?: string;
}

const PerfettoViewer = ({
  traceUrl,
  onQueryGenerated,
  onSliceSelected,
  initialQuery
}: PerfettoViewerProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentQuery, setCurrentQuery] = useState(initialQuery || '');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 加载 Perfetto UI script
    const script = document.createElement('script');
    script.src = 'https://ui.perfetto.dev/v3.1/perfetto.js';
    script.async = true;
    document.body.appendChild(script);

    script.onload = () => {
      if (containerRef.current && window.PerfettoEngine) {
        // 初始化 Perfetto Engine
        const engine = new window.PerfettoEngine(containerRef.current);

        if (traceUrl) {
          // 加载 trace 文件
          engine.openTraceFromUrl(traceUrl).then(() => {
            console.log('Trace loaded successfully');
          }).catch(err => {
            console.error('Error loading trace:', err);
          });
        }
      }
    };

    return () => {
      document.body.removeChild(script);
    };
  }, [traceUrl]);

  const handleFullscreen = () => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  const handleQuerySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onQueryGenerated && currentQuery.trim()) {
      onQueryGenerated(currentQuery);
    }
  };

  const handleExport = () => {
    // 导出分析结果
    const exportData = {
      timestamp: new Date().toISOString(),
      query: currentQuery,
      // 添加其他导出数据
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perfetto-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    // 控制动画播放
  };

  return (
    <div className={`bg-white rounded-lg shadow-md ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="text-lg font-semibold">Perfetto 视图</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePlayPause}
            className="p-2 rounded-md hover:bg-gray-100"
            title={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
          </button>
          <button
            onClick={handleFullscreen}
            className="p-2 rounded-md hover:bg-gray-100"
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? (
              <ArrowsPointingInIcon className="h-5 w-5" />
            ) : (
              <ArrowsPointingOutIcon className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={handleExport}
            className="p-2 rounded-md hover:bg-gray-100"
            title="导出分析"
          >
            <DocumentArrowDownIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* SQL 查询输入框 */}
      <div className="p-4 border-b bg-gray-50">
        <form onSubmit={handleQuerySubmit} className="flex gap-2">
          <input
            type="text"
            value={currentQuery}
            onChange={(e) => setCurrentQuery(e.target.value)}
            placeholder="输入 SQL 查询或使用左侧 AI 生成..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700"
          >
            运行查询
          </button>
        </form>
      </div>

      {/* Perfetto UI 容器 */}
      <div
        ref={containerRef}
        className="h-[600px] bg-gray-900"
        style={{ minHeight: '400px' }}
      >
        <div className="flex items-center justify-center h-full text-gray-500">
          <div className="text-center">
            <svg className="animate-spin h-12 w-12 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p>正在加载 Perfetto UI...</p>
            <p className="text-sm mt-2">请稍候，首次加载可能需要一些时间</p>
          </div>
        </div>
      </div>

      {/* 结果面板 */}
      <div className="p-4 border-t">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">总事件数:</span>
            <span className="ml-2 font-medium">-</span>
          </div>
          <div>
            <span className="text-gray-500">时间范围:</span>
            <span className="ml-2 font-medium">-</span>
          </div>
          <div>
            <span className="text-gray-500">进程数:</span>
            <span className="ml-2 font-medium">-</span>
          </div>
          <div>
            <span className="text-gray-500">线程数:</span>
            <span className="ml-2 font-medium">-</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// 扩展 Window 接口
declare global {
  interface Window {
    PerfettoEngine?: any;
  }
}

export default PerfettoViewer;