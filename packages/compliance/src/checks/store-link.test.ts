import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkStoreLink } from './store-link.js';

describe('checkStoreLink', () => {
  it('passes for an app referencing freegamestore.online in src', async () => {
    const files = new Map([
      [
        'web/src/Footer.tsx',
        'export default () => <a href="https://freegamestore.online">Catalog</a>;',
      ],
    ]);
    const r = await checkStoreLink(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/freegamestore\.online/);
  });

  it('passes for a game referencing freegamestore.online when @freegamestore/games is present', async () => {
    const files = new Map([
      ['package.json', '{"dependencies":{"@freegamestore/games":"^0.1"}}'],
      ['web/src/Footer.tsx', 'const url = "https://freegamestore.online";'],
    ]);
    const r = await checkStoreLink(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/freegamestore\.online/);
  });

  it('warns when web/src/ has no freegamestore.online link anywhere', async () => {
    // Files reference an unrelated URL — the storefront link is required
    // so visitors can discover the rest of the catalog.
    const files = new Map([['web/src/About.tsx', 'const x = "https://example.com";']]);
    const r = await checkStoreLink(mapFileSource(files));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/freegamestore\.online/);
  });

  it('warns when no store link anywhere in web/src/', async () => {
    const files = new Map([['web/src/App.tsx', 'export default () => <div>hi</div>;']]);
    const r = await checkStoreLink(mapFileSource(files));
    expect(r.status).toBe('warn');
  });
});
