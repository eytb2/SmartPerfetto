import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import type { TraceProcessorService } from '../services/traceProcessorService';
import type { SkillExecutor } from '../services/skillEngine/skillExecutor';
import { getSkillAnalysisAdapter } from '../services/skillEngine/skillAnalysisAdapter';
import { createArchitectureDetector } from '../agent/detectors/architectureDetector';
import { displayResultToEnvelope } from '../types/dataContract';
import { SQLLearningSystem } from '../services/sqlLearningSystem';
import type { DisplayResult as SkillDisplayResult } from '../services/skillEngine/types';
import type { StreamingUpdate } from '../agent/types';
import type { SqlSchemaIndex } from './types';

let sqlSchemaCache: SqlSchemaIndex | null = null;
let sqlLearningInstance: SQLLearningSystem | null = null;

async function getSqlLearning(): Promise<SQLLearningSystem> {
  if (!sqlLearningInstance) {
    const logDir = process.env.SQL_LEARNING_LOG_DIR || './logs/sql_learning';
    sqlLearningInstance = new SQLLearningSystem(logDir);
  }
  await sqlLearningInstance.init();
  return sqlLearningInstance;
}

function loadSqlSchema(): SqlSchemaIndex {
  if (sqlSchemaCache) return sqlSchemaCache;

  const indexPath = path.resolve(__dirname, '../../data/perfettoSqlIndex.light.json');
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    sqlSchemaCache = JSON.parse(raw) as SqlSchemaIndex;
  } catch (err) {
    console.warn('[ClaudeMCP] Failed to load SQL schema index:', (err as Error).message);
    sqlSchemaCache = { version: '0.0.0', generatedAt: '', templates: [] };
  }
  return sqlSchemaCache;
}

export interface ClaudeMcpServerOptions {
  traceId: string;
  traceProcessorService: TraceProcessorService;
  skillExecutor: SkillExecutor;
  packageName?: string;
  /** Callback to emit StreamingUpdate events (e.g. DataEnvelopes from skill results) */
  emitUpdate?: (update: StreamingUpdate) => void;
}

/**
 * Creates an in-process MCP server scoped to a specific trace session.
 * Exposes 5 domain tools: execute_sql, invoke_skill, list_skills,
 * detect_architecture, lookup_sql_schema.
 */
