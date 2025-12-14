import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BrainIcon,
  DocumentTextIcon,
  CogIcon,
  BookOpenIcon,
  HomeIcon,
  UserIcon,
  ArrowRightOnRectangleIcon,
  CreditCardIcon
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../stores/authStore';

const Navbar = () => {
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthStore();

  const navigation = [
    { name: '首页', href: '/', icon: HomeIcon },
    { name: 'SQL 生成器', href: '/sql-generator', icon: BrainIcon },
    { name: 'Trace 分析', href: '/trace-analyzer', icon: DocumentTextIcon },
    { name: '配置指南', href: '/config-guide', icon: CogIcon },
    { name: '文章聚合', href: '/articles', icon: BookOpenIcon },
  ];

  return (
    <nav className="bg-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className="text-2xl font-bold text-primary-600">
                SmartPerfetto
              </Link>
            </div>
            <div className="hidden sm:ml-10 sm:flex sm:space-x-8">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      isActive
                        ? 'border-primary-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    <item.icon className="h-5 w-5 mr-2" />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center">
            {isAuthenticated ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-700">
                  {user?.name}
                  {user?.subscription && user.subscription !== 'free' && (
                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                      {user.subscription === 'pro' ? 'Pro' : 'Enterprise'}
                    </span>
                  )}
                </span>
                <Link
                  to="/pricing"
                  className="text-gray-500 hover:text-gray-700"
                  title="升级计划"
                >
                  <CreditCardIcon className="h-5 w-5" />
                </Link>
                <button
                  onClick={logout}
                  className="text-gray-500 hover:text-gray-700"
                  title="退出登录"
                >
                  <ArrowRightOnRectangleIcon className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="bg-primary-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-primary-700 transition-colors flex items-center"
              >
                <UserIcon className="h-4 w-4 mr-2" />
                登录
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;