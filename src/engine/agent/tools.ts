import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { CONFIG } from "../config";
import type { RepoProfile } from "../types";
import type { MetricsCollector } from "../metrics/metrics";
import { resolveWithin, PathTraversalError } from "./safePath";

export interface ToolContext {
  repoDir: string;
  profile: RepoProfile;
  metrics: MetricsCollector;
}

export const AGENT_TOOLS: Tool[] = [
  {
    name: "read_file",
    description:
      "Read a repo-relative text file to confirm or refute a finding. Returns line-numbered content. Call this when you need to see the actual code around a flagged line. Prefer get_file_context when you only need the lines around a specific finding.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path" },
        startLine: { type: "integer", description: "1-based start line (optional)" },
        endLine: { type: "integer", description: "1-based end line (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "get_file_context",
    description:
      "Read the lines surrounding a specific finding location. Returns line-numbered content centered on `line`. Use this to verify a finding cheaply without reading the whole file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path" },
        line: { type: "integer", description: "1-based line to center on" },
        contextLines: {
          type: "integer",
          description: "Lines of context on each side (default 10)",
        },
      },
      required: ["path", "line"],
    },
  },
  {
    name: "search_codebase",
    description:
      "Search the repository for a fixed (literal) string. Use this to check whether a flagged value (e.g. a secret) appears elsewhere, or to find related usages. Returns matching file:line results.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Literal string to search for" },
        maxResults: { type: "integer", description: "Max results (default 50)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_files",
    description:
      "List files and subdirectories one level under a repo-relative directory (default: repo root). Use this to orient yourself before reading.",
    input_schema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Repo-relative directory (optional)" },
      },
    },
  },
];

const readFileSchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
const getContextSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  contextLines: z.number().int().positive().max(100).optional(),
});
const searchSchema = z.object({
  pattern: z.string().min(1),
  maxResults: z.number().int().positive().max(200).optional(),
});
const listSchema = z.object({ dir: z.string().optional() });

function truncate(text: string): string {
  if (text.length <= CONFIG.maxToolResultChars) return text;
  return text.slice(0, CONFIG.maxToolResultChars) + "\n… [truncated]";
}

function numberLines(content: string, startLine: number): string {
  return content
    .split("\n")
    .map((l, i) => `${startLine + i}\t${l}`)
    .join("\n");
}

function wrapFile(filePath: string, body: string): string {
  // Sentinels + explicit reminder: everything inside is untrusted repo data.
  return `<file_content path="${filePath}">\n${body}\n</file_content>`;
}

async function readFileTool(ctx: ToolContext, input: z.infer<typeof readFileSchema>): Promise<string> {
  const abs = resolveWithin(ctx.repoDir, input.path);
  const raw = await fsp.readFile(abs, "utf8");
  const lines = raw.split("\n");
  const start = input.startLine ?? 1;
  const end = Math.min(input.endLine ?? start + CONFIG.maxFileReadLines - 1, lines.length);
  const clampedEnd = Math.min(end, start + CONFIG.maxFileReadLines - 1);
  const slice = lines.slice(start - 1, clampedEnd).join("\n");
  return wrapFile(input.path, numberLines(slice, start));
}

async function getContextTool(ctx: ToolContext, input: z.infer<typeof getContextSchema>): Promise<string> {
  const abs = resolveWithin(ctx.repoDir, input.path);
  const raw = await fsp.readFile(abs, "utf8");
  const lines = raw.split("\n");
  const ctxLines = input.contextLines ?? 10;
  const start = Math.max(1, input.line - ctxLines);
  const end = Math.min(lines.length, input.line + ctxLines);
  const slice = lines.slice(start - 1, end).join("\n");
  return wrapFile(input.path, numberLines(slice, start));
}

const SEARCH_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "out", "coverage"]);

/**
 * Literal search implemented in JS rather than by shelling out to rg/grep.
 * Serverless has neither binary, and this is the agent's most-used tool after
 * reading files, so it cannot depend on the environment having one.
 */
async function searchTool(ctx: ToolContext, input: z.infer<typeof searchSchema>): Promise<string> {
  const max = input.maxResults ?? 50;
  const needle = input.pattern;
  const hits: string[] = [];

  async function visit(dir: string): Promise<void> {
    if (hits.length >= max) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (hits.length >= max) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SEARCH_SKIP_DIRS.has(entry.name)) await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fsp.stat(full);
      if (stat.size > CONFIG.largeFileBytes) continue;

      let content: string;
      try {
        content = await fsp.readFile(full, "utf8");
      } catch {
        continue;
      }
      if (!content.includes(needle)) continue;

      const rel = path.relative(ctx.repoDir, full).split(path.sep).join("/");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        if (lines[i].includes(needle)) {
          hits.push(`${rel}:${i + 1}:${lines[i].slice(0, 300).trim()}`);
        }
      }
    }
  }

  await visit(ctx.repoDir);
  if (hits.length === 0) return `No matches for ${JSON.stringify(needle)}.`;
  return truncate(hits.join("\n"));
}

async function listTool(ctx: ToolContext, input: z.infer<typeof listSchema>): Promise<string> {
  const rel = input.dir ?? ".";
  const abs = resolveWithin(ctx.repoDir, rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const lines: string[] = [];
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    if (e.isDirectory()) {
      lines.push(`${e.name}/`);
    } else {
      const stat = await fsp.stat(path.join(abs, e.name));
      lines.push(`${e.name}\t${stat.size}B`);
    }
  }
  return truncate(lines.sort().join("\n") || "(empty)");
}

export interface ToolExecResult {
  content: string;
  isError: boolean;
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<ToolExecResult> {
  ctx.metrics.recordToolCall(name);
  try {
    switch (name) {
      case "read_file":
        return { content: await readFileTool(ctx, readFileSchema.parse(input)), isError: false };
      case "get_file_context":
        return { content: await getContextTool(ctx, getContextSchema.parse(input)), isError: false };
      case "search_codebase":
        return { content: await searchTool(ctx, searchSchema.parse(input)), isError: false };
      case "list_files":
        return { content: await listTool(ctx, listSchema.parse(input)), isError: false };
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return { content: `Path rejected: ${err.message}`, isError: true };
    }
    if (err instanceof z.ZodError) {
      return { content: `Invalid tool input: ${err.message}`, isError: true };
    }
    const e = err as { code?: string; message?: string };
    if (e.code === "ENOENT") {
      return { content: "File or directory not found.", isError: true };
    }
    return { content: `Tool error: ${e.message ?? String(err)}`, isError: true };
  }
}
