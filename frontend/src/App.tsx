import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Pricing from './pages/Pricing';
import SqlGenerator from './pages/SqlGenerator';
import TraceAnalyzer from './pages/TraceAnalyzer';
import ConfigGuide from './pages/ConfigGuide';
import Articles from './pages/Articles';
import { useAuthStore } from './stores/authStore';

const queryClient = new QueryClient();

function AppContent() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/sql-generator" element={<SqlGenerator />} />
            <Route path="/trace-analyzer" element={<TraceAnalyzer />} />
            <Route path="/config-guide" element={<ConfigGuide />} />
            <Route path="/articles" element={<Articles />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App
