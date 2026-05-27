import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Checks that the React app renders inside `<React.StrictMode>` or
 * `<StrictMode>`. StrictMode catches common bugs: double renders in
 * development, deprecated API usage, and side effects in the render
 * phase.
 *
 * Reads `web/src/main.tsx` (or `web/src/main.ts`). If neither exists,
 * the project is not a React app — pass silently.
 *
 * WARN level — StrictMode is a best practice, not a hard requirement.
 */

const MAIN_PATHS = ['web/src/main.tsx', 'web/src/main.ts'];

const STRICT_MODE_RE = /<(?:React\.)?StrictMode\s*>/;

export async function checkReactStrictMode(source: FileSource): Promise<CheckResult> {
  for (const path of MAIN_PATHS) {
    const content = await source.read(path);
    if (content === null) continue;

    if (STRICT_MODE_RE.test(content)) {
      return {
        name: 'React StrictMode',
        status: 'pass',
        detail: `${path} wraps the app in <StrictMode>`,
      };
    }

    return {
      name: 'React StrictMode',
      status: 'warn',
      detail: `${path} does not use <React.StrictMode> or <StrictMode>`,
      suggestions: [
        'Wrap the root component in <React.StrictMode> to catch common React bugs during development.',
        'Example: createRoot(el).render(<React.StrictMode><App /></React.StrictMode>)',
      ],
    };
  }

  // Neither main.tsx nor main.ts exists — not a React project.
  return {
    name: 'React StrictMode',
    status: 'pass',
    detail: 'no web/src/main.tsx found (not a React project)',
  };
}
