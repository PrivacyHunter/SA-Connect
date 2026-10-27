import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useIsMobile } from "@/hooks/use-mobile";

it("updates the mobile state when the viewport crosses the breakpoint", () => {
  let listener = () => {};
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    addEventListener: (_: string, callback: () => void) => { listener = callback; },
    removeEventListener: vi.fn(),
  })));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
  const hook = renderHook(() => useIsMobile());
  expect(hook.result.current).toBe(true);
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    listener();
  });
  expect(hook.result.current).toBe(false);
  hook.unmount();
  vi.unstubAllGlobals();
});