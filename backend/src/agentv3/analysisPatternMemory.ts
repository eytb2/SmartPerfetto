/**
 * Analysis Pattern Memory — cross-session long-term memory for analysis insights.
 *
 * After each successful analysis, extracts trace feature fingerprints and key insights,
 * then persists them to disk. On new analyses, matches similar patterns and injects
 * relevant insights into the system prompt.
 *
 * Storage: backend/logs/analysis_patterns.json (200 entry max, 60-day TTL)
 * Matching: Jaccard similarity on trace features (architecture, scene, findings)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Finding } from '../agent/types';
import type { AnalysisPatternEntry } from './types';

const PATTERNS_FILE = path.resolve(__dirname, '../../logs/analysis_patterns.json');
const MAX_PATTERNS = 200;
const PATTERN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const MIN_MATCH_SCORE = 0.25; // Minimum Jaccard similarity to consider a match
const MAX_MATCHED_PATTERNS = 3; // Max patterns to inject into prompt

/** Load patterns from disk. */
function loadPatterns(): AnalysisPatternEntry[] {
  try {
    if (!fs.existsSync(PATTERNS_FILE)) return [];
    const data = fs.readFileSync(PATTERNS_FILE, 'utf-8');
    return JSON.parse(data) as AnalysisPatternEntry[];
  } catch {
    return [];
  }
}

/** Save patterns to disk (atomic write). */
async function savePatterns(patterns: AnalysisPatternEntry[]): Promise<void> {
  try {
    const dir = path.dirname(PATTERNS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpFile = PATTERNS_FILE + '.tmp';
    await fs.promises.writeFile(tmpFile, JSON.stringify(patterns, null, 2));
    await fs.promises.rename(tmpFile, PATTERNS_FILE);
  } catch (err) {
    console.warn('[PatternMemory] Failed to save patterns:', (err as Error).message);
  }
}

/** Jaccard similarity between two string sets. */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a.map(s => s.toLowerCase()));
  const setB = new Set(b.map(s => s.toLowerCase()));
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Extract trace feature fingerprint from analysis context.
 * Used for similarity matching across sessions.
 */
export function extractTraceFeatures(context: {
  architectureType?: string;
  sceneType?: string;
  packageName?: string;
  findingTitles?: string[];
  findingCategories?: string[];
}): string[] {
  const features: string[] = [];

  if (context.architectureType) features.push(`arch:${context.architectureType}`);
  if (context.sceneType) features.push(`scene:${context.sceneType}`);
  if (context.packageName) {
    // Extract app domain from package name (e.g. "com.tencent.mm" → "tencent")
    const parts = context.packageName.split('.');
    if (parts.length >= 2) features.push(`domain:${parts[1]}`);
  }

  // Add finding categories and key titles as features
  if (context.findingCategories) {
    for (const cat of new Set(context.findingCategories)) {
      features.push(`cat:${cat}`);
    }
  }
  if (context.findingTitles) {
    for (const title of context.findingTitles.slice(0, 5)) {
      // Normalize: take first significant words
      const normalized = title.replace(/[^\w\u4e00-\u9fff]/g, ' ').trim().substring(0, 30);
      if (normalized) features.push(`finding:${normalized}`);
    }
  }

  return features;
}

/**
 * Extract key insights from analysis findings and conclusion.
 * These are the patterns worth remembering across sessions.
 */
export function extractKeyInsights(
  findings: Finding[],
  conclusion: string,
): string[] {
  const insights: string[] = [];

  // Extract CRITICAL/HIGH findings with root cause as insights
  const important = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  for (const f of important.slice(0, 5)) {
    const insight = `${f.title}: ${f.description?.substring(0, 150) || ''}`;
    insights.push(insight);
  }

  // Extract key patterns from conclusion (look for root cause statements)
  const rootCauseMatch = conclusion.match(/根因[：:]\s*([^\n]{10,150})/);
  if (rootCauseMatch) {
    insights.push(`根因: ${rootCauseMatch[1]}`);
  }

  return insights;
}

/**
 * Save an analysis pattern to persistent storage.
 * Call after a successful analysis to build long-term memory.
 */
export async function saveAnalysisPattern(
  features: string[],
  insights: string[],
  sceneType: string,
  architectureType?: string,
  confidence?: number,
): Promise<void> {
  if (features.length === 0 || insights.length === 0) return;

  const patterns = loadPatterns();

  // Deduplicate: check if a very similar pattern already exists (>70% similarity)
  const existingIdx = patterns.findIndex(p => jaccardSimilarity(p.traceFeatures, features) > 0.7);

  if (existingIdx >= 0) {
    // Update existing pattern: merge insights, bump match count
    const existing = patterns[existingIdx];
    const uniqueInsights = new Set([...existing.keyInsights, ...insights]);
    existing.keyInsights = Array.from(uniqueInsights).slice(0, 10);
    existing.matchCount++;
    existing.createdAt = Date.now(); // Refresh timestamp
    if (confidence !== undefined) existing.confidence = confidence;
  } else {
    // Create new pattern
    const id = `pat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    patterns.push({
      id,
      traceFeatures: features,
      sceneType,
      keyInsights: insights.slice(0, 10),
      architectureType,
      confidence: confidence ?? 0.5,
      createdAt: Date.now(),
      matchCount: 0,
    });
  }

  // Prune expired + enforce max size
  const cutoff = Date.now() - PATTERN_TTL_MS;
  const active = patterns
    .filter(p => p.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PATTERNS);

  await savePatterns(active);
}

/**
 * Find patterns similar to the current trace features.
 * Returns matched patterns sorted by similarity score.
 */
export function matchPatterns(features: string[]): Array<AnalysisPatternEntry & { score: number }> {
  if (features.length === 0) return [];

  const patterns = loadPatterns();
  const cutoff = Date.now() - PATTERN_TTL_MS;

  return patterns
    .filter(p => p.createdAt >= cutoff)
    .map(p => ({
      ...p,
      score: jaccardSimilarity(p.traceFeatures, features),
    }))
    .filter(p => p.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHED_PATTERNS);
}

/**
 * Build a system prompt section from matched patterns.
 * Provides cross-session context to Claude.
 */
export function buildPatternContextSection(features: string[]): string | undefined {
  const matches = matchPatterns(features);
  if (matches.length === 0) return undefined;

  const lines = matches.map((m, i) => {
    const insightText = m.keyInsights.slice(0, 3).map(ins => `  - ${ins}`).join('\n');
    return `${i + 1}. **${m.sceneType}${m.architectureType ? ` (${m.architectureType})` : ''}** (相似度 ${(m.score * 100).toFixed(0)}%, 匹配 ${m.matchCount + 1} 次)\n${insightText}`;
  });

  return `## 历史分析经验（跨会话记忆）

以下是过往类似 trace 的分析经验，供参考（不一定适用于当前 trace）：

${lines.join('\n\n')}

> 这些经验来自之前的分析会话。如果当前 trace 的数据与历史经验矛盾，以当前数据为准。`;
}
