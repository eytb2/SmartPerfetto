import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

type LegacyEndpoint = '/api/ai' | '/api/auto-analysis' | '/chat';

interface EndpointPattern {
  endpoint: LegacyEndpoint;
  regex: RegExp;
}

interface Violation {
  endpoint: LegacyEndpoint;
  file: string;
  lineNumber: number;
  lineText: string;
}

const repoRoot = path.resolve(__dirname, '../..');

const endpointPatterns: EndpointPattern[] = [
  { endpoint: '/api/ai', regex: /\/api\/ai(?:\/|\b)/ },
  { endpoint: '/api/auto-analysis', regex: /\/api\/auto-analysis(?:\/|\b)/ },
  { endpoint: '/chat', regex: /['"`]\/chat(?:\/|\b)/ },
];

const allowlist: Record<LegacyEndpoint, Set<string>> = {
  '/api/ai': new Set([
    'README.md',
    'backend/scripts/check-legacy-route-usage.ts',
    'backend/src/config/index.ts',
    'backend/src/index.ts',
    'backend/src/routes/__tests__/legacyRouteDeprecation.test.ts',
    'backend/src/routes/advancedAIRoutes.ts',
  ]),
  '/api/auto-analysis': new Set([
    'README.md',
    'backend/scripts/check-legacy-route-usage.ts',
    'backend/src/config/index.ts',
    'backend/src/index.ts',
    'backend/src/routes/autoAnalysis.ts',
  ]),
  '/chat': new Set([
    'README.md',
    'backend/scripts/check-legacy-route-usage.ts',
    'backend/src/config/index.ts',
    'backend/src/index.ts',
    'backend/src/routes/aiChatRoutes.ts',
  ]),
};

function toRepoRelativePath(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function shouldScanPath(relativePath: string): boolean {
  if (relativePath.startsWith('backend/src/')) {
    return /\.(ts|tsx|js|jsx)$/.test(relativePath);
  }

  if (relativePath.startsWith('backend/scripts/')) {
    return /\.(ts|tsx|js)$/.test(relativePath);
  }

  if (relativePath === 'README.md') {
    return true;
  }

  return false;
}

function collectCandidateFiles(): string[] {
  try {
    const trackedAndUntracked = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    return trackedAndUntracked
      .split('\0')
      .filter(Boolean)
      .map(relativePath => path.join(repoRoot, relativePath));
  } catch {
    const fallback: string[] = [];
    const walk = (directory: string): void => {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(absolutePath);
        } else if (entry.isFile()) {
          fallback.push(absolutePath);
        }
      }
    };
    walk(repoRoot);
    return fallback;
  }
}

function scanFile(absolutePath: string): Violation[] {
  const relativePath = toRepoRelativePath(absolutePath);
  if (!shouldScanPath(relativePath)) {
    return [];
  }

  let content: string;
  try {
    content = fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return [];
  }

  if (!content.includes('/api/')) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const violations: Violation[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { endpoint, regex } of endpointPatterns) {
      if (!regex.test(line)) {
        continue;
      }

      if (!allowlist[endpoint].has(relativePath)) {
        violations.push({
          endpoint,
          file: relativePath,
          lineNumber: index + 1,
          lineText: line.trim(),
        });
      }
    }
  }

  return violations;
}

function main(): void {
  const files = collectCandidateFiles();

  const violations: Violation[] = [];
  for (const file of files) {
    violations.push(...scanFile(file));
  }

  if (violations.length === 0) {
    console.log('Legacy route usage guard passed.');
    return;
  }

  console.error('Disallowed legacy route references found. Keep legacy endpoints isolated.');
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.lineNumber} references ${violation.endpoint}: ${violation.lineText}`
    );
  }
  console.error(
    'If this reference is intentional, update backend/scripts/check-legacy-route-usage.ts allowlist.'
  );
  process.exit(1);
}

main();
