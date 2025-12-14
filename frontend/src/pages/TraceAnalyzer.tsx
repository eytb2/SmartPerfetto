import React, { useState, useRef } from 'react';
import { CloudArrowUpIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { traceAPI } from '../services/api';
import PerfettoUIEmbed from '../components/PerfettoUI/PerfettoUIEmbed';

const TraceAnalyzer = () => {
  const [traceFile, setTraceFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileId, setUploadedFileId] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [messages, setMessages] = useState<Array<{type: 'user' | 'assistant', content: string}>>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleQueryGenerated = (query: string) => {
    setCurrentQuery(query);
    // 可以在这里将查询发送到 PerfettoViewer
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && (file.name.endsWith('.perfetto') || file.name.endsWith('.trace'))) {
      setTraceFile(file);
    } else {
      alert('请选择有效的 .perfetto 或 .trace 文件');
    }
  };

  const handleUpload = async () => {
    if (!traceFile) return;

    setIsUploading(true);
    try {
      const response = await traceAPI.upload(traceFile);
      setUploadedFileId(response.fileId);
      setUploadedFileName(response.fileName);
      setMessages([{
        type: 'assistant',
        content: `已成功加载 trace 文件：${response.fileName}\n\n文件大小：${(response.fileSize / 1024 / 1024).toFixed(2)} MB\n\n请问您想要分析什么？例如：\n- 找出所有的卡顿点\n- 分析内存使用情况\n- 查看 CPU 使用率峰值`
      }]);
    } catch (error: any) {
      console.error('Error uploading file:', error);
      alert(error.response?.data?.details || error.message || '上传文件时出错');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!currentMessage.trim() || !uploadedFileId) return;

    const userMessage = currentMessage;
    setCurrentMessage('');
    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);

    try {
      const response = await traceAPI.analyze(uploadedFileId, userMessage);
      const analysis = response.analysis;

      let assistantMessage = `根据您的请求："${userMessage}"，我为您分析了 trace 数据：\n\n`;

      if (analysis.insights && analysis.insights.length > 0) {
        assistantMessage += '📊 发现的问题：\n';
        analysis.insights.forEach((insight, index) => {
          assistantMessage += `${index + 1}. ${insight}\n`;
        });
        assistantMessage += '\n';
      }

      if (analysis.sqlQueries && analysis.sqlQueries.length > 0) {
        assistantMessage += '🔍 生成的 SQL 查询：\n';
        analysis.sqlQueries.forEach((sql, index) => {
          assistantMessage += `\n查询 ${index + 1}:\n\`\`\`sql\n${sql}\n\`\`\`\n`;
        });
        assistantMessage += '\n';
      }

      if (analysis.recommendations && analysis.recommendations.length > 0) {
        assistantMessage += '💡 优化建议：\n';
        analysis.recommendations.forEach((rec, index) => {
          assistantMessage += `${index + 1}. ${rec}\n`;
        });
      }

      setMessages(prev => [...prev, { type: 'assistant', content: assistantMessage }]);
    } catch (error: any) {
      console.error('Error analyzing trace:', error);
      setMessages(prev => [...prev, {
        type: 'assistant',
        content: '抱歉，分析时出错：' + (error.response?.data?.details || error.message)
      }]);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-extrabold text-gray-900">
          Trace 智能分析
        </h1>
        <p className="mt-4 text-lg text-gray-500">
          上传您的 Perfetto trace 文件，通过 AI 对话式分析快速定位性能问题
        </p>
      </div>

      {!traceFile ? (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-8">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-primary-500 transition-colors"
            >
              <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <p className="text-lg font-medium text-gray-900">点击上传 trace 文件</p>
                <p className="text-sm text-gray-500 mt-1">支持 .perfetto 格式，最大 2GB</p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".perfetto"
              onChange={handleFileSelect}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h3 className="font-semibold mb-2">文件信息</h3>
              <p className="text-sm text-gray-600">{traceFile.name}</p>
              <p className="text-sm text-gray-500">{(traceFile.size / 1024 / 1024).toFixed(2)} MB</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 text-sm text-primary-600 hover:text-primary-700"
              >
                重新上传
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".perfetto"
                onChange={handleFileSelect}
              />
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="font-semibold mb-4 flex items-center">
                <ChatBubbleLeftRightIcon className="h-5 w-5 mr-2" />
                AI 分析助手
              </h3>
              <div className="h-96 flex flex-col">
                <div className="flex-1 overflow-y-auto mb-4 space-y-3">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-lg ${
                        message.type === 'user'
                          ? 'bg-primary-100 ml-8'
                          : 'bg-gray-100 mr-8'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="询问关于 trace 的任何问题..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700"
                  >
                    发送
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <PerfettoUIEmbed
              traceUrl={uploadedFileId ? `/api/trace/${uploadedFileId}/download` : undefined}
              onQueryGenerated={handleQueryGenerated}
              initialQuery={currentQuery}
              mode="analyze"
              height="800px"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default TraceAnalyzer;