export function createClaudeMcpServer(options: ClaudeMcpServerOptions) {
  const { traceId, traceProcessorService, skillExecutor, packageName, emitUpdate } = options;
  const skillAdapter = getSkillAnalysisAdapter(traceProcessorService);

  const executeSql = tool(
    'execute_sql',
    'Execute a raw SQL query against the Perfetto trace_processor for the currently loaded trace. ' +
    'Returns columnar results. Use this for ad-hoc queries not covered by existing skills. ' +
    'Prefer invoke_skill when a matching skill exists — it produces richer, layered output.',
    {
      sql: z.string().describe(
        'The SQL query to execute. Use Perfetto stdlib tables/functions (e.g. android_jank_cuj, slice, thread, process).'
      ),
    },
    async ({ sql }) => {
      try {
        const result = await traceProcessorService.query(traceId, sql);
        const truncated = result.rows.length > 200;
        const rows = truncated ? result.rows.slice(0, 200) : result.rows;
        const success = !result.error;

        // SQL Learning: log errors and attempt auto-fix
        if (result.error) {
          try {
            const learning = await getSqlLearning();
            const fixResult = await learning.fixSQL(
              sql,
              result.error,
              'execute_sql via Claude Agent',
              () => ({ isValid: true, errors: [] }), // basic validator — let trace_processor validate
              async (fixedSql) => {
                const retryResult = await traceProcessorService.query(traceId, fixedSql);
                return { ok: !retryResult.error, error: retryResult.error };
              },
            );
            if (fixResult.success) {
              // Auto-fix succeeded — retry with the fixed SQL
              const retryResult = await traceProcessorService.query(traceId, fixResult.fixedSQL);
              const retryRows = retryResult.rows.length > 200 ? retryResult.rows.slice(0, 200) : retryResult.rows;
              if (emitUpdate && !retryResult.error && retryResult.columns.length > 0 && retryRows.length > 0) {
                emitSqlDataEnvelope(emitUpdate, retryResult.columns, retryRows);
              }
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    success: !retryResult.error,
                    columns: retryResult.columns,
                    rows: retryRows,
                    totalRows: retryResult.rows.length,
                    truncated: retryResult.rows.length > 200,
                    durationMs: retryResult.durationMs,
                    autoFixed: true,
                    originalError: result.error,
                    fixMethod: fixResult.method,
                  }, null, 2),
                }],
              };
            }
          } catch {
            // SQL learning is non-critical — fall through to original error response
          }
        }

        // Emit DataEnvelope for interactive table rendering in frontend
        if (emitUpdate && success && result.columns.length > 0 && rows.length > 0) {
          emitSqlDataEnvelope(emitUpdate, result.columns, rows);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success,
              columns: result.columns,
              rows,
              totalRows: result.rows.length,
              truncated,
              durationMs: result.durationMs,
              ...(result.error ? { error: result.error } : {}),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: (err as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  const invokeSkill = tool(
    'invoke_skill',
    'Execute a named SmartPerfetto skill pipeline against the current trace. ' +
    'Skills are pre-built analysis routines that produce layered results (overview → list → diagnosis → deep). ' +
    'Use list_skills first to find the right skill ID. ' +
    'Common params: process_name, start_ts, end_ts, max_frames_per_session.',
    {
      skillId: z.string().describe('Skill identifier (e.g. "scrolling_analysis", "jank_frame_detail", "cpu_analysis")'),
      params: z.record(z.string(), z.any()).optional().describe(
        'Optional parameters to pass to the skill. Common: { process_name, start_ts, end_ts, max_frames_per_session }'
      ),
    },
    async ({ skillId, params }) => {
      try {
        const effectiveParams = { ...params };
        if (packageName && !effectiveParams.process_name) {
          effectiveParams.process_name = packageName;
        }
        // YAML skills reference ${package} in SQL, not ${process_name}.
        // Map process_name → package so skill SQL resolves correctly.
        if (effectiveParams.process_name && !effectiveParams.package) {
          effectiveParams.package = effectiveParams.process_name;
        }
        const result = await skillExecutor.execute(skillId, traceId, effectiveParams);

        // Emit DataEnvelopes for interactive frontend tables
        if (emitUpdate && result.displayResults?.length) {
          emitSkillDataEnvelopes(result.displayResults as SkillDisplayResult[], result.skillId || skillId, emitUpdate);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: result.success,
              skillId: result.skillId,
              skillName: result.skillName,
              ...(result.error ? { error: result.error } : {}),
              displayResults: result.displayResults?.map(dr => ({
                stepId: dr.stepId,
                title: dr.title,
                layer: dr.layer,
                data: dr.data,
              })),
              diagnostics: result.diagnostics,
              synthesizeData: result.synthesizeData,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: (err as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  const listSkills = tool(
    'list_skills',
    'List all available SmartPerfetto analysis skills. ' +
    'Use this to discover which skills exist before invoking one. ' +
    'Filter by category to narrow results (e.g. "scrolling", "startup", "cpu", "memory").',
    {
      category: z.string().optional().describe(
        'Optional filter: only return skills whose keywords or tags match this category'
      ),
    },
    async ({ category }) => {
      try {
        const allSkills = await skillAdapter.listSkills();
        const filtered = category
          ? allSkills.filter(s =>
              s.keywords.some(k => k.toLowerCase().includes(category.toLowerCase())) ||
              s.tags?.some(t => t.toLowerCase().includes(category.toLowerCase())) ||
              s.id.toLowerCase().includes(category.toLowerCase())
            )
          : allSkills;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(
              filtered.map(s => ({
                id: s.id,
                displayName: s.displayName,
                description: s.description,
                type: s.type,
                keywords: s.keywords.slice(0, 5),
              })),
              null,
              2
            ),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: (err as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  const detectArchitecture = tool(
    'detect_architecture',
    'Detect the rendering architecture of the app in the current trace. ' +
    'Returns architecture type (STANDARD/FLUTTER/COMPOSE/WEBVIEW/etc.), confidence, and evidence. ' +
    'Call this early to understand which analysis approach to use.',
    {},
    async () => {
      try {
        const detector = createArchitectureDetector();
        const info = await detector.detect({ traceId, traceProcessorService, packageName });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              type: info.type,
              confidence: info.confidence,
              evidence: info.evidence.map(e => ({ source: e.source, type: e.type, weight: e.weight })),
              flutter: info.flutter,
              compose: info.compose,
              webview: info.webview,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: (err as Error).message }) }],
          isError: true,
        };
      }
    }
  );

  const lookupSqlSchema = tool(
    'lookup_sql_schema',
    'Search the Perfetto SQL stdlib index for table, view, and function definitions matching a keyword. ' +
    'Use this to discover available SQL entities before writing raw SQL queries.',
    {
      keyword: z.string().describe(
        'Search keyword (e.g. "jank", "slice", "thread_state", "android_frames")'
      ),
    },
    async ({ keyword }) => {
      const schema = loadSqlSchema();
      const lower = keyword.toLowerCase();
      const matches = schema.templates
        .filter(t => t.name.toLowerCase().includes(lower) || t.category.toLowerCase().includes(lower) || t.description.toLowerCase().includes(lower))
        .slice(0, 30);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            totalMatches: matches.length,
            entries: matches.map(m => ({ name: m.name, type: m.type, category: m.category, description: m.description })),
          }, null, 2),
        }],
      };
    }
  );

  return createSdkMcpServer({
    name: 'smartperfetto',
    version: '1.0.0',
    tools: [executeSql, invokeSkill, listSkills, detectArchitecture, lookupSqlSchema],
  });
}

/** Emit a DataEnvelope for SQL query results (used by execute_sql). */
function emitSqlDataEnvelope(
  emit: (update: StreamingUpdate) => void,
  columns: string[],
  rows: any[],
): void {
  emit({
    type: 'data',
    content: [{
      meta: { type: 'sql_result', version: '2.0', source: 'execute_sql' },
      data: { columns, rows },
      display: {
        layer: 'detail',
        format: 'table',
        title: `SQL Query (${rows.length} rows)`,
        columns: columns.map((col: string) => ({
          name: col,
          type: col.includes('ts') || col.includes('timestamp') ? 'timestamp' :
                col.includes('dur') ? 'duration' :
                col.includes('pct') || col.includes('percent') ? 'percentage' : 'string',
        })),
      },
    }],
    timestamp: Date.now(),
  });
}

/**
 * Convert skill DisplayResults to DataEnvelopes and emit as SSE 'data' events.
 * This enables interactive tables (clickable timestamps, expandable rows) in the frontend.
 */
function emitSkillDataEnvelopes(
  displayResults: SkillDisplayResult[],
  skillId: string,
  emit: (update: StreamingUpdate) => void,
): void {
  const envelopes = displayResults
    .filter(dr => dr.data?.rows?.length)
    .map(dr => displayResultToEnvelope(dr as any, skillId));

  if (envelopes.length > 0) {
    emit({ type: 'data', content: envelopes, timestamp: Date.now() });
  }
}
