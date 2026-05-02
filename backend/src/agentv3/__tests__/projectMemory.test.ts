// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {describe, it, expect, beforeEach, afterEach} from '@jest/globals';

import {ProjectMemory} from '../projectMemory';
import {
  type MemoryPromotionPolicy,
  type ProjectMemoryEntry,
} from '../../types/sparkContracts';

let tmpDir: string;
let storagePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-test-'));
  storagePath = path.join(tmpDir, 'project-memory.json');
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

function makeEntry(
  overrides: Partial<ProjectMemoryEntry> = {},
): ProjectMemoryEntry {
  return {
    entryId: 'sha256:test001',
    scope: 'project',
    projectKey: 'com.example/pixel-9',
    tags: ['scrolling', 'binder'],
    insight: 'Binder S>5ms before Choreographer doFrame',
    confidence: 0.78,
    status: 'provisional',
    createdAt: 1714600000000,
    ...overrides,
  };
}

const REVIEWER_POLICY: MemoryPromotionPolicy = {
  fromScope: 'project',
  toScope: 'world',
  trigger: 'reviewer_approval',
  reviewer: 'chris',
  promotedAt: 1714600000000,
};

describe('ProjectMemory — basic CRUD', () => {
  it('saves and reads back a project entry', () => {
    const store = new ProjectMemory(storagePath);
    const entry = makeEntry();
    store.saveProjectMemoryEntry(entry);
    expect(store.getProjectMemoryEntry(entry.entryId)).toEqual(entry);
  });

  it('returns undefined for unknown entryId', () => {
    const store = new ProjectMemory(storagePath);
    expect(store.getProjectMemoryEntry('nope')).toBeUndefined();
  });

  it('removeProjectMemoryEntry returns true when present', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a'}));
    expect(store.removeProjectMemoryEntry('a')).toBe(true);
    expect(store.removeProjectMemoryEntry('a')).toBe(false);
  });

  it('replaces an entry on re-save with the same id', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(
      makeEntry({entryId: 'a', insight: 'old'}),
    );
    store.saveProjectMemoryEntry(
      makeEntry({entryId: 'a', insight: 'new'}),
    );
    expect(store.getProjectMemoryEntry('a')?.insight).toBe('new');
  });
});

describe('ProjectMemory — save invariants', () => {
  it('rejects scope=session entries (those belong elsewhere)', () => {
    const store = new ProjectMemory(storagePath);
    expect(() =>
      store.saveProjectMemoryEntry(
        makeEntry({scope: 'session' as never}),
      ),
    ).toThrow(/session/);
  });

  it("rejects scope='world' entries without a promotionPolicy", () => {
    const store = new ProjectMemory(storagePath);
    expect(() =>
      store.saveProjectMemoryEntry(makeEntry({scope: 'world'})),
    ).toThrow(/promotionPolicy/);
  });

  it("accepts scope='world' entries with a valid promotionPolicy", () => {
    const store = new ProjectMemory(storagePath);
    expect(() =>
      store.saveProjectMemoryEntry(
        makeEntry({scope: 'world', promotionPolicy: REVIEWER_POLICY}),
      ),
    ).not.toThrow();
  });

  it('rejects entries whose promotionPolicy carries an unrecognized trigger', () => {
    const store = new ProjectMemory(storagePath);
    expect(() =>
      store.saveProjectMemoryEntry(
        makeEntry({
          scope: 'world',
          promotionPolicy: {
            ...REVIEWER_POLICY,
            trigger: 'auto_inferred' as never,
          },
        }),
      ),
    ).toThrow(/invalid promotion trigger/i);
  });
});

describe('ProjectMemory — listing', () => {
  function seed(store: ProjectMemory): void {
    store.saveProjectMemoryEntry(
      makeEntry({entryId: 'a', scope: 'project', tags: ['scrolling']}),
    );
    store.saveProjectMemoryEntry(
      makeEntry({
        entryId: 'b',
        scope: 'project',
        projectKey: 'com.other/pixel',
        tags: ['anr'],
      }),
    );
    store.saveProjectMemoryEntry(
      makeEntry({
        entryId: 'c',
        scope: 'world',
        tags: ['lmk'],
        promotionPolicy: REVIEWER_POLICY,
      }),
    );
  }

  it('returns everything sorted by id by default', () => {
    const store = new ProjectMemory(storagePath);
    seed(store);
    expect(
      store.listProjectMemoryEntries().map(e => e.entryId),
    ).toEqual(['a', 'b', 'c']);
  });

  it('respects scope filter', () => {
    const store = new ProjectMemory(storagePath);
    seed(store);
    expect(
      store.listProjectMemoryEntries({scope: 'world'}).map(e => e.entryId),
    ).toEqual(['c']);
  });

  it('respects projectKey filter', () => {
    const store = new ProjectMemory(storagePath);
    seed(store);
    const list = store.listProjectMemoryEntries({
      projectKey: 'com.other/pixel',
    });
    expect(list.map(e => e.entryId)).toEqual(['b']);
  });

  it('respects anyOfTags filter', () => {
    const store = new ProjectMemory(storagePath);
    seed(store);
    const list = store.listProjectMemoryEntries({anyOfTags: ['scrolling']});
    expect(list.map(e => e.entryId)).toEqual(['a']);
  });
});

