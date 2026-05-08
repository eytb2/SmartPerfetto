// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { applyEnterpriseMinimalSchema } from '../services/enterpriseSchema';
import {
  getTracesDir,
  listTraceMetadata,
  readTraceMetadataForContext,
  writeTraceMetadata,
} from '../services/traceMetadataStore';
import { ownerFieldsFromContext } from '../services/resourceOwnership';
import type { RequestContext } from '../middleware/auth';

type ScenarioName = 'D1' | 'D2';

interface VerifyOptions {
  tracePath?: string;
  uploadRoot?: string;
  outputPath?: string;
  keepTemp: boolean;
  longSqlMs: number;
}

export interface EnterpriseWindowRegressionOptions {
  tracePath?: string;
  uploadRoot?: string;
  outputPath?: string;
  keepTemp?: boolean;
  longSqlMs?: number;
}

interface WindowContext {
  label: string;
  context: RequestContext;
}

interface UploadRecord {
  traceId: string;
  originalName: string;
  localPath: string;
  sha256: string;
  sizeBytes: number;
  context: WindowContext;
}

interface RunRecord {
  sessionId: string;
  runId: string;
}

interface ScenarioReport {
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
}

export interface EnterpriseWindowRegressionReport {
  timestamp: string;
  passed: boolean;
  checks: Record<ScenarioName, boolean>;
  uploadRoot: string;
  tracePath: string;
  scenarios: Record<ScenarioName, ScenarioReport>;
  coverageLimitations: string[];
}

const DEFAULT_TRACE_CANDIDATES = [
  '../test-traces/launch_light.pftrace',
  'test-traces/launch_light.pftrace',
  '../test-traces/scroll_Standard-AOSP-App-Without-PreAnimation.pftrace',
  'test-traces/scroll_Standard-AOSP-App-Without-PreAnimation.pftrace',
];

function printUsage(): void {
  console.log('Usage: npx tsx src/scripts/verifyEnterpriseMultiTenantWindows.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --trace <path>         Fixture trace path. Defaults to launch_light from test-traces.');
  console.log('  --upload-root <path>   Temporary upload root. Defaults to an OS temp dir.');
  console.log('  --output <path>        JSON report path. Defaults to backend/test-output.');
  console.log('  --long-sql-ms <ms>     Simulated long SQL window for D2 (default: 100).');
  console.log('  --keep-temp            Keep generated upload files.');
  console.log('  --help                 Show this help.');
}

function parseArgs(argv: string[]): VerifyOptions {
  const options: VerifyOptions = {
    keepTemp: false,
    longSqlMs: 100,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--keep-temp') {
      options.keepTemp = true;
      continue;
    }
    if (arg === '--trace') {
      if (!next) throw new Error('--trace requires a value');
      options.tracePath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--upload-root') {
      if (!next) throw new Error('--upload-root requires a value');
      options.uploadRoot = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--output') {
      if (!next) throw new Error('--output requires a value');
      options.outputPath = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--long-sql-ms') {
      if (!next) throw new Error('--long-sql-ms requires a value');
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error('--long-sql-ms must be a positive integer');
      }
      options.longSqlMs = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveDefaultTracePath(): string {
  for (const candidate of DEFAULT_TRACE_CANDIDATES) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  throw new Error('No default trace fixture found. Pass --trace <path>.');
}

function context(label: string, input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  windowId: string;
}): WindowContext {
  return {
    label,
    context: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      windowId: input.windowId,
      authType: 'api_key',
      roles: ['analyst'],
      scopes: ['trace:read', 'trace:write', 'agent:run', 'report:read'],
      requestId: `req-${label}`,
    },
  };
}

