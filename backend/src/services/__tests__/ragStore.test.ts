// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {describe, it, expect, beforeEach, afterEach} from '@jest/globals';

import {RagStore, ragStoreRequiresLicense} from '../ragStore';
import type {RagChunk} from '../../types/sparkContracts';

let tmpDir: string;
let storagePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-store-test-'));
  storagePath = path.join(tmpDir, 'store.json');
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

function makeChunk(overrides: Partial<RagChunk> = {}): RagChunk {
  return {
    chunkId: 'sha256:test001',
    kind: 'androidperformance.com',
    uri: 'https://androidperformance.com/binder',
    snippet: 'binder transactions reveal cross-process latency',
    indexedAt: 1714600000000,
    ...overrides,
  };
}

describe('RagStore — basic CRUD', () => {
  it('adds and reads back a chunk', () => {
    const store = new RagStore(storagePath);
    const chunk = makeChunk({chunkId: 'a'});
    store.addChunk(chunk);
    expect(store.getChunk('a')).toEqual(chunk);
  });

  it('returns undefined for an unknown chunkId', () => {
    const store = new RagStore(storagePath);
    expect(store.getChunk('nope')).toBeUndefined();
  });

  it('removeChunk returns true when present, false otherwise', () => {
    const store = new RagStore(storagePath);
    store.addChunk(makeChunk({chunkId: 'a'}));
    expect(store.removeChunk('a')).toBe(true);
    expect(store.removeChunk('a')).toBe(false);
  });

  it('replaces a chunk on re-add with the same chunkId', () => {
    const store = new RagStore(storagePath);
    store.addChunk(makeChunk({chunkId: 'a', snippet: 'old'}));
    store.addChunk(makeChunk({chunkId: 'a', snippet: 'new'}));
    expect(store.getChunk('a')?.snippet).toBe('new');
  });
});

describe('RagStore — license gate', () => {
  it('rejects aosp chunks without a license', () => {
    const store = new RagStore(storagePath);
    expect(() =>
      store.addChunk(makeChunk({chunkId: 'a', kind: 'aosp'})),
    ).toThrow(/license/i);
  });

  it('rejects oem_sdk chunks without a license', () => {
    const store = new RagStore(storagePath);
    expect(() =>
      store.addChunk(makeChunk({chunkId: 'a', kind: 'oem_sdk'})),
    ).toThrow(/license/i);
  });

  it('accepts aosp chunks with Apache-2.0 license', () => {
    const store = new RagStore(storagePath);
    expect(() =>
      store.addChunk(
        makeChunk({chunkId: 'a', kind: 'aosp', license: 'Apache-2.0'}),
      ),
    ).not.toThrow();
  });

  it('blog chunks are not gated by license', () => {
    const store = new RagStore(storagePath);
    expect(() => store.addChunk(makeChunk())).not.toThrow();
  });

  it('ragStoreRequiresLicense reports the right kinds', () => {
    expect(ragStoreRequiresLicense('aosp')).toBe(true);
    expect(ragStoreRequiresLicense('oem_sdk')).toBe(true);
    expect(ragStoreRequiresLicense('androidperformance.com')).toBe(false);
    expect(ragStoreRequiresLicense('project_memory')).toBe(false);
    expect(ragStoreRequiresLicense('world_memory')).toBe(false);
    expect(ragStoreRequiresLicense('case_library')).toBe(false);
  });
});

describe('RagStore — persistence', () => {
  it('persists across instances at the same path', () => {
    const store1 = new RagStore(storagePath);
    store1.addChunk(makeChunk({chunkId: 'a', snippet: 'persisted'}));

    const store2 = new RagStore(storagePath);
    expect(store2.getChunk('a')?.snippet).toBe('persisted');
  });

  it('persisted file is valid JSON with schemaVersion 1', () => {
    const store = new RagStore(storagePath);
    store.addChunk(makeChunk({chunkId: 'a'}));
    const raw = fs.readFileSync(storagePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.chunks).toHaveLength(1);
  });

  it('does not crash on a missing storage file', () => {
    const store = new RagStore(path.join(tmpDir, 'absent.json'));
    expect(store.getChunk('a')).toBeUndefined();
  });

  it('survives a corrupted on-disk JSON without losing the file', () => {
    fs.writeFileSync(storagePath, 'not-json{', 'utf-8');
    const store = new RagStore(storagePath);
    expect(store.getChunk('a')).toBeUndefined();
    // Corrupted file is preserved for operator inspection.
    expect(fs.existsSync(storagePath)).toBe(true);
    // After recovery the store still accepts new writes.
    store.addChunk(makeChunk({chunkId: 'a'}));
    expect(store.getChunk('a')).toBeDefined();
  });

  it('atomic write does not leave the temp file around on success', () => {
    const store = new RagStore(storagePath);
    store.addChunk(makeChunk({chunkId: 'a'}));
    expect(fs.existsSync(`${storagePath}.tmp`)).toBe(false);
  });
});

