// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import express from 'express';
import { requireRequestContext } from '../middleware/auth';
import { openEnterpriseDb } from '../services/enterpriseDb';
import { createAnalysisResultSnapshotRepository } from '../services/analysisResultSnapshotStore';
import { createMultiTraceComparisonRunRepository } from '../services/multiTraceComparisonStore';
import {
  buildDeterministicComparisonResult,
  resolveComparisonMetricKeys,
} from '../services/comparisonResultService';
import { generateAiComparisonConclusion } from '../services/comparisonAiConclusionService';
import { persistComparisonHtmlReport } from '../services/comparisonHtmlReportService';
import { backfillStandardMetrics } from '../services/standardMetricBackfillService';
import { getTraceProcessorService } from '../services/traceProcessorService';
import { hasRbacPermission, sendForbidden } from '../services/rbac';
import type { AnalysisResultSnapshot, ComparisonMetricKey } from '../types/multiTraceComparison';

const router = express.Router();

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function reportArtifactExists(db: ReturnType<typeof openEnterpriseDb>, reportId: string): boolean {
  const row = db.prepare('SELECT 1 FROM report_artifacts WHERE id = ? LIMIT 1').get(reportId);
  return Boolean(row);
}

router.post('/', async (req, res) => {
  const context = requireRequestContext(req);
  if (!hasRbacPermission(context, 'comparison:create')) {
    sendForbidden(res, 'comparison:create permission is required');
    return;
  }

  const baselineSnapshotId = optionalString(req.body?.baselineSnapshotId);
  const candidateSnapshotIds = uniqueStrings(stringArray(req.body?.candidateSnapshotIds));
  const query = optionalString(req.body?.query) || 'Compare selected analysis results';
  const providerId = optionalString(req.body?.providerId);
  const metricKeys = resolveComparisonMetricKeys(stringArray(req.body?.metricKeys) as ComparisonMetricKey[]);
  const allowTraceBackfill = req.body?.allowTraceBackfill === true;
  const inputSnapshotIds = uniqueStrings([
    ...(baselineSnapshotId ? [baselineSnapshotId] : []),
    ...candidateSnapshotIds,
  ]);
  if (!baselineSnapshotId || inputSnapshotIds.length < 2) {
    res.status(400).json({
      success: false,
      error: 'baselineSnapshotId and at least one candidateSnapshotId are required',
    });
    return;
  }

  const db = openEnterpriseDb();
  try {
    const snapshotRepository = createAnalysisResultSnapshotRepository(db);
    const scope = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
    };
    const snapshots: AnalysisResultSnapshot[] = [];
    for (const snapshotId of inputSnapshotIds) {
      const snapshot = snapshotRepository.getSnapshot(scope, snapshotId);
      if (!snapshot) {
        res.status(404).json({
          success: false,
          error: 'Analysis result snapshot not found',
          snapshotId,
        });
        return;
      }
      snapshots.push(snapshot);
    }

    if (allowTraceBackfill) {
      const traceProcessor = getTraceProcessorService();
      for (const [index, snapshot] of snapshots.entries()) {
        const backfill = await backfillStandardMetrics({
          snapshot,
          metricKeys,
          traceProcessor,
          repository: snapshotRepository,
          scope,
        });
        snapshots[index] = backfill.snapshot;
      }
    }

    const repository = createMultiTraceComparisonRunRepository(db);
    const created = repository.createRun(scope, {
      baselineSnapshotId,
      candidateSnapshotIds,
      query,
      metricKeys,
      status: 'running',
    });
    let comparison = created;
    try {
      const result = buildDeterministicComparisonResult(snapshots, {
        baselineSnapshotId,
        metricKeys,
      });
      result.conclusion = await generateAiComparisonConclusion({
        result,
        query,
        providerId,
        providerScope: scope,
      });
      const report = persistComparisonHtmlReport({
        comparison: created,
        result,
        scope,
      });
      result.reportId = report.reportId;
      const persistedReportId = reportArtifactExists(db, report.reportId)
        ? report.reportId
        : undefined;
      comparison = repository.updateRun(scope, created.id, {
        status: 'completed',
        result,
        ...(persistedReportId ? { reportId: persistedReportId } : {}),
      }) || created;
    } catch (error) {
      repository.updateRun(scope, created.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    res.status(201).json({
      success: true,
      comparison,
    });
  } catch (error) {
    console.error('[ComparisonRoutes] Failed to create comparison:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create comparison',
    });
  } finally {
    db.close();
  }
});

router.get('/:comparisonId', (req, res) => {
  const context = requireRequestContext(req);
  if (!hasRbacPermission(context, 'comparison:read')) {
    sendForbidden(res, 'comparison:read permission is required');
    return;
  }

  const comparisonId = optionalString(req.params.comparisonId);
  if (!comparisonId) {
    res.status(400).json({
      success: false,
      error: 'comparisonId is required',
    });
    return;
  }

  const db = openEnterpriseDb();
  try {
    const repository = createMultiTraceComparisonRunRepository(db);
    const comparison = repository.getRun(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
      comparisonId,
    );
    if (!comparison) {
      res.status(404).json({
        success: false,
        error: 'Comparison run not found',
      });
      return;
    }
    res.json({
      success: true,
      comparison,
    });
  } catch (error) {
    console.error('[ComparisonRoutes] Failed to read comparison:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read comparison',
    });
  } finally {
    db.close();
  }
});

router.get('/:comparisonId/stream', (req, res) => {
  const context = requireRequestContext(req);
  if (!hasRbacPermission(context, 'comparison:read')) {
    sendForbidden(res, 'comparison:read permission is required');
    return;
  }

  const comparisonId = optionalString(req.params.comparisonId);
  if (!comparisonId) {
    res.status(400).json({
      success: false,
      error: 'comparisonId is required',
    });
    return;
  }

  const db = openEnterpriseDb();
  try {
    const repository = createMultiTraceComparisonRunRepository(db);
    const comparison = repository.getRun(
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
      comparisonId,
    );
    if (!comparison) {
      res.status(404).json({
        success: false,
        error: 'Comparison run not found',
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n');
    res.write(`event: comparison_state\n`);
    res.write(`data: ${JSON.stringify({ comparison })}\n\n`);
    res.end();
  } catch (error) {
    console.error('[ComparisonRoutes] Failed to stream comparison:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream comparison',
      });
    } else {
      res.end();
    }
  } finally {
    db.close();
  }
});

export default router;
