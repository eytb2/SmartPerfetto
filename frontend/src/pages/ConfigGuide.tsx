import React, { useState } from 'react';
import { MagnifyingGlassIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

const ConfigGuide = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = [
    { id: 'all', name: '全部配置' },
    { id: 'android', name: 'Android' },
    { id: 'linux', name: 'Linux' },
    { id: 'chrome', name: 'Chrome' },
    { id: 'custom', name: '自定义' }
  ];

  const configs = [
    {
      category: 'android',
      name: 'CPU Usage',
      description: '收集 CPU 使用率和调度信息',
      config: `{
  "buffers": [{
    "size": 4096,
    "fillPolicy": "ring_buffer"
  }],
  "dataSources": [{
    "name": "linux.process_stats",
    "config": {
      "processStats": {
        "scanAllProcessesOnStart": true
      }
    }
  }]
}`,
      commonUse: true
    },
    {
      category: 'android',
      name: 'Memory Allocations',
      description: '跟踪内存分配情况',
      config: `{
  "buffers": [{
    "size": 8192,
    "fillPolicy": "ring_buffer"
  }],
  "dataSources": [{
    "name": "heapprofd",
    "config": {
      "targetPid": 1234,
      "samplingIntervalBytes": 4096
    }
  }]
}`,
      commonUse: true
    },
    {
      category: 'android',
      name: 'GPU Profiling',
      description: 'GPU 渲染性能分析',
      config: `{
  "buffers": [{
    "size": 4096
  }],
  "dataSources": [{
    "name": "android.gpu.renderstages",
    "config": {}
  }]
}`,
      commonUse: false
    },
    {
      category: 'android',
      name: 'Android App Startups',
      description: '应用启动性能分析',
      config: `{
  "buffers": [{
    "size": 65536
  }],
  "dataSources": [{
    "name": "android.app.startup",
    "config": {}
  }]
}`,
      commonUse: true
    },
    {
      category: 'linux',
      name: 'System Calls',
      description: '系统调用跟踪',
      config: `{
  "buffers": [{
    "size": 4096
  }],
  "dataSources": [{
    "name": "linux.syscalls",
    "config": {
      "syscalls": ["open", "read", "write", "close"]
    }
  }]
}`,
      commonUse: false
    },
    {
      category: 'chrome',
      name: 'Chrome Categories',
      description: 'Chrome 浏览器性能事件',
      config: `{
  "buffers": [{
    "size": 8192
  }],
  "dataSources": [{
    "name": "org.chromium.trace_events",
    "config": {
      "chromeConfig": {
        "traceConfig": {
          "includedCategories": ["*"]
        }
      }
    }
  }]
}`,
      commonUse: false
    }
  ];

  const filteredConfigs = configs.filter(config => {
    const matchesCategory = selectedCategory === 'all' || config.category === selectedCategory;
    const matchesSearch = config.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         config.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-extrabold text-gray-900">
          Perfetto Config 指南
        </h1>
        <p className="mt-4 text-lg text-gray-500">
          了解各种 Perfetto 配置选项，优化您的数据收集策略
        </p>
      </div>

      <div className="mb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="搜索配置..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
              <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
          </div>
          <div className="flex gap-2">
            {categories.map(category => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  selectedCategory === category.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredConfigs.map((config, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    {config.name}
                    {config.commonUse && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        常用
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">{config.description}</p>
                </div>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {config.category}
                </span>
              </div>

              <div className="mt-4">
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md">
                  <pre className="text-sm overflow-x-auto whitespace-pre-wrap">
                    <code>{config.config}</code>
                  </pre>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(config.config)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
                >
                  复制配置
                </button>
                <button className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700">
                  导入到 UI
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">配置参数说明</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Buffers</h3>
            <p className="text-sm text-gray-600">
              控制内存缓冲区大小和填充策略。ring_buffer 会在填满时覆盖旧数据，
              discard 会在填满时丢弃新数据。
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Data Sources</h3>
            <p className="text-sm text-gray-600">
              定义要收集的数据源类型，如 cpu、sched、ftrace 等。
              每个 data source 都有其特定的配置选项。
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Duration</h3>
            <p className="text-sm text-gray-600">
              设置记录时长。可以通过设置 duration_ms 或使用 start/stop
              命令来控制记录的开始和结束。
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Flush Period</h3>
            <p className="text-sm text-gray-600">
              设置数据刷新周期，定期将缓冲区数据写入文件。
              长时间记录时建议设置合理的刷新周期。
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Write Into File</h3>
            <p className="text-sm text-gray-600">
              配置输出文件路径和文件大小限制。
              可以设置最大文件大小以避免生成过大的 trace 文件。
            </p>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">All Info</h3>
            <p className="text-sm text-gray-600">
              包含额外的元数据信息，如设备信息、调试信息等。
              这些信息有助于后续的分析和调试。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigGuide;