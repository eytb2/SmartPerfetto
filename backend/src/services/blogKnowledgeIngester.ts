// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * BlogKnowledgeIngester — pulls posts from androidperformance.com (or any
 * source matching the `BlogFetcher` shape), splits each post into
 * paragraph-bounded chunks, and writes them to a `RagStore` under the
 * `androidperformance.com` source kind.
 *
 * M0 scope:
 * - Pluggable fetcher so tests stay offline. Production wiring (RSS +
 *   incremental refresh + cron) lands in M2 alongside the admin route.
 * - Paragraph-based chunking up to `maxChunkChars` characters. No
 *   overlap — chunks split on hard paragraph boundaries; if context
 *   bleed becomes a problem we add overlap in M1, not before.
 * - HTML stripped via regex (script/style blocks removed first, then
 *   tags, then whitespace collapsed). Full DOM parsing is overkill for
 *   well-formed blog HTML; a swap to happy-dom stays local to this file.
 * - Stable, content-addressable chunk ids: `sha256(url + offset)` first
 *   16 hex chars. Re-ingesting the same post replaces the same chunks.
 *
 * @module blogKnowledgeIngester
 */

import {createHash} from 'crypto';

import type {RagStore} from './ragStore';
import type {RagChunk} from '../types/sparkContracts';

/** What a fetcher returns for one post. Format-agnostic — `content` may
 * be HTML or Markdown; the ingester strips HTML when needed. */
export interface BlogPostFetch {
  /** Canonical URL of the post. Drives chunkId derivation. */
  url: string;
  /** Wall-clock fetch time (epoch ms). */
  fetchedAt: number;
  /** Post body. */
  content: string;
  contentType: 'html' | 'markdown';
  title?: string;
  /** Original publication time (epoch ms), if known. */
  publishedAt?: number;
  author?: string;
}

/** Pluggable source for blog posts. Production wiring uses RSS + HTTP;
 * tests inject a stub. */
export interface BlogFetcher {
  /** Return the posts the caller should ingest. `since` lets the
   * ingester ask for posts published after a given epoch ms. */
  fetchRecent(opts?: {since?: number}): Promise<BlogPostFetch[]>;
}

export interface BlogIngestOptions {
  /** Maximum characters per chunk. Defaults to 1500. */
  maxChunkChars?: number;
  /** Only ingest posts published after this epoch ms (forwarded to fetcher). */
  since?: number;
}

export interface BlogIngestError {
  url: string;
  reason: string;
}

export interface BlogIngestResult {
  postsProcessed: number;
  chunksAdded: number;
  chunksSkipped: number;
  errors: BlogIngestError[];
}

const DEFAULT_MAX_CHUNK_CHARS = 1500;

/** Decode the small set of HTML entities we expect from blog markup.
 * Numeric entities (`&#39;`, `&#x27;`) plus the named ones below cover
 * 99% of authored content; anything richer would warrant a real DOM
 * parser, which M0 does not include. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)));
}

/** Strip HTML to plain text. Removes script/style first so their
 * contents don't leak into the snippet, then drops every remaining tag
 * and collapses whitespace. */
function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** Normalize markdown to plain text. Keeps the prose intact; removes
 * fenced code block delimiters but leaves the code so token-overlap
 * search can still find symbol names. */
function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/```[a-zA-Z0-9_+-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** Split text into paragraphs (double-newline separated). Paragraph
 * boundaries are the chunk boundary candidates. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/** Pack paragraphs into `maxChars`-bounded groups. A paragraph longer
 * than `maxChars` becomes its own oversized chunk — splitting it
 * mid-sentence would be worse than the size violation, and these tend
 * to be code blocks the search will still rank reasonably. */
interface PackedChunk {
  text: string;
  offset: number;
}

function packParagraphs(paragraphs: string[], maxChars: number): PackedChunk[] {
  const out: PackedChunk[] = [];
  let cursor = 0;
  let buf = '';
  let bufStart = 0;

  for (const p of paragraphs) {
    if (buf.length === 0) {
      buf = p;
      bufStart = cursor;
    } else if (buf.length + 2 + p.length <= maxChars) {
      buf += '\n\n' + p;
    } else {
      out.push({text: buf, offset: bufStart});
      buf = p;
      bufStart = cursor;
    }
    // Advance cursor by paragraph length + the joining "\n\n" we
    // assumed in the source. This lets the next chunk's offset point
    // at the original character index even when paragraphs are packed.
    cursor += p.length + 2;
  }

  if (buf.length > 0) {
    out.push({text: buf, offset: bufStart});
  }
  return out;
}

/** sha256(url + offset).slice(0, 16). Stable and short. */
function makeChunkId(url: string, offset: number): string {
  return createHash('sha256')
    .update(`${url}|${offset}`)
    .digest('hex')
    .slice(0, 16);
}

export class BlogKnowledgeIngester {
  constructor(
    private readonly store: RagStore,
    private readonly fetcher: BlogFetcher,
  ) {}

  async ingest(opts: BlogIngestOptions = {}): Promise<BlogIngestResult> {
    const maxChars = opts.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
    const result: BlogIngestResult = {
      postsProcessed: 0,
      chunksAdded: 0,
      chunksSkipped: 0,
      errors: [],
    };

    let posts: BlogPostFetch[];
    try {
      posts = await this.fetcher.fetchRecent({since: opts.since});
    } catch (err) {
      result.errors.push({
        url: '<fetcher>',
        reason: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    for (const post of posts) {
      result.postsProcessed++;
      try {
        const chunks = this.chunkPost(post, maxChars);
        for (const chunk of chunks) {
          this.store.addChunk(chunk);
          result.chunksAdded++;
        }
      } catch (err) {
        result.errors.push({
          url: post.url,
          reason: err instanceof Error ? err.message : String(err),
        });
        result.chunksSkipped++;
      }
    }

    return result;
  }

  /** Convert one post into chunks. Public for tests so we can poke the
   * chunking decision in isolation. */
  chunkPost(post: BlogPostFetch, maxChars: number): RagChunk[] {
    const text =
      post.contentType === 'html'
        ? stripHtml(post.content)
        : normalizeMarkdown(post.content);

    if (text.length === 0) return [];

    const paragraphs = splitParagraphs(text);
    if (paragraphs.length === 0) return [];

    const packed = packParagraphs(paragraphs, maxChars);
    const indexedAt = post.fetchedAt;

    return packed.map(p => ({
      chunkId: makeChunkId(post.url, p.offset),
      kind: 'androidperformance.com',
      uri: post.url,
      title: post.title,
      snippet: p.text,
      tokenCount: estimateTokenCount(p.text),
      indexedAt,
      author: post.author,
      verifiedAt: post.publishedAt,
    }));
  }
}

/** Rough token count: ~4 chars per token for English/Chinese mix.
 * Used only for downstream context budgeting; off by 30% is fine. */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Re-export internals for tests. Not part of the runtime API. */
export const __TEST_ONLY__ = {
  decodeHtmlEntities,
  stripHtml,
  normalizeMarkdown,
  splitParagraphs,
  packParagraphs,
  makeChunkId,
};
