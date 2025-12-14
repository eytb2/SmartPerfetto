import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';

interface PerfettoUIEmbedProps {
  traceUrl?: string;
  onQueryGenerated?: (query: string) => void;
  initialQuery?: string;
  height?: string;
  mode?: 'query' | 'analyze' | 'view';
}

const PerfettoUIEmbed: React.FC<PerfettoUIEmbedProps> = ({
  traceUrl,
  onQueryGenerated,
  initialQuery,
  height = '800px',
  mode = 'query'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [perfettoLoaded, setPerfettoLoaded] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    // Load Perfetto UI script
    const script = document.createElement('script');
    script.src = 'https://ui.perfetto.dev/v3.1/perfetto.js';
    script.async = true;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      setPerfettoLoaded(true);
      initializePerfetto();
    };

    script.onerror = (error) => {
      console.error('Failed to load Perfetto UI:', error);
    };

    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const initializePerfetto = () => {
    if (!containerRef.current || !window.PerfettoEmbed) return;

    // Initialize Perfetto Embed
    const perfettoEmbed = new window.PerfettoEmbed(containerRef.current);

    // Configuration
    const config = {
      // If we have a trace URL, load it
      ...(traceUrl && {
        dataSources: [
          {
            url: traceUrl,
            localPath: undefined,
            title: 'Trace File'
          }
        ]
      }),
      // UI customization
      theme: 'LIGHT',
      showSidebar: true,
      showTimeline: true,
      showQueryEditor: mode !== 'view',

      // Custom plugins and extensions
      plugins: [
        // SmartPerfetto AI Assistant plugin
        {
          name: 'smart-perfetto-ai',
          description: 'AI-powered query generation and analysis',
          setup: async (api: any) => {
            // Add custom buttons to query editor
            if (api.queryEditor) {
              api.queryEditor.addButton({
                id: 'generate-query',
                icon: '✨',
                title: 'Generate with AI',
                onClick: async () => {
                  const query = prompt('Describe what you want to analyze:');
                  if (query) {
                    const response = await fetch('/api/sql/generate', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                      },
                      body: JSON.stringify({ query })
                    });

                    const result = await response.json();
                    if (result.sql) {
                      api.queryEditor.setQuery(result.sql);
                      if (onQueryGenerated) {
                        onQueryGenerated(result.sql);
                      }
                    }
                  }
                }
              });
            }

            // Add SmartPerfetto branding if free user
            if (user?.subscription === 'free') {
              api.ui.addBanner({
                id: 'upgrade-banner',
                message: 'Upgrade to Pro for unlimited analyses',
                action: {
                  text: 'Upgrade Now',
                  onClick: () => window.open('/pricing', '_blank')
                }
              });
            }

            // Custom analysis shortcuts
            if (api.sidebar) {
              api.sidebar.addSection({
                id: 'smart-analysis',
                name: 'Smart Analysis',
                items: [
                  {
                    id: 'find-anr',
                    name: 'Find ANRs',
                    onClick: () => {
                      const query = `SELECT
                        thread.name AS thread_name,
                        process.name AS process_name,
                        process.android_pkgname AS package_name,
                        slice.ts / 1e6 AS start_time_ms,
                        slice.dur / 1e6 AS duration_ms
                      FROM slice
                      JOIN thread_track ON slice.track_id = thread_track.id
                      JOIN thread USING (utid)
                      JOIN process USING (upid)
                      WHERE slice.dur > 5e9  -- 5 seconds
                        AND process.name NOT LIKE 'com.android.'
                      ORDER BY slice.dur DESC
                      LIMIT 10`;
                      api.queryEditor.setQuery(query);
                    }
                  },
                  {
                    id: 'find-jank',
                    name: 'Find Jank',
                    onClick: () => {
                      const query = `WITH main_thread_gfx AS (
                        SELECT slice.*
                        FROM slice
                        JOIN thread_track ON slice.track_id = thread_track.id
                        JOIN thread USING (utid)
                        JOIN process USING (upid)
                        WHERE thread.is_main_thread = 1
                          AND slice.category = 'gfx'
                          AND slice.name LIKE 'Frame%'
                      )
                      SELECT
                        name,
                        COUNT(*) AS frame_count,
                        COUNT(CASE WHEN dur > 16.67e6 THEN 1 END) AS jank_count,
                        AVG(dur) / 1e6 AS avg_dur_ms,
                        MAX(dur) / 1e6 AS max_dur_ms
                      FROM main_thread_gfx
                      WHERE dur > 16.67e6
                      GROUP BY name`;
                      api.queryEditor.setQuery(query);
                    }
                  },
                  {
                    id: 'memory-analysis',
                    name: 'Memory Analysis',
                    onClick: () => {
                      const query = `SELECT
                        process.name,
                        process.android_pkgname,
                        heap_graph_object.type_name,
                        COUNT(*) AS object_count,
                        SUM(heap_graph_object.self_size) / 1024 / 1024 AS total_size_mb
                      FROM heap_graph_object
                      JOIN process USING (upid)
                      WHERE heap_graph_object.self_size > 0
                      GROUP BY process.name, process.android_pkgname, heap_graph_object.type_name
                      HAVING total_size_mb > 50
                      ORDER BY total_size_mb DESC
                      LIMIT 20`;
                      api.queryEditor.setQuery(query);
                    }
                  }
                ]
              });
            }

            // Custom export functionality
            api.queryResult.addAction({
              id: 'export-to-report',
              name: 'Generate Report',
              icon: '📊',
              onClick: async (result: any) => {
                // Generate a detailed report
                const report = await generateReport(result);
                downloadReport(report);
              }
            });
          }
        }
      ]
    };

    // Initialize with config
    await perfettoEmbed.init(config);
  };

  const generateReport = async (queryResult: any) => {
    const report = {
      timestamp: new Date().toISOString(),
      query: queryResult.query,
      results: queryResult.rows,
      insights: generateInsights(queryResult),
      recommendations: generateRecommendations(queryResult)
    };
    return report;
  };

  const generateInsights = (result: any) => {
    const insights = [];
    // AI-powered insights generation logic here
    return insights;
  };

  const generateRecommendations = (result: any) => {
    const recommendations = [];
    // Performance recommendations based on results
    return recommendations;
  };

  const downloadReport = (report: any) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perfetto-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Extend Window interface
  declare global {
    interface Window {
      PerfettoEmbed: any;
    }
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        style={{ height }}
        className="bg-gray-900 rounded-lg overflow-hidden"
      />

      {!perfettoLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 rounded-lg">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-white text-lg">Loading Perfetto UI...</p>
            <p className="text-gray-400 text-sm mt-2">This may take a few moments</p>
          </div>
        </div>
      )}

      {user?.subscription === 'free' && (
        <div className="absolute bottom-4 right-4 bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded-md text-sm">
          <p>
            <span className="font-medium">Free Plan:</span> Limited to 5 trace analyses per month
          </p>
          <a href="/pricing" className="underline font-medium">Upgrade</a>
        </div>
      )}
    </div>
  );
};

export default PerfettoUIEmbed;