function seedIdentity(db: Database.Database, wc: WindowContext): void {
  const now = Date.now();
  const { tenantId, workspaceId, userId } = wc.context;
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, status, plan, created_at, updated_at)
    VALUES (?, ?, 'active', 'enterprise', ?, ?)
  `).run(tenantId, tenantId, now, now);
  db.prepare(`
    INSERT OR IGNORE INTO workspaces (id, tenant_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(workspaceId, tenantId, workspaceId, now, now);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, tenant_id, email, display_name, idp_subject, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    tenantId,
    `${userId}@example.test`,
    userId,
    `oidc|${tenantId}|${userId}`,
    now,
    now,
  );
  db.prepare(`
    INSERT OR IGNORE INTO memberships (tenant_id, workspace_id, user_id, role, created_at)
    VALUES (?, ?, ?, 'analyst', ?)
  `).run(tenantId, workspaceId, userId, now);
}

function ensureProviderSnapshot(db: Database.Database, wc: WindowContext): string {
  const now = Date.now();
  const providerSnapshotId = `provider-snapshot-${wc.context.tenantId}`;
  db.prepare(`
    INSERT OR IGNORE INTO provider_snapshots
      (id, tenant_id, provider_id, snapshot_hash, runtime_kind, resolved_config_json, secret_version, created_at)
    VALUES (?, ?, 'provider-regression', ?, 'claude-agent-sdk', ?, 'regression-v1', ?)
  `).run(
    providerSnapshotId,
    wc.context.tenantId,
    `hash-${wc.context.tenantId}`,
    JSON.stringify({ models: { primary: 'regression-primary', light: 'regression-light' } }),
    now,
  );
  return providerSnapshotId;
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function simulateUpload(
  db: Database.Database,
  wc: WindowContext,
  tracePath: string,
  originalName: string,
): Promise<UploadRecord> {
  seedIdentity(db, wc);
  const tracesDir = getTracesDir();
  await fsp.mkdir(tracesDir, { recursive: true });

  const traceId = crypto.randomUUID();
  const localPath = path.join(tracesDir, `${traceId}.trace`);
  await fsp.copyFile(tracePath, localPath);
  const stat = await fsp.stat(localPath);
  const sha256 = await sha256File(localPath);
  const now = Date.now();

  await writeTraceMetadata({
    id: traceId,
    filename: originalName,
    size: stat.size,
    uploadedAt: new Date(now).toISOString(),
    status: 'ready',
    path: localPath,
    ...ownerFieldsFromContext(wc.context),
  });

  db.prepare(`
    INSERT INTO trace_assets
      (id, tenant_id, workspace_id, owner_user_id, local_path, sha256, size_bytes, status, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
  `).run(
    traceId,
    wc.context.tenantId,
    wc.context.workspaceId,
    wc.context.userId,
    localPath,
    sha256,
    stat.size,
    JSON.stringify({
      originalName,
      windowId: wc.context.windowId,
      regressionScenario: 'enterprise-window',
    }),
    now,
  );

  return {
    traceId,
    originalName,
    localPath,
    sha256,
    sizeBytes: stat.size,
    context: wc,
  };
}

function createAnalysisRun(
  db: Database.Database,
  wc: WindowContext,
  upload: UploadRecord,
  status: 'pending' | 'running' | 'completed',
): RunRecord {
  seedIdentity(db, wc);
  const providerSnapshotId = ensureProviderSnapshot(db, wc);
  const now = Date.now();
  const sessionId = `session-${crypto.randomUUID()}`;
  const runId = `run-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO analysis_sessions
      (id, tenant_id, workspace_id, trace_id, created_by, provider_snapshot_id, title, visibility, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?)
  `).run(
    sessionId,
    wc.context.tenantId,
    wc.context.workspaceId,
    upload.traceId,
    wc.context.userId,
    providerSnapshotId,
    `${wc.label} ${upload.originalName}`,
    status,
    now,
    now,
  );
  db.prepare(`
    INSERT INTO analysis_runs
      (id, tenant_id, workspace_id, session_id, mode, status, question, started_at)
    VALUES (?, ?, ?, ?, 'full', ?, ?, ?)
  `).run(
    runId,
    wc.context.tenantId,
    wc.context.workspaceId,
    sessionId,
    status,
    `regression analysis for ${wc.label}`,
    now,
  );
  return { sessionId, runId };
}

