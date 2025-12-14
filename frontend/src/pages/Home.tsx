import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  BookOpenIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

const Home = () => {
  const features = [
    {
      name: 'AI SQL 生成器',
      description: '用自然语言描述您的需求，AI 将为您生成精确的 Perfetto SQL 查询语句',
      icon: SparklesIcon,
      href: '/sql-generator',
      color: 'bg-purple-500'
    },
    {
      name: 'Trace 分析',
      description: '上传您的 Trace 文件，使用 AI 智能分析性能问题并自动标注关键事件',
      icon: ChatBubbleLeftRightIcon,
      href: '/trace-analyzer',
      color: 'bg-blue-500'
    },
    {
      name: '配置指南',
      description: '详细了解 Perfetto Config 的各项配置，优化您的数据收集策略',
      icon: Cog6ToothIcon,
      href: '/config-guide',
      color: 'bg-green-500'
    },
    {
      name: '文章聚合',
      description: '收集最新的 Perfetto 和 Android 性能优化相关的技术文章',
      icon: BookOpenIcon,
      href: '/articles',
      color: 'bg-orange-500'
    }
  ];

  return (
    <div className="py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl tracking-tight font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
            <span className="block">AI 驱动的</span>
            <span className="block text-primary-600">Perfetto 分析平台</span>
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            让性能分析变得简单。通过 AI 技术，帮助您快速理解和分析 Android 性能数据，
            找出性能瓶颈，优化应用体验。
          </p>
          <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
            <div className="rounded-md shadow">
              <Link
                to="/sql-generator"
                className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 md:py-4 md:text-lg md:px-10"
              >
                开始使用
              </Link>
            </div>
            <div className="mt-3 rounded-md shadow sm:mt-0 sm:ml-3">
              <Link
                to="/trace-analyzer"
                className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-primary-600 bg-white hover:bg-gray-50 md:py-4 md:text-lg md:px-10"
              >
                上传 Trace
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-20">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">
              强大的功能
            </h2>
            <p className="mt-4 max-w-2xl mx-auto text-xl text-gray-500">
              集成 AI 技术，让 Perfetto 分析从未如此简单
            </p>
          </div>

          <div className="mt-12">
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <div key={feature.name} className="relative">
                  <div className="relative bg-white p-6 h-full rounded-lg hover:shadow-lg transition-shadow">
                    <div>
                      <span
                        className={`rounded-lg inline-flex p-3 ${feature.color}`}
                      >
                        <feature.icon className="h-6 w-6 text-white" aria-hidden="true" />
                      </span>
                    </div>
                    <div className="mt-4">
                      <h3 className="text-lg font-medium text-gray-900">
                        <Link to={feature.href} className="hover:underline">
                          {feature.name}
                        </Link>
                      </h3>
                      <p className="mt-2 text-sm text-gray-500">
                        {feature.description}
                      </p>
                    </div>
                    <div className="mt-4">
                      <Link
                        to={feature.href}
                        className="text-sm font-medium text-primary-600 hover:text-primary-500"
                      >
                        了解更多 <span aria-hidden="true">&rarr;</span>
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-20 bg-gray-50 rounded-lg p-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-4">
              为什么选择 SmartPerfetto？
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
              <div className="text-left">
                <h3 className="font-semibold text-lg mb-2">智能分析</h3>
                <p className="text-gray-600">
                  基于 AI 的智能分析，自动识别性能问题，无需深入了解 SQL 语法
                </p>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-lg mb-2">可视化展示</h3>
                <p className="text-gray-600">
                  集成 Perfetto UI，提供直观的数据可视化界面
                </p>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-lg mb-2">实时交互</h3>
                <p className="text-gray-600">
                  支持实时对话式分析，快速定位问题根源
                </p>
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-lg mb-2">持续更新</h3>
                <p className="text-gray-600">
                  紧跟 Perfetto 最新功能，定期更新分析模板和知识库
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;