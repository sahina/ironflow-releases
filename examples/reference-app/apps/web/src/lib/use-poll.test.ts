import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { POLL_MS, usePoll } from "@/lib/use-poll";

afterEach(() => vi.useRealTimers());

describe("the shared poll", () => {
  test("shows the fallback until the first answer arrives", async () => {
    const { result } = renderHook(() => usePoll(async () => "answered", "unknown"));

    expect(result.current).toBe("unknown");
    await waitFor(() => expect(result.current).toBe("answered"));
  });

  test("keeps asking", async () => {
    vi.useFakeTimers();
    let answers = 0;
    const look = vi.fn(async () => (answers += 1));

    renderHook(() => usePoll(look, 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2 + 1);
    });

    // Once on mount, then once per interval.
    expect(look).toHaveBeenCalledTimes(3);
  });

  test("falls back rather than freezing on the last good answer", async () => {
    // "Not known" is the honest reading of an engine that stopped answering.
    // Holding the previous value would report a dead worker as running.
    //
    // Fake timers from the start: the interval is created by the mount effect,
    // so installing them afterwards leaves the real one running and this test
    // asserting nothing.
    vi.useFakeTimers();
    let fail = false;
    const { result } = renderHook(() =>
      usePoll(async () => {
        if (fail) throw new Error("unreachable");
        return "answered";
      }, "unknown"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current).toBe("answered");

    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS + 1);
    });

    expect(result.current).toBe("unknown");
  });

  test("stops when the caller unmounts", async () => {
    vi.useFakeTimers();
    const look = vi.fn(async () => 1);
    const { unmount } = renderHook(() => usePoll(look, 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });

    expect(look).toHaveBeenCalledTimes(1);
  });
});
