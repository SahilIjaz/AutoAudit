import { CONFIG } from "../config";
import type { AnalysisMetrics } from "../types";

/** Minimal shape of the Anthropic usage object we consume. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export class MetricsCollector {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private apiCalls = 0;
  private toolCalls: Record<string, number> = {};
  private wallTimeMs: Record<string, number> = {};

  recordUsage(usage: Usage): void {
    this.inputTokens += usage.input_tokens ?? 0;
    this.outputTokens += usage.output_tokens ?? 0;
    this.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    this.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    this.apiCalls += 1;
  }

  recordToolCall(name: string): void {
    this.toolCalls[name] = (this.toolCalls[name] ?? 0) + 1;
  }

  async time<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.wallTimeMs[phase] = (this.wallTimeMs[phase] ?? 0) + (Date.now() - start);
    }
  }

  private estimatedCostUsd(): number {
    const p = CONFIG.pricingPerMTok;
    return (
      (this.inputTokens * p.input +
        this.outputTokens * p.output +
        this.cacheReadTokens * p.cacheRead +
        this.cacheWriteTokens * p.cacheWrite) /
      1_000_000
    );
  }

  snapshot(): AnalysisMetrics {
    return {
      model: CONFIG.model,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      estimatedCostUsd: Number(this.estimatedCostUsd().toFixed(6)),
      apiCalls: this.apiCalls,
      toolCalls: { ...this.toolCalls },
      wallTimeMs: { ...this.wallTimeMs },
    };
  }
}
