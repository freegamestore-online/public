import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertFreeGameStoreProject } from './publish.js';

describe('assertFreeGameStoreProject — cross-store guard', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'store-guard-'));
    mkdirSync(join(dir, 'web'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('allows a real FreeGameStore game (uses @freegamestore/games)', async () => {
    writeFileSync(
      join(dir, 'web', 'package.json'),
      JSON.stringify({ dependencies: { '@freegamestore/games': '^0.16.0' } }),
    );
    expect(await assertFreeGameStoreProject(dir)).toBeNull();
  });

  it('rejects a FreeAppStore app by its SDK dependency', async () => {
    writeFileSync(
      join(dir, 'web', 'package.json'),
      JSON.stringify({ dependencies: { '@freeappstore/sdk': '^0.14.0' } }),
    );
    const err = await assertFreeGameStoreProject(dir);
    expect(err).toContain('fas publish');
  });

  it('rejects a project whose deploy.yml targets the fas-apps bucket', async () => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'deploy.yml'),
      'aws s3 sync ./web/dist "s3://fas-apps/apps/foo/"',
    );
    const err = await assertFreeGameStoreProject(dir);
    expect(err).toContain('fas publish');
  });

  it('is silent (null) when there is no project at all', async () => {
    expect(await assertFreeGameStoreProject(dir)).toBeNull();
  });
});
