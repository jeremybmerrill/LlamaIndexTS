import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import {
  BaseEmbedding,
  batchEmbeddings,
  type BaseEmbeddingOptions,
} from "@llamaindex/core/embeddings";
import { getEnv } from "@llamaindex/env";

export enum GEMINI_EMBEDDING_MODEL {
  EMBEDDING_001 = "embedding-001",
  TEXT_EMBEDDING_004 = "text-embedding-004",
}

// 100 is max batch size, see https://github.com/run-llama/LlamaIndexTS/pull/2099
export const DEFAULT_EMBED_BATCH_SIZE = 100;

/**
 * Configuration options for GeminiEmbedding.
 */
export type GeminiEmbeddingOptions = {
  model?: GEMINI_EMBEDDING_MODEL;
  embedBatchSize?: number;
} & GoogleGenAIOptions;

/**
 * GeminiEmbedding is an alias for Gemini that implements the BaseEmbedding interface.
 */
export class GeminiEmbedding extends BaseEmbedding {
  model: GEMINI_EMBEDDING_MODEL;
  ai: GoogleGenAI;
  embedBatchSize: number = DEFAULT_EMBED_BATCH_SIZE;

  constructor(opts?: GeminiEmbeddingOptions) {
    super();

    const apiKey = opts?.apiKey ?? getEnv("GOOGLE_API_KEY");
    if (!apiKey) {
      throw new Error("Set Google API Key in GOOGLE_API_KEY env variable");
    }

    this.ai = new GoogleGenAI({ ...opts, apiKey });
    this.model = opts?.model ?? GEMINI_EMBEDDING_MODEL.EMBEDDING_001;
    this.embedBatchSize = opts?.embedBatchSize ?? DEFAULT_EMBED_BATCH_SIZE;
  }

  // Add a retry wrapper for embedContent to handle rate limits (5s wait, up to 20 tries)
  private async embedWithRetry(args: {
    model: string;
    contents: string | string[];
  }) {
    const MAX_TRIES = 20;
    const DELAY_MS = 5000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isRateLimitError = (err: any) => {
      if (!err) return false;
      return err.code === 429 || String(err.status) === "RESOURCE_EXHAUSTED";
    };

    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastErr: any = null;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        return await this.ai.models.embedContent(args);
      } catch (err) {
        lastErr = err;
        if (isRateLimitError(err) && attempt < MAX_TRIES) {
          await sleep(DELAY_MS);
          continue;
        }
        throw err;
      }
    }
    // If we exit loop unexpectedly, throw the last error.
    throw lastErr;
  }

  getTextEmbeddings = async (texts: string[]) => {
    const result = await this.embedWithRetry({
      model: this.model,
      contents: texts,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (
      result.embeddings?.map((embedding: any) => embedding.values ?? []) ?? []
    );
  };

  async getTextEmbeddingsBatch(
    texts: string[],
    options?: BaseEmbeddingOptions,
  ): Promise<Array<number[]>> {
    return await batchEmbeddings(
      texts,
      this.getTextEmbeddings.bind(this),
      this.embedBatchSize,
      options,
    );
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    const result = await this.embedWithRetry({
      model: this.model,
      contents: text,
    });

    return result.embeddings?.[0]?.values ?? [];
  }
}