describe('ProjectMemory — recall (read-only)', () => {
  it('ranks entries by tag overlap with the query', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(
      makeEntry({entryId: 'a', tags: ['scrolling', 'binder']}),
    );
    store.saveProjectMemoryEntry(
      makeEntry({entryId: 'b', tags: ['anr', 'broadcast']}),
    );
    const hits = store.recallProjectMemory({tags: ['scrolling']});
    expect(hits[0].entry.entryId).toBe('a');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('respects topK', () => {
    const store = new ProjectMemory(storagePath);
    for (let i = 0; i < 7; i++) {
      store.saveProjectMemoryEntry(
        makeEntry({entryId: `a${i}`, tags: ['scrolling']}),
      );
    }
    const hits = store.recallProjectMemory({tags: ['scrolling'], topK: 3});
    expect(hits).toHaveLength(3);
  });

  it('skips entries with unsupportedReason', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(
      makeEntry({
        entryId: 'a',
        tags: ['scrolling'],
        unsupportedReason: 'evicted',
      }),
    );
    expect(store.recallProjectMemory({tags: ['scrolling']})).toHaveLength(0);
  });

  it('does NOT mutate the store across many recall calls (P1#1 invariant)', () => {
    const store = new ProjectMemory(storagePath);
    const entry = makeEntry({entryId: 'a'});
    store.saveProjectMemoryEntry(entry);
    const before = fs.readFileSync(storagePath, 'utf-8');

    for (let i = 0; i < 1000; i++) {
      store.recallProjectMemory({tags: ['scrolling']});
    }
    const after = fs.readFileSync(storagePath, 'utf-8');
    expect(after).toBe(before);
  });

  it('returned hit is a copy — mutating it does not affect storage', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', tags: ['t']}));
    const [hit] = store.recallProjectMemory({tags: ['t']});
    hit.entry.insight = 'mutated';
    hit.entry.tags.push('extra');
    const stored = store.getProjectMemoryEntry('a')!;
    expect(stored.insight).not.toBe('mutated');
    expect(stored.tags).not.toContain('extra');
  });
});

describe('ProjectMemory — promotion', () => {
  it('records audit log on promotion', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    store.promoteEntry('a', REVIEWER_POLICY);
    const audit = store.getPromotionAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0].entryId).toBe('a');
    expect(audit[0].policy.toScope).toBe('world');
  });

  it("rejects auto_inferred trigger (Codex P1#3 invariant)", () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    expect(() =>
      store.promoteEntry('a', {
        ...REVIEWER_POLICY,
        trigger: 'auto_inferred' as never,
      }),
    ).toThrow(/auto-promotion is forbidden/i);
  });

  it("rejects promotion to 'world' without reviewer_approval", () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    expect(() =>
      store.promoteEntry('a', {
        ...REVIEWER_POLICY,
        trigger: 'user_feedback',
      }),
    ).toThrow(/scope='world' requires trigger='reviewer_approval'/);
  });

  it('rejects reviewer_approval without a reviewer field', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    expect(() =>
      store.promoteEntry('a', {
        ...REVIEWER_POLICY,
        reviewer: undefined,
      }),
    ).toThrow(/reviewer/);
  });

  it('rejects skill_eval_pass without an evalCaseId', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    expect(() =>
      store.promoteEntry('a', {
        fromScope: 'project',
        toScope: 'project',
        trigger: 'skill_eval_pass',
        promotedAt: 1714600000000,
      }),
    ).toThrow(/evalCaseId/);
  });

  it('promoted entry carries the policy on its promotionPolicy field', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    store.promoteEntry('a', REVIEWER_POLICY);
    const entry = store.getProjectMemoryEntry('a')!;
    expect(entry.scope).toBe('world');
    expect(entry.promotionPolicy).toEqual(REVIEWER_POLICY);
    expect(entry.promotionLevel).toBe(1);
  });

  it('rejects promotion when the entry is missing', () => {
    const store = new ProjectMemory(storagePath);
    expect(() => store.promoteEntry('missing', REVIEWER_POLICY)).toThrow(
      /not found/,
    );
  });

  it('rejects promotion when fromScope does not match current scope', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(
      makeEntry({entryId: 'a', scope: 'project'}),
    );
    expect(() =>
      store.promoteEntry('a', {
        ...REVIEWER_POLICY,
        fromScope: 'session',
      }),
    ).toThrow(/does not match/);
  });

  it('removed entry does NOT erase its audit row', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    store.promoteEntry('a', REVIEWER_POLICY);
    store.removeProjectMemoryEntry('a');
    expect(store.getPromotionAudit()).toHaveLength(1);
  });
});

describe('ProjectMemory — persistence', () => {
  it('persists entries and audit log across instances', () => {
    const store1 = new ProjectMemory(storagePath);
    store1.saveProjectMemoryEntry(makeEntry({entryId: 'a'}));
    store1.promoteEntry('a', REVIEWER_POLICY);

    const store2 = new ProjectMemory(storagePath);
    expect(store2.getProjectMemoryEntry('a')?.scope).toBe('world');
    expect(store2.getPromotionAudit()).toHaveLength(1);
  });

  it('survives corrupted JSON without losing the file', () => {
    fs.writeFileSync(storagePath, 'not-json{', 'utf-8');
    const store = new ProjectMemory(storagePath);
    expect(store.getProjectMemoryEntry('a')).toBeUndefined();
    expect(fs.existsSync(storagePath)).toBe(true);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a'}));
    expect(store.getProjectMemoryEntry('a')).toBeDefined();
  });

  it('getStats counts entries by scope', () => {
    const store = new ProjectMemory(storagePath);
    store.saveProjectMemoryEntry(makeEntry({entryId: 'a', scope: 'project'}));
    store.saveProjectMemoryEntry(makeEntry({entryId: 'b', scope: 'project'}));
    store.saveProjectMemoryEntry(
      makeEntry({
        entryId: 'c',
        scope: 'world',
        promotionPolicy: REVIEWER_POLICY,
      }),
    );
    expect(store.getStats()).toEqual({project: 2, world: 1});
  });
});
