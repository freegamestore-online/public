import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Checks that .gitignore includes essential patterns for a game repo:
 *   - node_modules (or node_modules/)
 *   - dist (or dist/ or web/dist)
 *   - .env (any .env pattern — .env, .env.*, .env.local, etc.)
 *
 * Missing patterns mean build artefacts, dependencies, or secrets
 * could end up committed — bloating the repo and leaking credentials.
 *
 * WARN level — a missing pattern is a hygiene issue, not a hard gate.
 */

interface RequiredPattern {
  name: string;
  /** Return true if the gitignore line covers this pattern. */
  test: (line: string) => boolean;
}

const REQUIRED: RequiredPattern[] = [
  {
    name: 'node_modules',
    test: (line) => /^node_modules\/?$/.test(line) || line === '**/node_modules',
  },
  {
    name: 'dist',
    test: (line) =>
      /^dist\/?$/.test(line) || /^web\/dist\/?$/.test(line) || line === '**/dist',
  },
  {
    name: '.env',
    test: (line) => /^\.env/.test(line),
  },
];

export async function checkGitignoreComplete(source: FileSource): Promise<CheckResult> {
  const raw = await source.read('.gitignore');

  if (raw === null) {
    return {
      name: 'Gitignore complete',
      status: 'warn',
      detail: 'no .gitignore file at repo root',
      suggestions: [
        'Add a .gitignore that covers at least: node_modules, dist, .env.',
        'Run `fgs create` to scaffold a game with a standard .gitignore.',
      ],
    };
  }

  // Parse non-empty, non-comment lines.
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const missing = REQUIRED.filter((req) => !lines.some((line) => req.test(line)));

  if (missing.length === 0) {
    return {
      name: 'Gitignore complete',
      status: 'pass',
      detail: '.gitignore covers node_modules, dist, and .env',
    };
  }

  return {
    name: 'Gitignore complete',
    status: 'warn',
    detail: `.gitignore is missing patterns for: ${missing.map((m) => m.name).join(', ')}`,
    suggestions: [
      `Add the missing patterns to .gitignore: ${missing.map((m) => m.name).join(', ')}.`,
      'These prevent build artefacts, dependencies, or secrets from being committed.',
    ],
  };
}
