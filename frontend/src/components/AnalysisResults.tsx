import React from 'react';
import {
  ChartBarIcon,
  ClockIcon,
  CpuChipIcon,
  ServerIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

interface AnalysisResultsProps {
  insights: string[];
  metrics?: {
    duration: number;
    memoryPeak: number;
    cpuUsage: number;
    frameDrops: number;
  };
  recommendations: string[];
}

const AnalysisResults = ({ insights, metrics, recommendations }: AnalysisResultsProps) => {
  const formatDuration = (nanoseconds: number) => {
    const seconds = nanoseconds / 1_000_000_000;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
  };

  const formatMemory = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  return (
    <div className="space-y-6">
      {/* 关键指标 */}
      {metrics && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <ChartBarIcon className="h-5 w-5 mr-2" />
            关键指标
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <ClockIcon className="h-8 w-8 mx-auto text-blue-500 mb-2" />
              <div className="text-2xl font-bold text-gray-900">
                {formatDuration(metrics.duration)}
              </div>
              <div className="text-sm text-gray-500">总时长</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <ServerIcon className="h-8 w-8 mx-auto text-purple-500 mb-2" />
              <div className="text-2xl font-bold text-gray-900">
                {formatMemory(metrics.memoryPeak)}
              </div>
              <div className="text-sm text-gray-500">内存峰值</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <CpuChipIcon className="h-8 w-8 mx-auto text-green-500 mb-2" />
              <div className="text-2xl font-bold text-gray-900">
                {metrics.cpuUsage}%
              </div>
              <div className="text-sm text-gray-500">CPU 使用率</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <ExclamationTriangleIcon className="h-8 w-8 mx-auto text-red-500 mb-2" />
              <div className="text-2xl font-bold text-gray-900">
                {metrics.frameDrops}
              </div>
              <div className="text-sm text-gray-500">掉帧数</div>
            </div>
          </div>
        </div>
      )}

      {/* 发现的问题 */}
      {insights && insights.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <ExclamationTriangleIcon className="h-5 w-5 mr-2 text-red-500" />
            发现的问题
          </h3>
          <div className="space-y-3">
            {insights.map((insight, index) => (
              <div key={index} className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-red-100">
                    <span className="text-red-600 text-sm font-medium">{index + 1}</span>
                  </div>
                </div>
                <p className="ml-3 text-gray-700">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 优化建议 */}
      {recommendations && recommendations.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <CheckCircleIcon className="h-5 w-5 mr-2 text-green-500" />
            优化建议
          </h3>
          <div className="space-y-3">
            {recommendations.map((recommendation, index) => (
              <div key={index} className="flex items-start">
                <CheckCircleIcon className="h-5 w-5 text-green-500 mt-0.5 mr-2 flex-shrink-0" />
                <p className="text-gray-700">{recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 性能评分 */}
      {metrics && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4">性能评分</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">整体性能</span>
                <span className="text-sm font-medium text-gray-900">85/100</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: '85%' }}
                ></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">A</div>
                <div className="text-sm text-gray-500">响应速度</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">B</div>
                <div className="text-sm text-gray-500">内存效率</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">A-</div>
                <div className="text-sm text-gray-500">稳定性</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalysisResults;