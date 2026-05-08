// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import fs from 'fs';
import os from 'os';
import path from 'path';

import {describe, it, expect, beforeEach, afterEach} from '@jest/globals';

import {ENTERPRISE_FEATURE_FLAG_ENV} from '../../config';
import {ProjectMemory} from '../../agentv3/projectMemory';
import {BaselineStore, deriveBaselineId} from '../baselineStore';
import {CaseGraph} from '../caseGraph';
import {CaseLibrary} from '../caseLibrary';
import {ENTERPRISE_DB_PATH_ENV, openEnterpriseDb} from '../enterpriseDb';
import {RagStore} from '../ragStore';
import type {KnowledgeScope} from '../scopedKnowledgeStore';
import {
  type BaselineRecord,
  type CaseEdge,
  type CaseNode,
  type PerfBaselineKey,
  type ProjectMemoryEntry,
  type RagChunk,
  makeSparkProvenance,
} from '../../types/sparkContracts';

const originalEnv = {
  enterprise: process.env[ENTERPRISE_FEATURE_FLAG_ENV],
  enterpriseDbPath: process.env[ENTERPRISE_DB_PATH_ENV],
};

const scopeA: KnowledgeScope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'user-a',
};
const scopeB: KnowledgeScope = {
  tenantId: 'tenant-b',
  workspaceId: 'workspace-b',
  userId: 'user-b',
};
const systemScope: KnowledgeScope = {
  tenantId: 'system',
  workspaceId: 'system',
  userId: 'system',
};

let tmpDir: string;
let dbPath: string;

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
    chunkId: 'shared-chunk',
    kind: 'androidperformance.com',
    uri: 'https://androidperformance.com/test',
    snippet: 'binder latency tenant a',
    indexedAt: 1714600000000,
    ...overrides,
  };
}

const BASELINE_KEY: PerfBaselineKey = {
  appId: 'anon-app',
  deviceId: 'anon-device',
  buildId: 'main',
  cuj: 'scroll',
};

function makeBaseline(
  overrides: Partial<BaselineRecord> = {},
): BaselineRecord {
  return {
    ...makeSparkProvenance({source: 'enterprise-knowledge-scope-test'}),
    baselineId: deriveBaselineId(BASELINE_KEY),
    artifactId: 'artifact-1',
    capturedAt: 1714600000000,
    sampleCount: 5,
    key: BASELINE_KEY,
    status: 'reviewed',
    redactionState: 'raw',
    windowStartMs: 1714000000000,
    windowEndMs: 1714600000000,
    metrics: [],
    ...overrides,
  };
}

function makeMemoryEntry(
  overrides: Partial<ProjectMemoryEntry> = {},
): ProjectMemoryEntry {
  return {
    entryId: 'shared-memory',
    scope: 'project',
    projectKey: 'anon-app/anon-device',
    tags: ['scrolling'],
    insight: 'tenant a memory',
    confidence: 0.8,
    status: 'provisional',
    createdAt: 1714600000000,
    ...overrides,
  };
}

function makeCase(overrides: Partial<CaseNode> = {}): CaseNode {
  return {
    ...makeSparkProvenance({source: 'enterprise-knowledge-scope-test'}),
    caseId: 'shared-case',
    title: 'Tenant A case',
    status: 'draft',
    redactionState: 'raw',
    tags: ['scrolling'],
    findings: [{id: 'f1', severity: 'warning', title: 'Frame jitter'}],
    ...overrides,
  };
}

function makeEdge(overrides: Partial<CaseEdge> = {}): CaseEdge {
  return {
    edgeId: 'shared-edge',
    fromCaseId: 'shared-case',
    toCaseId: 'related-case',
    relation: 'similar_root_cause',
    weight: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-knowledge-scope-'));
  dbPath = path.join(tmpDir, 'enterprise.sqlite');
  process.env[ENTERPRISE_FEATURE_FLAG_ENV] = 'true';
  process.env[ENTERPRISE_DB_PATH_ENV] = dbPath;
});

afterEach(() => {
  restoreEnvValue(ENTERPRISE_FEATURE_FLAG_ENV, originalEnv.enterprise);
  restoreEnvValue(ENTERPRISE_DB_PATH_ENV, originalEnv.enterpriseDbPath);
  fs.rmSync(tmpDir, {recursive: true, force: true});
});

describe('enterprise knowledge scope', () => {
  it('filters RAG candidates by tenant/workspace before keyword retrieval', () => {
    const store = new RagStore(path.join(tmpDir, 'rag.json'));
    store.addChunk(makeChunk({snippet: 'binder latency tenant a'}), scopeA);
    store.addChunk(makeChunk({snippet: 'binder latency tenant b'}), scopeB);
    store.addChunk(
      makeChunk({
        chunkId: 'system-chunk',
        snippet: 'binder latency system knowledge',
      }),
      systemScope,
    );

    const result = store.search('binder latency', {scope: scopeA});

    expect(result.results.map(hit => hit.chunk?.snippet).sort()).toEqual([
      'binder latency system knowledge',
      'binder latency tenant a',
    ]);
    expect(result.results.map(hit => hit.chunk?.snippet)).not.toContain(
      'binder latency tenant b',
    );
  });

  it('keeps baseline, memory, case, and case graph rows isolated by scope', () => {
    const baselineStore = new BaselineStore(path.join(tmpDir, 'baselines.json'));
    const memoryStore = new ProjectMemory(path.join(tmpDir, 'memory.json'));
    const caseLibrary = new CaseLibrary(path.join(tmpDir, 'cases.json'));
    const caseGraph = new CaseGraph(path.join(tmpDir, 'edges.json'));

    baselineStore.addBaseline(
      makeBaseline({curatorNote: 'tenant-a'}),
      scopeA,
    );
    baselineStore.addBaseline(
      makeBaseline({curatorNote: 'tenant-b'}),
      scopeB,
    );
    memoryStore.saveProjectMemoryEntry(
      makeMemoryEntry({insight: 'tenant a memory'}),
      scopeA,
    );
    memoryStore.saveProjectMemoryEntry(
      makeMemoryEntry({insight: 'tenant b memory'}),
      scopeB,
    );
    caseLibrary.saveCase(makeCase({title: 'Tenant A case'}), scopeA);
    caseLibrary.saveCase(makeCase({title: 'Tenant B case'}), scopeB);
    caseGraph.addEdge(makeEdge({note: 'tenant-a'}), scopeA);
    caseGraph.addEdge(makeEdge({note: 'tenant-b'}), scopeB);

    expect(
      baselineStore.getBaseline(deriveBaselineId(BASELINE_KEY), scopeA)
        ?.curatorNote,
    ).toBe('tenant-a');
    expect(
      baselineStore.getBaseline(deriveBaselineId(BASELINE_KEY), scopeB)
        ?.curatorNote,
    ).toBe('tenant-b');
    expect(
      memoryStore.recallProjectMemory({tags: ['scrolling']}, scopeA)
        .map(hit => hit.entry.insight),
    ).toEqual(['tenant a memory']);
    expect(caseLibrary.listCases({}, scopeA).map(c => c.title)).toEqual([
      'Tenant A case',
    ]);
    expect(caseGraph.listEdges(scopeA).map(edge => edge.note)).toEqual([
      'tenant-a',
    ]);

    const db = openEnterpriseDb(dbPath);
    try {
      const rows = db.prepare<unknown[], {
        tenant_id: string;
        workspace_id: string;
        scope: string;
      }>(`
        SELECT tenant_id, workspace_id, scope
        FROM memory_entries
        ORDER BY tenant_id, workspace_id, scope
      `).all();
      expect(rows).toEqual(expect.arrayContaining([
        {tenant_id: 'tenant-a', workspace_id: 'workspace-a', scope: 'baseline'},
        {tenant_id: 'tenant-a', workspace_id: 'workspace-a', scope: 'memory:project'},
        {tenant_id: 'tenant-a', workspace_id: 'workspace-a', scope: 'case:draft'},
        {tenant_id: 'tenant-a', workspace_id: 'workspace-a', scope: 'case_edge:similar_root_cause'},
        {tenant_id: 'tenant-b', workspace_id: 'workspace-b', scope: 'baseline'},
        {tenant_id: 'tenant-b', workspace_id: 'workspace-b', scope: 'memory:project'},
      ]));
    } finally {
      db.close();
    }
  });
});