function appendAgentEvent(
  db: Database.Database,
  wc: WindowContext,
  runId: string,
  cursor: number,
  eventType = 'progress',
): void {
  db.prepare(`
    INSERT INTO agent_events
      (id, tenant_id, workspace_id, run_id, cursor, event_type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `event-${crypto.randomUUID()}`,
    wc.context.tenantId,
    wc.context.workspaceId,
    runId,
    cursor,
    eventType,
    JSON.stringify({
      scenario: 'enterprise-window',
      label: wc.label,
      cursor,
    }),
    Date.now(),
  );
}

function scalar<T>(db: Database.Database, sql: string, params: unknown[] = [], column = 'value'): T {
  const row = db.prepare(sql).get(...params) as Record<string, T>;
  return row[column];
}

async function ownedTraceIds(contextValue: RequestContext): Promise<string[]> {
  const ids: string[] = [];
  for (const metadata of await listTraceMetadata()) {
    if (await readTraceMetadataForContext(metadata.id, contextValue)) {
      ids.push(metadata.id);
    }
  }
  return ids.sort();
}

async function scenarioD1(db: Database.Database, tracePath: string, windows: {
  userAWindow1: WindowContext;
  userAWindow2: WindowContext;
  userBWindow1: WindowContext;
  userCWindow1: WindowContext;
}): Promise<ScenarioReport> {
  const sameName = 'same-name-regression.pftrace';
  const uploads = [
    await simulateUpload(db, windows.userAWindow1, tracePath, sameName),
    await simulateUpload(db, windows.userAWindow2, tracePath, sameName),
    await simulateUpload(db, windows.userBWindow1, tracePath, sameName),
    await simulateUpload(db, windows.userCWindow1, tracePath, sameName),
  ];
  const userAWindow1Run = createAnalysisRun(db, windows.userAWindow1, uploads[0], 'running');
  const userAWindow2Run = createAnalysisRun(db, windows.userAWindow2, uploads[1], 'running');

  const traceIds = uploads.map(upload => upload.traceId);
  const localPaths = uploads.map(upload => upload.localPath);
  const aOwned = await ownedTraceIds(windows.userAWindow1.context);
  const bOwned = await ownedTraceIds(windows.userBWindow1.context);
  const cOwned = await ownedTraceIds(windows.userCWindow1.context);
  const a1VisibleToB = await readTraceMetadataForContext(uploads[0].traceId, windows.userBWindow1.context);
  const bVisibleToA = await readTraceMetadataForContext(uploads[2].traceId, windows.userAWindow1.context);
  const a1VisibleToC = await readTraceMetadataForContext(uploads[0].traceId, windows.userCWindow1.context);
  const cVisibleToA = await readTraceMetadataForContext(uploads[3].traceId, windows.userAWindow1.context);

  const checks = {
    sameFilenameUsesDistinctTraceIds: new Set(traceIds).size === uploads.length,
    sameFilenameUsesDistinctFiles: new Set(localPaths).size === uploads.length,
    traceAssetsHaveOneRowPerUpload: scalar<number>(
      db,
      'SELECT COUNT(*) AS value FROM trace_assets WHERE metadata_json LIKE ?',
      [`%"originalName":"${sameName}"%`],
    ) === uploads.length,
    ownerGuardAllowsOwnTwoWindowUploads: aOwned.includes(uploads[0].traceId)
      && aOwned.includes(uploads[1].traceId),
    workspaceRbacAllowsSameWorkspacePeerTraces: Boolean(a1VisibleToB) && Boolean(bVisibleToA),
    workspaceGuardBlocksCrossTenantTraces: !a1VisibleToC && !cVisibleToA,
    threeUsersHaveScopedTraceLists: aOwned.length === 3 && bOwned.length === 3 && cOwned.length === 1,
    twoWindowsHaveSeparateSessions: userAWindow1Run.sessionId !== userAWindow2Run.sessionId
      && userAWindow1Run.runId !== userAWindow2Run.runId,
  };

  return {
    checks,
    details: {
      traceIds,
      userAOwnedTraceIds: aOwned,
      userBOwnedTraceIds: bOwned,
      userCOwnedTraceIds: cOwned,
      userAWindow1Run,
      userAWindow2Run,
    },
  };
}

async function scenarioD2(
  db: Database.Database,
  tracePath: string,
  userAWindow1: WindowContext,
  userBWindow1: WindowContext,
  longSqlMs: number,
): Promise<ScenarioReport> {
  const aUpload = await simulateUpload(db, userAWindow1, tracePath, 'd2-user-a.pftrace');
  const aRun = createAnalysisRun(db, userAWindow1, aUpload, 'running');
  appendAgentEvent(db, userAWindow1, aRun.runId, 1, 'progress');

  let simulatedLongSqlDone = false;
  const simulatedLongSql = new Promise<void>((resolve) => {
    setTimeout(() => {
      simulatedLongSqlDone = true;
      resolve();
    }, longSqlMs);
  });

  await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.floor(longSqlMs / 2))));
  appendAgentEvent(db, userAWindow1, aRun.runId, 2, 'progress');
  const bStartedBeforeALongSqlDone = !simulatedLongSqlDone;

  const bUpload = await simulateUpload(db, userBWindow1, tracePath, 'd2-user-b.pftrace');
  const bRun = createAnalysisRun(db, userBWindow1, bUpload, 'pending');
  appendAgentEvent(db, userBWindow1, bRun.runId, 1, 'progress');

  const aReadableDuringBStart = await readTraceMetadataForContext(aUpload.traceId, userAWindow1.context);
  const aVisibleToB = await readTraceMetadataForContext(aUpload.traceId, userBWindow1.context);
  const bVisibleToA = await readTraceMetadataForContext(bUpload.traceId, userAWindow1.context);
  appendAgentEvent(db, userAWindow1, aRun.runId, 3, 'progress');

  await simulatedLongSql;
  db.prepare(`
    UPDATE analysis_runs SET status = 'completed', completed_at = ? WHERE id = ?
  `).run(Date.now(), aRun.runId);
  db.prepare(`
    UPDATE analysis_sessions SET status = 'completed', updated_at = ? WHERE id = ?
  `).run(Date.now(), aRun.sessionId);
  appendAgentEvent(db, userAWindow1, aRun.runId, 4, 'analysis_completed');

  const aRunEventCursors = db.prepare<unknown[], { cursor: number }>(`
    SELECT cursor FROM agent_events WHERE run_id = ? ORDER BY cursor ASC
  `).all(aRun.runId).map(row => row.cursor);
  const bRunEventCursors = db.prepare<unknown[], { cursor: number }>(`
    SELECT cursor FROM agent_events WHERE run_id = ? ORDER BY cursor ASC
  `).all(bRun.runId).map(row => row.cursor);
  const bRunStatus = scalar<string>(
    db,
    'SELECT status AS value FROM analysis_runs WHERE id = ?',
    [bRun.runId],
  );
  const aSessionTraceId = scalar<string>(
    db,
    'SELECT trace_id AS value FROM analysis_sessions WHERE id = ?',
    [aRun.sessionId],
  );
  const aFileStillExists = fs.existsSync(aUpload.localPath);

  const checks = {
    bCanStartWhileALongSqlPending: bStartedBeforeALongSqlDone && Boolean(bRun.runId),
    aTraceReadableDuringBStart: Boolean(aReadableDuringBStart) && aFileStillExists,
    workspaceRbacAllowsPeerTraceReadsDuringLongSql: Boolean(aVisibleToB) && Boolean(bVisibleToA),
    aEventStreamContinuesAfterBStart: aRunEventCursors.join(',') === '1,2,3,4',
    bRunCanQueueOrRun: bRunStatus === 'pending' || bRunStatus === 'running',
    runEventsDoNotMix: bRunEventCursors.join(',') === '1',
    aSessionStillPointsAtOriginalTrace: aSessionTraceId === aUpload.traceId,
  };

  return {
    checks,
    details: {
      aTraceId: aUpload.traceId,
      bTraceId: bUpload.traceId,
      aRun,
      bRun,
      aRunEventCursors,
      bRunEventCursors,
      bRunStatus,
    },
  };
}

function allChecksPassed(report: EnterpriseWindowRegressionReport): boolean {
  return Object.values(report.scenarios).every(scenario =>
    Object.values(scenario.checks).every(Boolean),
  );
}

function scenarioPassed(scenario: ScenarioReport): boolean {
  return Object.values(scenario.checks).every(Boolean);
}

export async function runEnterpriseWindowRegression(
  input: EnterpriseWindowRegressionOptions = {},
): Promise<EnterpriseWindowRegressionReport> {
  const tracePath = input.tracePath ? path.resolve(input.tracePath) : resolveDefaultTracePath();
  const createdUploadRoot = !input.uploadRoot;
  const uploadRoot = input.uploadRoot
    ? path.resolve(input.uploadRoot)
    : await fsp.mkdtemp(path.join(os.tmpdir(), 'smartperfetto-enterprise-window-'));
  const previousUploadRoot = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploadRoot;

  const db = new Database(':memory:');
  applyEnterpriseMinimalSchema(db);

  try {
    const windows = {
      userAWindow1: context('user-a-window-1', {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        windowId: 'window-a-1',
      }),
      userAWindow2: context('user-a-window-2', {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
        windowId: 'window-a-2',
      }),
      userBWindow1: context('user-b-window-1', {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-b',
        windowId: 'window-b-1',
      }),
      userCWindow1: context('user-c-window-1', {
        tenantId: 'tenant-b',
        workspaceId: 'workspace-c',
        userId: 'user-c',
        windowId: 'window-c-1',
      }),
    };

    const scenarios = {
      D1: await scenarioD1(db, tracePath, windows),
      D2: await scenarioD2(
        db,
        tracePath,
        windows.userAWindow1,
        windows.userBWindow1,
        input.longSqlMs ?? 100,
      ),
    };
    const report: EnterpriseWindowRegressionReport = {
      timestamp: new Date().toISOString(),
      passed: false,
      checks: {
        D1: scenarioPassed(scenarios.D1),
        D2: scenarioPassed(scenarios.D2),
      },
      uploadRoot,
      tracePath,
      scenarios,
      coverageLimitations: [
        'D1 covers same-name trace isolation across three users and two windows at the trace metadata, TraceAsset, workspace RBAC, and analysis session/run schema layers.',
        'D2 covers a deterministic long-SQL window at the run/event metadata layer without invoking a real LLM provider.',
        'Production TraceProcessorLease holder/state assertions are covered by the §0.4.4 lease store and route tests; backend proxy and queue behavior remain future §0.7 D1/D2 final-acceptance work.',
      ],
    };
    report.passed = allChecksPassed(report);

    const outputPath = input.outputPath
      ? path.resolve(input.outputPath)
      : path.resolve(
          process.cwd(),
          'test-output',
          `enterprise-window-regression-${Date.now()}.json`,
        );
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`Report written to: ${outputPath}`);

    return report;
  } finally {
    db.close();
    if (previousUploadRoot === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = previousUploadRoot;
    }
    if (createdUploadRoot && !input.keepTemp) {
      await fsp.rm(uploadRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runEnterpriseWindowRegression(options)
    .then((report) => {
      if (!report.passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
