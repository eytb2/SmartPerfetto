// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {describe, it, expect, beforeEach, afterEach} from '@jest/globals';

import {RagStore} from '../ragStore';
import {
  BlogKnowledgeIngester,
  type BlogFetcher,
  type BlogPostFetch,
  __TEST_ONLY__,
} from '../blogKnowledgeIngester';

let tmpDir: string;
let storagePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-ingester-test-'));
  storagePath = path.join(tmpDir, 'rag.json');
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

class StubFetcher implements BlogFetcher {
  constructor(private posts: BlogPostFetch[] | Error) {}
  async fetchRecent(): Promise<BlogPostFetch[]> {
    if (this.posts instanceof Error) throw this.posts;
    return this.posts;
  }
}

function makePost(overrides: Partial<BlogPostFetch> = {}): BlogPostFetch {
  return {
    url: 'https://androidperformance.com/binder',
    fetchedAt: 1714600000000,
    content: 'Binder transactions reveal cross-process latency.',
    contentType: 'markdown',
    title: 'Binder transactions',
    publishedAt: 1714000000000,
    author: 'Chris',
    ...overrides,
  };
}

describe('BlogKnowledgeIngester — end-to-end ingest', () => {
  it('writes chunks to the store and reports counts', async () => {
    const store = new RagStore(storagePath);
    const fetcher = new StubFetcher([
      makePost({
        content:
          'Paragraph one explains binder.\n\nParagraph two explains scheduling.\n\nParagraph three is about thermal throttling.',
      }),
    ]);
    const ingester = new BlogKnowledgeIngester(store, fetcher);
    const result = await ingester.ingest();
    expect(result.postsProcessed).toBe(1);
    expect(result.chunksAdded).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
    expect(store.getStats()['androidperformance.com'].chunkCount).toBe(
      result.chunksAdded,
    );
  });

  it('respects maxChunkChars by emitting more chunks for the same post', async () => {
    const longContent = Array.from({length: 6}, (_, i) =>
      `Paragraph ${i} ${'lorem '.repeat(80)}`,
    ).join('\n\n');
    const store = new RagStore(storagePath);
    const fetcher = new StubFetcher([makePost({content: longContent})]);
    const ingester = new BlogKnowledgeIngester(store, fetcher);

    const big = await ingester.ingest({maxChunkChars: 5000});
    const tight = await ingester.ingest({maxChunkChars: 500});

    expect(tight.chunksAdded).toBeGreaterThan(big.chunksAdded);
  });

  it('chunkId is stable for re-ingestion of the same content', async () => {
    const store = new RagStore(storagePath);
    const post = makePost({
      content: 'Stable paragraph one.\n\nStable paragraph two.',
    });
    const ingester = new BlogKnowledgeIngester(
      store,
      new StubFetcher([post]),
    );
    await ingester.ingest();
    const idsAfterFirst = Object.keys(store.getStats()).map(() => null);
    const firstStats = store.getStats()['androidperformance.com'].chunkCount;

    // Re-ingest: same chunkIds → addChunk replaces in place.
    await ingester.ingest();
    const secondStats = store.getStats()['androidperformance.com'].chunkCount;
    expect(secondStats).toBe(firstStats);
    void idsAfterFirst;
  });

  it('strips HTML tags before chunking', async () => {
    const store = new RagStore(storagePath);
    const post = makePost({
      contentType: 'html',
      content:
        '<h1>Binder</h1><p>Cross-process <em>latency</em> matters.</p>' +
        '<script>alert(1)</script>' +
        '<p>Paragraph two.</p>',
    });
    const ingester = new BlogKnowledgeIngester(
      store,
      new StubFetcher([post]),
    );
    await ingester.ingest();
    const stats = store.getStats();
    expect(stats['androidperformance.com'].chunkCount).toBeGreaterThan(0);
    // Verify no script content leaked: search for "alert" should not hit.
    const hit = store.search('alert');
    expect(hit.results).toHaveLength(0);
  });

  it('records chunk metadata: title / author / verifiedAt / tokenCount', async () => {
    const store = new RagStore(storagePath);
    const post = makePost({
      title: 'Frame timeline',
      author: 'Chris',
      publishedAt: 1714000000000,
      content: 'Frame timeline tells the truth about jank causes.',
    });
    const ingester = new BlogKnowledgeIngester(
      store,
      new StubFetcher([post]),
    );
    await ingester.ingest();
    const search = store.search('frame timeline');
    expect(search.results.length).toBeGreaterThan(0);
    const chunk = search.results[0].chunk!;
    expect(chunk.title).toBe('Frame timeline');
    expect(chunk.author).toBe('Chris');
    expect(chunk.verifiedAt).toBe(1714000000000);
    expect(chunk.tokenCount).toBeGreaterThan(0);
  });

  it('reports a fetcher error without throwing', async () => {
    const store = new RagStore(storagePath);
    const fetcher = new StubFetcher(new Error('network down'));
    const ingester = new BlogKnowledgeIngester(store, fetcher);
    const result = await ingester.ingest();
    expect(result.postsProcessed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/network down/);
  });

  it('skips empty posts cleanly', async () => {
    const store = new RagStore(storagePath);
    const post = makePost({content: '   '});
    const ingester = new BlogKnowledgeIngester(
      store,
      new StubFetcher([post]),
    );
    const result = await ingester.ingest();
    expect(result.postsProcessed).toBe(1);
    expect(result.chunksAdded).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('forwards `since` to the fetcher', async () => {
    let receivedSince: number | undefined;
    const fetcher: BlogFetcher = {
      async fetchRecent(opts) {
        receivedSince = opts?.since;
        return [];
      },
    };
    const store = new RagStore(storagePath);
    const ingester = new BlogKnowledgeIngester(store, fetcher);
    await ingester.ingest({since: 12345});
    expect(receivedSince).toBe(12345);
  });
});

describe('BlogKnowledgeIngester — internals', () => {
  it('stripHtml removes scripts and tags but keeps prose', () => {
    const out = __TEST_ONLY__.stripHtml(
      '<p>Hello <strong>world</strong>!</p><script>x=1</script>',
    );
    expect(out).toContain('Hello');
    expect(out).toContain('world');
    expect(out).not.toContain('script');
    expect(out).not.toContain('x=1');
  });

  it('decodeHtmlEntities handles named and numeric entities', () => {
    expect(__TEST_ONLY__.decodeHtmlEntities('a &amp; b')).toBe('a & b');
    expect(__TEST_ONLY__.decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(__TEST_ONLY__.decodeHtmlEntities("it&#39;s")).toBe("it's");
  });

  it('normalizeMarkdown strips fenced code delimiters', () => {
    const md = 'Body\n```ts\nconst x = 1;\n```\nMore body';
    const out = __TEST_ONLY__.normalizeMarkdown(md);
    expect(out).toContain('const x = 1;');
    expect(out).not.toContain('```');
  });

  it('splitParagraphs splits on double newlines', () => {
    const out = __TEST_ONLY__.splitParagraphs(
      'one\n\ntwo\n\n\nthree',
    );
    expect(out).toEqual(['one', 'two', 'three']);
  });

  it('packParagraphs respects maxChars', () => {
    const paragraphs = ['aaaa', 'bbbb', 'cccc'];
    const tight = __TEST_ONLY__.packParagraphs(paragraphs, 5);
    expect(tight).toHaveLength(3);
    const loose = __TEST_ONLY__.packParagraphs(paragraphs, 100);
    expect(loose).toHaveLength(1);
  });

  it('makeChunkId is deterministic for the same url + offset', () => {
    const a = __TEST_ONLY__.makeChunkId(
      'https://androidperformance.com/binder',
      0,
    );
    const b = __TEST_ONLY__.makeChunkId(
      'https://androidperformance.com/binder',
      0,
    );
    expect(a).toBe(b);
  });

  it('makeChunkId differs for different urls', () => {
    const a = __TEST_ONLY__.makeChunkId(
      'https://androidperformance.com/binder',
      0,
    );
    const b = __TEST_ONLY__.makeChunkId(
      'https://androidperformance.com/scheduling',
      0,
    );
    expect(a).not.toBe(b);
  });
});
