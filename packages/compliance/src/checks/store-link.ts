import type { FileSource } from '../lib/file-source.js';
import type { CheckResult } from '../types.js';

/**
 * Games should link back to freegamestore.online — it's how visitors
 * discover the rest of the catalog from inside any single game.
 */
export async function checkStoreLink(source: FileSource): Promise<CheckResult> {
  const domain = 'freegamestore.online';

  for await (const path of source.list()) {
    if (!path.startsWith('web/src/')) continue;
    const content = await source.read(path);
    if (content?.includes(domain)) {
      return { name: 'Store link', status: 'pass', detail: `${domain} referenced in ${path}` };
    }
  }
  return {
    name: 'Store link',
    status: 'warn',
    detail: `no link to ${domain} found in web/src/`,
    suggestions: [
      `Add a small "Built for ${domain}" link in the footer or about screen.`,
      'It helps visitors find the rest of the catalog — and it counts for storefront ranking.',
    ],
  };
}
