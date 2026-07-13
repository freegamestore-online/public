import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SoundProvider, useSound } from './SoundContext.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SoundProvider>{children}</SoundProvider>
);

describe('SoundContext', () => {
  it('defaults to MUTED (compliance: no audio until the user opts in)', () => {
    const { result } = renderHook(() => useSound(), { wrapper });
    expect(result.current.muted).toBe(true);
  });

  it('toggle flips mute state', () => {
    const { result } = renderHook(() => useSound(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.muted).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.muted).toBe(true);
  });

  it('useSound outside a provider is muted by default (safe fallback)', () => {
    const { result } = renderHook(() => useSound());
    expect(result.current.muted).toBe(true);
    expect(typeof result.current.toggle).toBe('function');
  });
});
