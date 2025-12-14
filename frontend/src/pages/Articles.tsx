import React, { useState } from 'react';
import { MagnifyingGlassIcon, CalendarIcon, UserIcon, TagIcon } from '@heroicons/react/24/outline';

const Articles = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');

  const tags = [
    { id: 'all', name: '全部' },
    { id: 'performance', name: '性能优化' },
    { id: 'perfetto', name: 'Perfetto' },
    { id: 'memory', name: '内存' },
    { id: 'cpu', name: 'CPU' },
    { id: 'gpu', name: 'GPU' },
    { id: 'anr', name: 'ANR' },
    { id: 'startup', name: '启动优化' }
  ];

  const articles = [
    {
      id: 1,
      title: '深入理解 Android 性能分析：Perfetto 实战指南',
      summary: '本文将详细介绍如何使用 Perfetto 进行 Android 应用的性能分析，包括数据收集、SQL 查询和可视化分析。',
      author: '张三',
      date: '2024-12-10',
      tags: ['perfetto', 'performance'],
      readTime: '15 分钟',
      link: '#'
    },
    {
      id: 2,
      title: 'Android 应用启动性能优化最佳实践',
      summary: '从 Application 创建到 Activity 显示，全面解析 Android 应用启动过程中的性能瓶颈及优化方案。',
      author: '李四',
      date: '2024-12-08',
      tags: ['startup', 'performance'],
      readTime: '12 分钟',
      link: '#'
    },
    {
      id: 3,
      title: '使用 Perfetto 追踪内存泄漏问题',
      summary: '通过实际案例，讲解如何利用 Perfetto 的 heap profiler 功能定位和分析 Android 应用的内存泄漏问题。',
      author: '王五',
      date: '2024-12-05',
      tags: ['memory', 'perfetto'],
      readTime: '20 分钟',
      link: '#'
    },
    {
      id: 4,
      title: 'GPU 渲染性能分析：从 Systrace 到 Perfetto',
      summary: '对比 Systrace 和 Perfetto 在 GPU 性能分析方面的差异，介绍如何使用 Perfetto 分析渲染瓶颈。',
      author: '赵六',
      date: '2024-12-03',
      tags: ['gpu', 'perfetto', 'performance'],
      readTime: '18 分钟',
      link: '#'
    },
    {
      id: 5,
      title: 'ANR 问题排查：Perfetto 助力快速定位',
      summary: '介绍 ANR 的产生原因，以及如何使用 Perfetto 快速定位和解决 ANR 问题。',
      author: '钱七',
      date: '2024-11-30',
      tags: ['anr', 'perfetto'],
      readTime: '10 分钟',
      link: '#'
    },
    {
      id: 6,
      title: 'CPU 调度优化：Perfetto CPU 分析指南',
      summary: '深入分析 Android 系统的 CPU 调度机制，以及如何使用 Perfetto 优化应用的 CPU 使用率。',
      author: '孙八',
      date: '2024-11-28',
      tags: ['cpu', 'performance'],
      readTime: '16 分钟',
      link: '#'
    },
    {
      id: 7,
      title: 'Perfetto SQL 高级技巧：自定义视图和函数',
      summary: '介绍 Perfetto SQL 的高级特性，包括创建自定义视图、使用窗口函数等高级查询技巧。',
      author: '周九',
      date: '2024-11-25',
      tags: ['perfetto'],
      readTime: '22 分钟',
      link: '#'
    },
    {
      id: 8,
      title: '自动化性能测试：集成 Perfetto 到 CI/CD',
      summary: '讲解如何在 CI/CD 流程中集成 Perfetto，实现自动化的性能测试和监控。',
      author: '吴十',
      date: '2024-11-22',
      tags: ['perfetto', 'performance'],
      readTime: '14 分钟',
      link: '#'
    }
  ];

  const filteredArticles = articles.filter(article => {
    const matchesTag = selectedTag === 'all' || article.tags.includes(selectedTag);
    const matchesSearch = article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         article.summary.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesTag && matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-extrabold text-gray-900">
          性能优化文章聚合
        </h1>
        <p className="mt-4 text-lg text-gray-500">
          收集最新的 Perfetto 和 Android 性能优化相关文章
        </p>
      </div>

      <div className="mb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="搜索文章..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
              <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={() => setSelectedTag(tag.id)}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  selectedTag === tag.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <TagIcon className="h-4 w-4 inline mr-1" />
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredArticles.map(article => (
          <div key={article.id} className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                {article.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {tag}
                  </span>
                ))}
              </div>

              <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                <a href={article.link} className="hover:text-primary-600">
                  {article.title}
                </a>
              </h3>

              <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                {article.summary}
              </p>

              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-4 w-4" />
                    {article.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarIcon className="h-4 w-4" />
                    {article.date}
                  </span>
                </div>
                <span>{article.readTime}</span>
              </div>

              <div className="mt-4">
                <a
                  href={article.link}
                  className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                >
                  阅读全文 →
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 bg-blue-50 rounded-lg p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">订阅我们的技术周刊</h2>
        <p className="text-gray-600 mb-6">
          每周精选最新的 Android 性能优化文章和 Perfetto 使用技巧，直达您的邮箱
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="email"
            placeholder="请输入您的邮箱"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
          />
          <button className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium">
            订阅
          </button>
        </div>
      </div>
    </div>
  );
};

export default Articles;