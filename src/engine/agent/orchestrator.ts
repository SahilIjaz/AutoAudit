import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { CONFIG } from "../config";
import type { Finding } from "../types";
import { AGENT_TOOLS, executeTool, type ToolContext } from "./tools";
import { buildSystemPrompt, buildFindingsMessage } from "./prompts";

export interface AgentRunResult {
  transcript: MessageParam[];
  stopReason: "completed" | "max_iterations";
}

/**
 * Runs the Anthropic tool-use loop: hand the agent the findings, let it call
 * read-only tools to investigate, and stop when it stops requesting tools or
 * hits the iteration cap. Returns the full transcript for the reporting step.
 */
export async function runAgentLoop(
  client: Anthropic,
  findings: Finding[],
  ctx: ToolContext
): Promise<AgentRunResult> {
  const system = buildSystemPrompt(ctx.profile);
  const messages: MessageParam[] = [
    { role: "user", content: buildFindingsMessage(findings) },
  ];

  for (let i = 0; i < CONFIG.maxAgentIterations; i++) {
    const res = await client.messages.create({
      model: CONFIG.model,
      max_tokens: 8192,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: AGENT_TOOLS,
      messages,
    });
    ctx.metrics.recordUsage(res.usage);
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      return { transcript: messages, stopReason: "completed" };
    }

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const { content, isError } = await executeTool(tu.name, tu.input, ctx);
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content,
          ...(isError ? { is_error: true } : {}),
        };
      })
    );
    messages.push({ role: "user", content: results });
  }

  return { transcript: messages, stopReason: "max_iterations" };
}
