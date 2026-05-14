// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Tests for FileSystemSceneReportStore. Uses a real per-test tmp directory
 * (cheaper than mocking fs at this level, and exercises the actual atomic
 * rename + index parsing paths).
 */

import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { uuidv4 } from '../../../utils/uuid';

import { FileSystemSceneReportStore } from '../sceneReportStore';
import type { SceneReport } from '../../../agent/scene/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(opts: {
  reportId?: string;
  hash?: string | null;
  expiresAt?: number | null;
  createdAt?: number;
  pipelineVersion?: 'v2';
} = {}): SceneReport {
  const reportId = opts.reportId ?? uuidv4();
  return {
    reportId,
    traceHash: opts.hash ?? null,
    traceId: `trace-${reportId}`,
    traceOrigin: opts.hash ? 'file' : 'external_rpc',
    cachePolicy: opts.hash ? 'disk_7d' : 'memory_session',
    expiresAt: opts.expiresAt ?? null,
    createdAt: opts.createdAt ?? Date.now(),
    traceMeta: { durationSec: 12 },
    displayedScenes: [],
    cachedDataEnvelopes: [],
    jobs: [],
    summary: null,
    insights: [],
    partialReport: false,
    totalDurationMs: 1000,
    generatedBy: {
      runtime: 'claude-sdk',
      pipelineVersion: opts.pipelineVersion ?? 'v2',
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FileSystemSceneReportStore', () => {
  let dir: string;
  let store: FileSystemSceneReportStore;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `scene-report-store-test-${uuidv4()}`);
    store = new FileSystemSceneReportStore(dir);
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // save / loadById
  // -------------------------------------------------------------------------

  describe('save + loadById', () => {
    it('round-trips a report', async () => {
      const report = makeReport({ hash: 'abc123', expiresAt: Date.now() + 10_000 });
      await store.save(report);

      const loaded = await store.loadById(report.reportId);
      expect(loaded).not.toBeNull();
      expect(loaded?.reportId).toBe(report.reportId);
      expect(loaded?.traceHash).toBe('abc123');
      expect(loaded?.traceMeta.durationSec).toBe(12);
    });

    it('returns null for an unknown reportId', async () => {
      expect(await store.loadById('does-not-exist')).toBeNull();
    });

    it('rejects mismatched pipelineVersion at load time', async () => {
      const report = makeReport({ hash: 'h1' });
      // Force a non-v2 version on disk to simulate a future schema change.
      (report.generatedBy as any).pipelineVersion = 'v3';
      await store.save(report);

      const loaded = await store.loadById(report.reportId);
      expect(loaded).toBeNull();
    });

    it('creates the report directory lazily', async () => {
      // dir doesn't exist before first save.
      await expect(fsp.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
      await store.save(makeReport({ hash: 'h' }));
      const stats = await fsp.stat(dir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('writes via .tmp + rename and leaves no .tmp files behind', async () => {
      await store.save(makeReport({ hash: 'h1' }));
      await store.save(makeReport({ hash: 'h2' }));
      const entries = await fsp.readdir(dir);
      const tmpFiles = entries.filter((f) => f.includes('.tmp.'));
      expect(tmpFiles).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // loadByHash + TTL
  // -------------------------------------------------------------------------

  describe('loadByHash', () => {
    it('returns the matching report by hash', async () => {
      const report = makeReport({ hash: 'h-match', expiresAt: Date.now() + 60_000 });
      await store.save(report);
      const loaded = await store.loadByHash('h-match');
      expect(loaded?.reportId).toBe(report.reportId);
    });

    it('returns null when no report matches the hash', async () => {
      await store.save(makeReport({ hash: 'h-other' }));
      expect(await store.loadByHash('h-missing')).toBeNull();
    });

    it('skips expired entries (expiresAt < Date.now())', async () => {
      const expired = makeReport({
        hash: 'h-expired',
        expiresAt: Date.now() - 1_000,
      });
      await store.save(expired);
      expect(await store.loadByHash('h-expired')).toBeNull();
      // loadById also gates on expiresAt — a stale reportId from a client
      // bookmark must not return an expired report between cleanup sweeps.
      expect(await store.loadById(expired.reportId)).toBeNull();
      // The file is still physically on disk until cleanupExpired runs.
      const onDisk = await fsp.readFile(
        path.join(dir, `${expired.reportId}.json`),
        'utf8',
      );
      expect(onDisk.length).toBeGreaterThan(0);
    });

    it('replacing a hash with a new report returns the new one', async () => {
      const first = makeReport({ hash: 'shared', expiresAt: Date.now() + 60_000 });
      await store.save(first);
      const second = makeReport({ hash: 'shared', expiresAt: Date.now() + 60_000 });
      await store.save(second);

      const loaded = await store.loadByHash('shared');
      expect(loaded?.reportId).toBe(second.reportId);
      expect(loaded?.reportId).not.toBe(first.reportId);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('removes the file and the index entry', async () => {
      const report = makeReport({ hash: 'h-del', expiresAt: Date.now() + 60_000 });
      await store.save(report);

      const removed = await store.delete(report.reportId);
      expect(removed).toBe(true);
      expect(await store.loadById(report.reportId)).toBeNull();
      expect(await store.loadByHash('h-del')).toBeNull();
    });

    it('returns false when the report is unknown', async () => {
      expect(await store.delete('nope')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupExpired
  // -------------------------------------------------------------------------

  describe('cleanupExpired', () => {
    it('removes only entries whose expiresAt is in the past', async () => {
      const now = Date.now();
      const stale = makeReport({ hash: 'stale', expiresAt: now - 5_000 });
      const fresh = makeReport({ hash: 'fresh', expiresAt: now + 5_000 });
      const noExpire = makeReport({ hash: 'noexp', expiresAt: null });
      await store.save(stale);
      await store.save(fresh);
      await store.save(noExpire);

      const removed = await store.cleanupExpired(now);
      expect(removed).toBe(1);

      // Stale gone, fresh + noexp still loadable.
      expect(await store.loadById(stale.reportId)).toBeNull();
      expect(await store.loadById(fresh.reportId)).not.toBeNull();
      expect(await store.loadById(noExpire.reportId)).not.toBeNull();
    });

    it('returns 0 when nothing is expired', async () => {
      await store.save(makeReport({ hash: 'h', expiresAt: Date.now() + 60_000 }));
      expect(await store.cleanupExpired(Date.now())).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency + corruption recovery
  // -------------------------------------------------------------------------

  describe('concurrent saves', () => {
    it('serialises and survives 10 parallel saves without losing entries', async () => {
      const reports = Array.from({ length: 10 }, (_, i) =>
        makeReport({ hash: `h-${i}`, expiresAt: Date.now() + 60_000 }),
      );
      await Promise.all(reports.map((r) => store.save(r)));

      for (const r of reports) {
        const loaded = await store.loadById(r.reportId);
        expect(loaded?.reportId).toBe(r.reportId);
      }
      // Index sanity: every hash resolves to its own report.
      for (let i = 0; i < 10; i++) {
        const loaded = await store.loadByHash(`h-${i}`);
        expect(loaded?.reportId).toBe(reports[i].reportId);
      }
    });

    it('keeps the queue alive after a failing op', async () => {
      // First op throws (the report file write tries to mkdir an unwritable path).
      // We simulate by saving a report with a bad reportId (path traversal-ish
      // characters that path.join still resolves but writeFile rejects).
      // Easier: monkey-patch the index path to a parent that doesn't exist.
      const original = (store as any).reportDir;
      (store as any).reportDir = '/dev/null/forbidden';
      const failing = makeReport({ hash: 'bad' });
      await expect(store.save(failing)).rejects.toBeDefined();

      // Restore the dir and prove the queue still flushes a healthy save.
      (store as any).reportDir = original;
      const good = makeReport({ hash: 'good', expiresAt: Date.now() + 60_000 });
      await store.save(good);
      expect(await store.loadByHash('good')).not.toBeNull();
    });
  });

  describe('corruption recovery', () => {
    it('treats a malformed index.json as empty and overwrites it on next save', async () => {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'index.json'), '{not valid json', 'utf8');

      // loadByHash should not throw even with garbage index.
      expect(await store.loadByHash('any')).toBeNull();

      // A subsequent save replaces the index entirely.
      const r = makeReport({ hash: 'fresh', expiresAt: Date.now() + 60_000 });
      await store.save(r);
      expect(await store.loadByHash('fresh')).not.toBeNull();
    });

    it('treats an unknown index version as empty', async () => {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(
        path.join(dir, 'index.json'),
        JSON.stringify({ version: 999, byHash: {}, byReport: {} }),
        'utf8',
      );
      expect(await store.loadByHash('any')).toBeNull();
    });
  });
});
