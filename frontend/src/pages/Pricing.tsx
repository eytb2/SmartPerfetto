import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckIcon,
  XMarkIcon,
  StarIcon,
  BuildingOfficeIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../stores/authStore';

const Pricing = () => {
  const { user, isAuthenticated } = useAuthStore();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      name: '免费版',
      id: 'free',
      price: 0,
      features: [
        { name: '每月 5 次 Trace 分析', included: true },
        { name: '每月 100 次 SQL 生成', included: true },
        { name: '基础功能访问', included: true },
        { name: '社区支持', included: true },
        { name: '高级分析功能', included: false },
        { name: 'API 访问', included: false },
        { name: '优先支持', included: false },
        { name: '团队协作', included: false },
      ],
      icon: StarIcon,
      buttonText: '开始使用',
      buttonLink: isAuthenticated ? '/' : '/login',
      mostPopular: false,
    },
    {
      name: '专业版',
      id: 'pro',
      price: 99,
      yearlyPrice: 990,
      features: [
        { name: '无限 Trace 分析', included: true },
        { name: '无限 SQL 生成', included: true },
        { name: '高级分析功能', included: true },
        { name: '邮件支持', included: true },
        { name: 'API 访问（1000次/月）', included: true },
        { name: '导出分析报告', included: true },
        { name: '优先支持', included: false },
        { name: '团队协作', included: false },
      ],
      icon: BoltIcon,
      buttonText: '立即升级',
      buttonLink: '/subscribe?plan=pro',
      mostPopular: true,
    },
    {
      name: '企业版',
      id: 'enterprise',
      price: 499,
      yearlyPrice: 4990,
      features: [
        { name: '专业版所有功能', included: true },
        { name: '无限 API 访问', included: true },
        { name: '团队协作（最多20人）', included: true },
        { name: '专属客户经理', included: true },
        { name: '定制化功能', included: true },
        { name: 'SLA 保证', included: true },
        { name: '私有部署选项', included: true },
        { name: '培训服务', included: true },
      ],
      icon: BuildingOfficeIcon,
      buttonText: '联系销售',
      buttonLink: '/contact',
      mostPopular: false,
    },
  ];

  const handleSubscribe = async (planId: string) => {
    if (!isAuthenticated) {
      window.location.href = '/login';
      return;
    }

    if (planId === 'free') {
      window.location.href = '/';
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: planId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create subscription');
      }

      // 跳转到 Stripe 支付页面
      window.location.href = data.url;
    } catch (error) {
      console.error('Subscription error:', error);
      alert('创建订阅失败，请稍后重试');
    }
  };

  return (
    <div className="bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-5xl">
            选择适合您的计划
          </h1>
          <p className="mt-4 text-xl text-gray-600">
            无论您是个人开发者还是企业团队，我们都有合适的方案
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="mt-8 flex justify-center">
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                billingCycle === 'monthly'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-500'
              }`}
            >
              月付
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('yearly')}
              className={`px-4 py-2 rounded-md text-sm font-medium relative ${
                billingCycle === 'yearly'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-500'
              }`}
            >
              年付
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                省20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="mt-12 space-y-4 sm:mt-16 sm:space-y-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const currentPrice = billingCycle === 'yearly' ? plan.yearlyPrice : plan.price;

            return (
              <div
                key={plan.id}
                className={`bg-white rounded-lg shadow-lg divide-y divide-gray-200 ${
                  plan.mostPopular ? 'ring-2 ring-primary-500' : ''
                }`}
              >
                {plan.mostPopular && (
                  <div className="bg-primary-500 py-2 px-4 text-center text-sm font-semibold text-white tracking-wide">
                    最受欢迎
                  </div>
                )}
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <Icon className="h-8 w-8 text-primary-600" />
                      <h3 className="ml-3 text-xl font-semibold text-gray-900">{plan.name}</h3>
                    </div>
                  </div>
                  <p className="mt-4">
                    <span className="text-4xl font-extrabold text-gray-900">
                      ¥{currentPrice}
                    </span>
                    <span className="text-base font-medium text-gray-500">
                      /{billingCycle === 'yearly' ? '年' : '月'}
                    </span>
                  </p>
                  {plan.id !== 'free' && billingCycle === 'monthly' && (
                    <p className="mt-1 text-sm text-gray-500">
                      年付仅需 ¥{plan.yearlyPrice}（省 ¥{(plan.price * 12 - plan.yearlyPrice)}）
                    </p>
                  )}
                  <button
                    onClick={() => handleSubscribe(plan.id)}
                    className={`mt-8 block w-full py-3 px-6 border border-transparent rounded-md text-center font-medium ${
                      plan.mostPopular
                        ? 'bg-primary-600 text-white hover:bg-primary-700'
                        : 'bg-primary-50 text-primary-700 hover:bg-primary-100'
                    }`}
                  >
                    {user?.subscription === plan.id ? '当前计划' : plan.buttonText}
                  </button>
                </div>
                <div className="px-6 pt-6 pb-8">
                  <h4 className="text-sm font-medium text-gray-900">功能对比</h4>
                  <ul className="mt-6 space-y-4">
                    {plan.features.map((feature, featureIdx) => (
                      <li key={featureIdx} className="flex">
                        {feature.included ? (
                          <CheckIcon className="h-5 w-5 text-green-500" />
                        ) : (
                          <XMarkIcon className="h-5 w-5 text-gray-400" />
                        )}
                        <span
                          className={`ml-3 text-sm ${
                            feature.included ? 'text-gray-900' : 'text-gray-500'
                          }`}
                        >
                          {feature.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-20">
          <h2 className="text-3xl font-extrabold text-gray-900 text-center">
            常见问题
          </h2>
          <dl className="mt-12 space-y-10 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:gap-y-12">
            <div>
              <dt className="text-base font-semibold text-gray-900">
                是否提供免费试用？
              </dt>
              <dd className="mt-3 text-sm text-gray-500">
                是的！新用户注册后自动获得免费版体验，无需信用卡。您可以随时升级到付费计划。
              </dd>
            </div>
            <div>
              <dt className="text-base font-semibold text-gray-900">
                可以随时取消订阅吗？
              </dt>
              <dd className="mt-3 text-sm text-gray-500">
                当然可以。您可以随时在账户设置中取消订阅，当前计费周期结束后将不再续费。
              </dd>
            </div>
            <div>
              <dt className="text-base font-semibold text-gray-900">
                Trace 文件大小有限制吗？
              </dt>
              <dd className="mt-3 text-sm text-gray-500">
                单个 Trace 文件最大支持 2GB。专业版和企业版用户没有文件数量限制。
              </dd>
            </div>
            <div>
              <dt className="text-base font-semibold text-gray-900">
                API 如何计费？
              </dt>
              <dd className="mt-3 text-sm text-gray-500">
                专业版包含每月 1000 次 API 调用，超出部分 ¥0.1/次。企业版提供无限 API 访问。
              </dd>
            </div>
          </dl>
        </div>

        {/* CTA Section */}
        <div className="mt-16 bg-primary-600 rounded-lg shadow-xl overflow-hidden">
          <div className="px-6 py-12 sm:px-12 lg:py-16 lg:px-16">
            <div className="lg:grid lg:grid-cols-2 lg:gap-8 items-center">
              <div>
                <h2 className="text-3xl font-extrabold text-white">
                  准备开始了吗？
                </h2>
                <p className="mt-4 text-lg text-primary-200">
                  立即注册，开始您的性能优化之旅
                </p>
              </div>
              <div className="mt-8 flex lg:mt-0 lg:flex-shrink-0">
                <div className="inline-flex rounded-md shadow">
                  <Link
                    to="/login"
                    className="inline-flex items-center justify-center px-5 py-3 border border-transparent text-base font-medium rounded-md text-primary-600 bg-white hover:bg-primary-50"
                  >
                    免费开始
                  </Link>
                </div>
                <div className="ml-3 inline-flex rounded-md shadow">
                  <Link
                    to="/contact"
                    className="inline-flex items-center justify-center px-5 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-500 hover:bg-primary-400"
                  >
                    联系销售
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;