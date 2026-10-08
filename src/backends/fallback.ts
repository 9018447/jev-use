/**
 * Cross-backend fallback: try candidates in order, move to the next only for
 * failures worth switching networks for (unreachable, rejected auth, server
 * errors). A 4xx the request itself caused would repeat on every backend, so
 * it rethrows. `name` reports whoever actually answered (or died last), so
 * JudgeResult.backend stays honest.
 */

import {
  BackendError,
  type BackendRequest,
  type BackendResponse,
  type JevBackend,
} from "./types.js";

/** True for failures worth trying another backend for. */
export function isFallbackable(error: BackendError): boolean {
  if (error.status === undefined) return true; // network / timeout
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export class FallbackBackend implements JevBackend {
  name: string;

  constructor(private readonly candidates: JevBackend[]) {
    this.name = candidates[0]?.name ?? "none";
  }

  async judge(request: BackendRequest): Promise<BackendResponse> {
    let lastError: BackendError | undefined;
    for (const candidate of this.candidates) {
      try {
        const response = await candidate.judge(request);
        this.name = candidate.name;
        return response;
      } catch (error) {
        if (!(error instanceof BackendError)) throw error;
        lastError = error;
        this.name = candidate.name;
        const isLast = candidate === this.candidates[this.candidates.length - 1];
        if (!isFallbackable(error) || isLast) throw error;
      }
    }
    /* istanbul ignore next -- loop always returns or throws */
    throw lastError ?? new Error("no fallback candidates configured");
  }
}
