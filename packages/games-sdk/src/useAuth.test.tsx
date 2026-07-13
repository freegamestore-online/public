import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAuth } from "./useAuth.js";

describe("useAuth", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sets the user when /me returns one", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: "github:1", name: "Ada", avatar: "a.png" }) } as Response)) as unknown as typeof fetch;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.name).toBe("Ada");
  });

  it("leaves user null on a 401 (signed out)", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => null } as Response)) as unknown as typeof fetch;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it("leaves user null on a network error (no throw)", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it("signIn navigates to the auth login URL with a redirect back", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => null } as Response)) as unknown as typeof fetch;
    const nav = { href: "https://snake.freegamestore.online/" };
    Object.defineProperty(window, "location", { value: nav, writable: true, configurable: true });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.signIn());
    expect(nav.href).toContain("auth.freegamestore.online/login?redirect=");
  });
});
