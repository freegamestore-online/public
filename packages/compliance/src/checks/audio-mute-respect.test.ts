import { describe, expect, it } from 'vitest';
import { mapFileSource } from '../lib/file-source.js';
import { checkAudioMuteRespect } from './audio-mute-respect.js';

describe('checkAudioMuteRespect', () => {
  it('passes when no raw audio APIs are used', async () => {
    const files = new Map([
      ['web/src/App.tsx', 'export default function App() { return null; }'],
    ]);
    const r = await checkAudioMuteRespect(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/no raw audio/);
  });

  it('passes when raw audio is paired with useGameSounds()', async () => {
    const files = new Map([
      [
        'web/src/sfx.ts',
        'import { useGameSounds } from "@freegamestore/games";\n' +
          'const ctx = new AudioContext();',
      ],
    ]);
    const r = await checkAudioMuteRespect(mapFileSource(files));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/SDK mute hook/);
  });

  it('fails when raw audio is used without SDK mute integration', async () => {
    const files = new Map([
      ['web/src/sfx.ts', 'const click = new Audio("/click.mp3"); click.play();'],
    ]);
    const r = await checkAudioMuteRespect(mapFileSource(files));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/raw audio APIs/);
  });

  // --- comment + string stripping regression guards ---

  it('does NOT fire when `new Audio(` appears only inside a // comment', async () => {
    const files = new Map([
      [
        'web/src/lib.ts',
        '// Avoid `new Audio()` — use useGameSounds instead.\nexport {};',
      ],
    ]);
    const r = await checkAudioMuteRespect(mapFileSource(files));
    expect(r.status).toBe('pass');
  });

  it('does NOT fire when `new Audio(` is only a string-literal example', async () => {
    const files = new Map([
      ['web/src/help.ts', 'const example = "new Audio()";\nexport {};'],
    ]);
    const r = await checkAudioMuteRespect(mapFileSource(files));
    expect(r.status).toBe('pass');
  });

  it('does NOT count `useGameSounds` mentioned only in a comment as the SDK marker', async () => {
    // Earlier version: the SDK marker matched substring anywhere,
    // including inside doc comments, falsely passing files that ARE
    // using raw audio.
    const files = new Map([
      [
        'web/src/sfx.ts',
        // Real raw audio in code; SDK only mentioned in a comment.
        '// useGameSounds is recommended\nconst c = new AudioContext();',
      ],
    ]);
    const r = await checkAudioMuteRespect(mapFileSource(files));
    expect(r.status).toBe('fail');
  });
});
