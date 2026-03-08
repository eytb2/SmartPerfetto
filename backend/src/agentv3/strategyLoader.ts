/**
 * Loads scene analysis strategies from external Markdown files with YAML frontmatter.
 *
 * Strategy files live in `backend/strategies/*.strategy.md` and contain:
 * - YAML frontmatter: scene name, priority, effort, keywords, compound_patterns
 * - Markdown body: analysis methodology text injected into the system prompt
 *
 * This decouples strategy content from TypeScript code — adding a new scene
 * requires only a new `.strategy.md` file, no code changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface StrategyDefinition {
  scene: string;
  priority: number;
  effort: string;
  keywords: string[];
  compoundPatterns: RegExp[];
  content: string;
}

const STRATEGIES_DIR = path.resolve(__dirname, '../../strategies');
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

let cache: Map<string, StrategyDefinition> | null = null;

function parseStrategyFile(filePath: string): StrategyDefinition | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;

  const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
  const content = match[2].trim();

  const compoundPatternStrings = (frontmatter.compound_patterns as string[] | undefined) || [];
  const compoundPatterns = compoundPatternStrings.map(p => new RegExp(p, 'i'));

  return {
    scene: frontmatter.scene as string,
    priority: (frontmatter.priority as number) ?? 99,
    effort: (frontmatter.effort as string) ?? 'high',
    keywords: (frontmatter.keywords as string[]) || [],
    compoundPatterns,
    content,
  };
}

export function loadStrategies(): Map<string, StrategyDefinition> {
  if (cache) return cache;

  cache = new Map();
  const files = fs.readdirSync(STRATEGIES_DIR)
    .filter(f => f.endsWith('.strategy.md'));

  for (const file of files) {
    const def = parseStrategyFile(path.join(STRATEGIES_DIR, file));
    if (def) {
      cache.set(def.scene, def);
    }
  }

  return cache;
}

export function getStrategyContent(scene: string): string | undefined {
  return loadStrategies().get(scene)?.content;
}

export function getRegisteredScenes(): StrategyDefinition[] {
  return Array.from(loadStrategies().values());
}

/** Clear cached strategies — useful for dev/test reloads. */
export function invalidateStrategyCache(): void {
  cache = null;
}