describe('RagStore — search', () => {
  function seed(store: RagStore): void {
    store.addChunk(
      makeChunk({
        chunkId: 'b1',
        kind: 'androidperformance.com',
        title: 'Binder transactions',
        snippet: 'binder transactions reveal cross-process latency',
      }),
    );
    store.addChunk(
      makeChunk({
        chunkId: 'b2',
        kind: 'androidperformance.com',
        title: 'Frame timeline',
        snippet: 'frame timeline tells the truth about jank',
      }),
    );
    store.addChunk(
      makeChunk({
        chunkId: 'a1',
        kind: 'aosp',
        license: 'Apache-2.0',
        title: 'HwcLayer',
        snippet: 'composition fallback path lives in HwcLayer',
      }),
    );
  }

  it('returns ranked hits matching the query tokens', () => {
    const store = new RagStore(storagePath);
    seed(store);
    const result = store.search('binder transactions');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].chunkId).toBe('b1');
  });

  it('respects topK', () => {
    const store = new RagStore(storagePath);
    seed(store);
    const result = store.search(
      'binder transaction frame timeline composition',
      {topK: 1},
    );
    expect(result.results).toHaveLength(1);
  });

  it('respects the kind filter', () => {
    const store = new RagStore(storagePath);
    seed(store);
    const result = store.search('composition', {kinds: ['aosp']});
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every(r => r.chunk?.kind === 'aosp')).toBe(true);
  });

  it('skips chunks with unsupportedReason', () => {
    const store = new RagStore(storagePath);
    store.addChunk(
      makeChunk({
        chunkId: 'blocked',
        snippet: 'binder transactions',
        unsupportedReason: 'license expired',
      }),
    );
    store.addChunk(
      makeChunk({chunkId: 'visible', snippet: 'binder transactions'}),
    );
    const result = store.search('binder transactions');
    expect(result.results.find(r => r.chunkId === 'blocked')).toBeUndefined();
    expect(result.results.find(r => r.chunkId === 'visible')).toBeDefined();
  });

  it('reports retrieval-level unsupportedReason for an empty index', () => {
    const store = new RagStore(storagePath);
    const result = store.search('anything');
    expect(result.unsupportedReason).toBe('index empty');
    expect(result.results).toHaveLength(0);
  });

  it('reports retrieval-level unsupportedReason when every chunk is blocked', () => {
    const store = new RagStore(storagePath);
    store.addChunk(
      makeChunk({
        chunkId: 'blocked-1',
        snippet: 'binder transactions',
        unsupportedReason: 'license expired',
      }),
    );
    const result = store.search('binder');
    expect(result.unsupportedReason).toBe(
      'all chunks blocked by unsupportedReason',
    );
    expect(result.results).toHaveLength(0);
  });

  it('zero-match legitimate query has no unsupportedReason', () => {
    const store = new RagStore(storagePath);
    seed(store);
    const result = store.search('completely unrelated zzzqxzqq');
    expect(result.unsupportedReason).toBeUndefined();
    expect(result.results).toHaveLength(0);
  });

  it('search result carries spark provenance and the query string', () => {
    const store = new RagStore(storagePath);
    seed(store);
    const result = store.search('binder');
    expect(result.schemaVersion).toBe(1);
    expect(result.source).toBe('ragStore.search');
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.retrievedAt).toBeGreaterThan(0);
    expect(result.query).toBe('binder');
  });
});

describe('RagStore — stats', () => {
  it('tracks per-kind chunk counts and lastIndexedAt', () => {
    const store = new RagStore(storagePath);
    store.addChunk(
      makeChunk({chunkId: 'b1', kind: 'androidperformance.com', indexedAt: 100}),
    );
    store.addChunk(
      makeChunk({chunkId: 'b2', kind: 'androidperformance.com', indexedAt: 200}),
    );
    store.addChunk(
      makeChunk({
        chunkId: 'a1',
        kind: 'aosp',
        license: 'Apache-2.0',
        indexedAt: 300,
      }),
    );
    const stats = store.getStats();
    expect(stats['androidperformance.com'].chunkCount).toBe(2);
    expect(stats['androidperformance.com'].lastIndexedAt).toBe(200);
    expect(stats.aosp.chunkCount).toBe(1);
    expect(stats.aosp.lastIndexedAt).toBe(300);
    expect(stats.oem_sdk.chunkCount).toBe(0);
  });
});
