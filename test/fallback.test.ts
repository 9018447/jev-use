/**
 * Cross-backend fallback: an unreachable or auth-rejected backend hands the
 * batch to the next candidate; request-caused 4xx does not; the reported
 * backend name is whoever actually answered.
 */

import { describe, expect, it } from "vitest";
import { createBackend } from "../src/backends/index.js";
import { FallbackBackend, isFallbackable } from "../src/backends/fallback.js";
import { BackendError } from "../src/backends/types.js";
import type {
  BackendRequest,
  BackendResponse,
  JevBackend,
} from "../src/backends/types.js";

const request: BackendRequest = {
  state: "s",
  questions: [{ id: "q", type: "noul", question: "?" }],
};

function fakeBackend(
  name: string,
  behavior: () => Promise<BackendResponse>,
): JevBackend {
  return { name, judge: behavior };
}

function ok(): BackendResponse {
  return {
    answers: [{ answer: 1, confidence: 0.9 }],
    model: "m",
    latencyMs: 1,
    usage: {},
  };
}

describe("FallbackBackend", () => {
  it("hands over to the next backend on a network failure and reports the responder", async () => {
    const first = fakeBackend("first", () => {
      throw new BackendError("first", "network error: ECONNREFUSED");
    });
    const second = fakeBackend("second", async () => ok());
    const fallback = new FallbackBackend([first, second]);

    const response = await fallback.judge(request);

    expect(fallback.name).toBe("second");
    expect(fallback.name).toBe("second");
  });

  it("falls through on a rejected credential (401)", async () => {
    const first = fakeBackend("first", () => {
      throw new BackendError("first", "HTTP 401: invalid key", 401);
    });
    const second = fakeBackend("second", async () => ok());
    const fallback = new FallbackBackend([first, second]);

    await fallback.judge(request);
    expect(fallback.name).toBe("second");
  });

  it("does not fall through on a request-caused 4xx", async () => {
    const first = fakeBackend("first", () => {
      throw new BackendError("first", "HTTP 400: bad request", 400);
    });
    let secondCalled = false;
    const second = fakeBackend("second", () => {
      secondCalled = true;
      return Promise.resolve(ok("second"));
    });
    const fallback = new FallbackBackend([first, second]);

    await expect(fallback.judge(request)).rejects.toThrow("HTTP 400");
    expect(secondCalled).toBe(false);
  });

  it("throws the last error when every candidate fails", async () => {
    const fail = (name: string) =>
      fakeBackend(name, () => {
        throw new BackendError(name, "network error", undefined);
      });
    const fallback = new FallbackBackend([fail("a"), fail("b")]);

    await expect(fallback.judge(request)).rejects.toThrow(BackendError);
    expect(fallback.name).toBe("b");
  });

  it("reports the first candidate's name before any call", () => {
    const fallback = new FallbackBackend([
      fakeBackend("a", async () => ok()),
      fakeBackend("b", async () => ok()),
    ]);
    expect(fallback.name).toBe("a");
  });
});

describe("isFallbackable", () => {
  it.each([
    [undefined, true], // network / timeout
    [401, true],
    [403, true],
    [408, true],
    [429, true],
    [500, true],
    [400, false],
    [404, false],
  ])("status %s → %s", (status, expected) => {
    expect(
      isFallbackable(new BackendError("x", "message", status as number | undefined)),
    ).toBe(expected);
  });
});

describe("createBackend auto-mode chain", () => {
  it("returns a FallbackBackend over all configured candidates, in priority order", () => {
    const { backend, via } = createBackend(undefined, {
      OPENROUTER_API_KEY: "or-key",
      SILICONFLOW_API_KEY: "sf-key",
    } as Record<string, string>);

    expect(backend).toBeInstanceOf(FallbackBackend);
    expect(via).toContain("openrouter → siliconflow");
    const chain = backend as FallbackBackend;
    expect(chain.name).toBe("openrouter");
  });

  it("returns the plain backend when only one credential is present", () => {
    const { backend, via } = createBackend(undefined, {
      OPENROUTER_API_KEY: "or-key",
    } as Record<string, string>);

    expect(backend).not.toBeInstanceOf(FallbackBackend);
    expect(via).toBe("auto: OPENROUTER_API_KEY found");
  });
});
