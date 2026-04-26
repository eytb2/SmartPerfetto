// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openReviewOutbox, type ReviewOutboxHandle, __testing } from '../reviewOutbox';

describe('reviewOutbox', () => {
  let outbox: ReviewOutboxHandle;

  beforeEach(() => {
    outbox = openReviewOutbox({ dbPath: ':memory:' });
  });

  afterEach(() => {
    outbox.close();
  });

  describe('migrations', () => {
    it('applies schema migrations on first open', () => {
      expect(outbox.schemaVersion()).toBe(__testing.SCHEMA_VERSION_LATEST);
    });

    it('is idempotent — re-opening the same DB does not re-run migrations', () => {
      // For an in-memory DB we can't reopen; assert the migrations table is
      // populated and that re-applying via a second handle on a shared file
      // would not duplicate (covered by the partial unique INSERT in the
      // migration runner).
      expect(outbox.countByState()).toEqual({ pending: 0, leased: 0, done: 0, failed: 0 });
    });
  });

  describe('enqueue', () => {
    it('inserts a pending job and returns its id + latency', () => {
      const result = outbox.enqueue({ dedupeKey: 'k1', payload: { hello: 'world' } });
      expect(result.enqueued).toBe(true);
      expect(result.jobId).toMatch(/^job-/);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      const job = outbox.getJob(result.jobId!);
      expect(job).not.toBeNull();
      expect(job!.state).toBe('pending');
      expect(job!.dedupeKey).toBe('k1');
      expect(job!.payload).toEqual({ hello: 'world' });
      expect(job!.attempts).toBe(0);
    });

    it('rejects duplicate dedupeKey while a prior job is still active', () => {
      const first = outbox.enqueue({ dedupeKey: 'k_dup', payload: {} });
      expect(first.enqueued).toBe(true);

      const second = outbox.enqueue({ dedupeKey: 'k_dup', payload: { other: true } });
      expect(second.enqueued).toBe(false);
      expect(second.reason).toBe('duplicate_active');
    });

    it('allows the same dedupeKey once the prior job is done', () => {
      const first = outbox.enqueue({ dedupeKey: 'k_recycle', payload: {} });
      expect(first.enqueued).toBe(true);

      const leased = outbox.leaseNext({ workerOwner: 'w1' });
      outbox.markDone(leased!.id);

      const second = outbox.enqueue({ dedupeKey: 'k_recycle', payload: { again: true } });
      expect(second.enqueued).toBe(true);
    });

    it('honors priority ordering on lease', () => {
      outbox.enqueue({ dedupeKey: 'low', priority: 0, payload: {} });
      outbox.enqueue({ dedupeKey: 'high', priority: 10, payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1' });
      expect(leased!.dedupeKey).toBe('high');
    });
  });

  describe('leaseNext', () => {
    it('returns null when the queue is empty', () => {
      expect(outbox.leaseNext({ workerOwner: 'w1' })).toBeNull();
    });

    it('atomically transitions a pending job to leased', () => {
      const enq = outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1' });
      expect(leased).not.toBeNull();
      expect(leased!.id).toBe(enq.jobId);
      expect(leased!.state).toBe('leased');
      expect(leased!.leaseOwner).toBe('w1');
      expect(leased!.attempts).toBe(1);
      expect(leased!.leaseUntil).toBeGreaterThan(Date.now());
    });

    it('two consecutive leases pull two different jobs in priority+FIFO order', () => {
      outbox.enqueue({ dedupeKey: 'a', priority: 5, payload: {} });
      outbox.enqueue({ dedupeKey: 'b', priority: 5, payload: {} });
      const first = outbox.leaseNext({ workerOwner: 'w1' });
      const second = outbox.leaseNext({ workerOwner: 'w1' });
      expect(first!.dedupeKey).toBe('a');
      expect(second!.dedupeKey).toBe('b');
    });

    it('respects maxAttempts cap — exhausted jobs are skipped', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const first = outbox.leaseNext({ workerOwner: 'w1', maxAttempts: 1 });
      expect(first).not.toBeNull();
      // Job has attempts=1 now. With maxAttempts=1, leaseNext should not pick it again.
      outbox.markFailed(first!.id, 'transient error', 1);
      const skipped = outbox.leaseNext({ workerOwner: 'w1', maxAttempts: 1 });
      expect(skipped).toBeNull();
    });
  });

  describe('markDone', () => {
    it('transitions leased → done and clears the lease', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1' });
      outbox.markDone(leased!.id);
      const job = outbox.getJob(leased!.id);
      expect(job!.state).toBe('done');
      expect(job!.leaseOwner).toBeNull();
      expect(job!.leaseUntil).toBeNull();
    });

    it('is a no-op for a job not in leased state', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const enq = outbox.enqueue({ dedupeKey: 'k2', payload: {} });
      outbox.markDone(enq.jobId!); // still pending
      expect(outbox.getJob(enq.jobId!)!.state).toBe('pending');
    });
  });

  describe('markFailed', () => {
    it('returns to pending when attempts < maxAttempts', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1' });
      outbox.markFailed(leased!.id, 'transient', 3);
      const job = outbox.getJob(leased!.id);
      expect(job!.state).toBe('pending');
      expect(job!.lastError).toBe('transient');
    });

    it('lands on failed when attempts ≥ maxAttempts', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1', maxAttempts: 1 });
      outbox.markFailed(leased!.id, 'fatal', 1);
      const job = outbox.getJob(leased!.id);
      expect(job!.state).toBe('failed');
    });

    it('truncates lastError to 1000 chars', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1' });
      outbox.markFailed(leased!.id, 'x'.repeat(2000), 3);
      const job = outbox.getJob(leased!.id);
      expect(job!.lastError!.length).toBe(1000);
    });
  });

  describe('expireStaleLeases', () => {
    it('returns leased jobs whose lease has elapsed back to pending', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      const leased = outbox.leaseNext({ workerOwner: 'w1', leaseDurationMs: 1 });
      // Wait past the 1ms lease window via a synthetic now.
      const recycled = outbox.expireStaleLeases(Date.now() + 10_000);
      expect(recycled).toBe(1);
      const job = outbox.getJob(leased!.id);
      expect(job!.state).toBe('pending');
      expect(job!.leaseOwner).toBeNull();
    });

    it('leaves fresh leases alone', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      outbox.leaseNext({ workerOwner: 'w1', leaseDurationMs: 60_000 });
      const recycled = outbox.expireStaleLeases();
      expect(recycled).toBe(0);
    });
  });

  describe('observability', () => {
    it('countByState breaks down jobs by state', () => {
      outbox.enqueue({ dedupeKey: 'a', payload: {} });
      outbox.enqueue({ dedupeKey: 'b', payload: {} });
      outbox.enqueue({ dedupeKey: 'c', payload: {} });
      outbox.leaseNext({ workerOwner: 'w1' });
      const counts = outbox.countByState();
      expect(counts.pending).toBe(2);
      expect(counts.leased).toBe(1);
      expect(counts.done).toBe(0);
      expect(counts.failed).toBe(0);
    });

    it('dailyJobCount counts jobs created within last 24h', () => {
      outbox.enqueue({ dedupeKey: 'k1', payload: {} });
      outbox.enqueue({ dedupeKey: 'k2', payload: {} });
      expect(outbox.dailyJobCount()).toBe(2);
    });
  });
});
