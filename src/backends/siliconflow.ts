/**
 * SiliconFlow API — the domestic fallback backend.
 * POST https://api.siliconflow.cn/v1/systemone, Bearer SILICONFLOW_API_KEY.
 * Wire shape mirrors the TypeSafe native endpoint (same Kev model family as
 * jev-skill's SILICONFLOW_MODEL = "Kev-4b", 2026-10).
 */

import { parseNativeAnswers, toNativeBody } from "./native.js";
import { postJson, type HttpOptions } from "./http.js";
import type {
  BackendRequest,
  BackendResponse,
  JevBackend,
} from "./types.js";

export const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn";
export const SILICONFLOW_DEFAULT_MODEL = "Kev-4b";

/** How to reach the SiliconFlow API. */
export interface SiliconFlowOptions extends HttpOptions {
  apiKey: string;
  /** Override the API origin (self-hosted gateway, test server). */
  baseUrl?: string;
  /** Model used when a call names none. Default "Kev-4b". */
  defaultModel?: string;
}

interface NativeResponse {
  model?: string;
  answers?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class SiliconFlowBackend implements JevBackend {
  readonly name = "siliconflow";

  constructor(private readonly options: SiliconFlowOptions) {}

  async judge(request: BackendRequest): Promise<BackendResponse> {
    const model = request.model ?? this.options.defaultModel ?? SILICONFLOW_DEFAULT_MODEL;
    const body = toNativeBody(request.state, request.questions, model);
    const started = Date.now();
    const response = (await postJson(
      this.name,
      `${this.options.baseUrl ?? SILICONFLOW_BASE_URL}/v1/systemone`,
      { Authorization: `Bearer ${this.options.apiKey}` },
      body,
      this.options,
    )) as NativeResponse;
    return {
      answers: parseNativeAnswers(this.name, response.answers, request.questions),
      model: response.model ?? model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    };
  }
}
