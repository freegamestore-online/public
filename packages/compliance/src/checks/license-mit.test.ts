import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkLicenseMit } from './license-mit.js';

describe('checkLicenseMit', () => {
  it('passes when LICENSE contains MIT', async () => {
    const files = new Map([['LICENSE', 'MIT License\n\nCopyright (c) 2026 ...']]);
    const r = await checkLicenseMit(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toBe('LICENSE');
  });

  it('accepts LICENSE.md case-insensitively', async () => {
    const files = new Map([['license.md', '# mit license\n']]);
    const r = await checkLicenseMit(mapFileSource(files));
    expect(r.status).toBe('pass');
  });

  it('fails when LICENSE exists but is not MIT', async () => {
    const files = new Map([['LICENSE', 'Apache License 2.0\n']]);
    const r = await checkLicenseMit(mapFileSource(files));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/does not mention MIT/);
  });

  it('passes when a non-MIT LICENSE coexists with an MIT LICENSE.md', async () => {
    // Regression: the first non-MIT candidate must not short-circuit the scan.
    const files = new Map([
      ['LICENSE', 'Apache License 2.0\n'],
      ['LICENSE.md', 'MIT License\n\nCopyright (c) 2026 ...'],
    ]);
    const r = await checkLicenseMit(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toBe('LICENSE.md');
  });

  it('fails when no LICENSE file exists', async () => {
    const files = new Map([['README.md', '# x']]);
    const r = await checkLicenseMit(mapFileSource(files));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/no LICENSE/);
  });
});
