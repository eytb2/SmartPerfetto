import React, { useState } from 'react';
import { PaperAirplaneIcon, CodeBracketIcon } from '@heroicons/react/24/outline';
import { sqlAPI } from '../services/api';

const SqlGenerator = () => {
  const [query, setQuery] = useState('');
  const [generatedSql, setGeneratedSql] = useState('');
  const [explanation, setExplanation] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const examples = [
    '查找所有耗时超过 100ms 的 slice',
    '找出主线程上的所有 ANR',
    '显示内存使用超过 500MB 的进程',
    '列出所有的 GC 事件',
    '查找启动时间超过 3 秒的应用'
  ];

  const handleGenerate = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError('');
    setExplanation('');

    try {
      const response = await sqlAPI.generate(query);
      setGeneratedSql(response.sql);
      setExplanation(response.explanation);
    } catch (error: any) {
      console.error('Error generating SQL:', error);
      setError(error.response?.data?.details || error.message || '生成 SQL 时出错');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-extrabold text-gray-900">
          AI SQL 生成器
        </h1>
        <p className="mt-4 text-lg text-gray-500">
          用自然语言描述您的查询需求，AI 将为您生成准确的 Perfetto SQL
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">输入您的需求</h2>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：查找所有耗时超过 100ms 的 UI 操作"
              className="w-full h-32 p-3 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            />
            <button
              onClick={handleGenerate}
              disabled={!query.trim() || isLoading}
              className="mt-4 w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  生成中...
                </span>
              ) : (
                <span className="flex items-center">
                  <PaperAirplaneIcon className="h-5 w-5 mr-2" />
                  生成 SQL
                </span>
              )}
            </button>
          </div>

          <div className="mt-6 bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold mb-3">示例查询</h3>
            <div className="space-y-2">
              {examples.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="w-full text-left p-3 rounded-md bg-gray-50 hover:bg-gray-100 text-sm text-gray-700"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">生成的 SQL</h2>
              {generatedSql && (
                <button
                  onClick={() => navigator.clipboard.writeText(generatedSql)}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  复制代码
                </button>
              )}
            </div>
            <div className="bg-gray-900 text-gray-100 p-4 rounded-md min-h-[300px] font-mono text-sm overflow-auto">
              {generatedSql || (
                <div className="text-gray-500">
                  <CodeBracketIcon className="h-12 w-12 mx-auto mb-2" />
                  <p className="text-center">生成的 SQL 将显示在这里</p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-red-800 mb-2">错误</h3>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {explanation && (
            <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-green-800 mb-2">查询说明</h3>
              <p className="text-sm text-green-700">{explanation}</p>
            </div>
          )}

          {generatedSql && (
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-800 mb-2">提示</h3>
              <p className="text-sm text-blue-700">
                您可以直接将此 SQL 复制到 Perfetto UI 中执行。建议先在小数据集上测试，
                确保查询结果符合预期后再应用到完整数据集。
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-12">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold mb-4">Perfetto SQL 快速参考</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="border-l-4 border-primary-500 pl-4">
              <h4 className="font-medium text-gray-900">常用表</h4>
              <ul className="mt-2 text-sm text-gray-600 space-y-1">
                <li>• slice - 时间片事件</li>
                <li>• thread - 线程信息</li>
                <li>• process - 进程信息</li>
                <li>• counter - 计数器数据</li>
              </ul>
            </div>
            <div className="border-l-4 border-green-500 pl-4">
              <h4 className="font-medium text-gray-900">时间单位</h4>
              <ul className="mt-2 text-sm text-gray-600 space-y-1">
                <li>• 1 ns = 1e-9 秒</li>
                <li>• 1 μs = 1e-6 秒</li>
                <li>• 1 ms = 1e-3 秒</li>
                <li>• 时间戳：Unix 纳秒</li>
              </ul>
            </div>
            <div className="border-l-4 border-purple-500 pl-4">
              <h4 className="font-medium text-gray-900">常用函数</h4>
              <ul className="mt-2 text-sm text-gray-600 space-y-1">
                <li>• EXTRACT_ARG() - 提取参数</li>
                <li>• SPAN_JOIN() - 连接时间片</li>
                <li>• INTERVAL() - 时间间隔</li>
                <li>• COUNT() - 计数</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SqlGenerator;