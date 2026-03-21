#!/usr/bin/env node
// Thinking mode classifier: determines the thinking approach from the user prompt
// via ONNX semantic search against thinking mode description artifacts.
// Fallback: asks the LLM to self-classify as step 1.
//
// Used by UserPromptSubmit hook. Reads hook input from stdin.
// Outputs JSON with systemMessage containing:
//   1. Mode template (if ONNX matched a thinking-mode-* artifact) OR fallback self-classification prompt
//   2. Concise context line (project name + dogfood status + plugin hint)

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "node:child_process";
import { logTelemetry } from "./telemetry.mjs";

// ---------------------------------------------------------------------------
// Agent detection
// ---------------------------------------------------------------------------

// Detect agent type from hook input.
// Returns: "orchestrator" | "implementer" | "reviewer" | "default"
//
// The UserPromptSubmit event provides agent_type in the hook payload when
// Claude Code runs the hook for a subagent. For the main conversation thread,
// agent_type is absent or "human" — treated as orchestrator.
function detectAgentType(hookInput) {
  const agentType = (hookInput.agent_type || "").toLowerCase();

  if (!agentType || agentType === "human") return "orchestrator";

  if (
    agentType === "implementer" ||
    agentType.includes("implement") ||
    agentType.includes("builder") ||
    agentType.includes("engineer") ||
    agentType.includes("developer")
  ) {
    return "implementer";
  }

  if (
    agentType === "reviewer" ||
    agentType.includes("review") ||
    agentType.includes("qa") ||
    agentType.includes("tester") ||
    agentType.includes("auditor")
  ) {
    return "reviewer";
  }

  return "default";
}

// ---------------------------------------------------------------------------
// Mode templates
// ---------------------------------------------------------------------------

const MODE_TEMPLATES = {
  "implementation": "Mode: implementation. Search domain knowledge before writing code. Four-layer rule (RULE-010) applies. No stubs.",
  "research": "Mode: research. Produce findings, not changes. Use search_semantic + graph_query. Cross-reference before concluding.",
  "learning-loop": "Mode: learning-loop. Capture as lesson artifact first. Check for recurrence — promote to rule if pattern repeats. Do not treat as implementation request.",
  "planning": "Mode: planning. Scope against the graph. Check dependencies. Design approach before delegating. Produce a plan, not code.",
  "review": "Mode: review. Evidence-based verdict against acceptance criteria. Do not fix — report findings.",
  "debugging": "Mode: debugging. Investigate root cause first. If enforcement gap — CRITICAL priority. Use diagnostic-methodology knowledge.",
  "documentation": "Mode: documentation. Write docs before or instead of code. Follow artifact framework schema. Documentation is source of truth.",
};

const FALLBACK_CLASSIFICATION_PROMPT =
  "Classify this prompt before responding: implementation | research | learning-loop | planning | review | debugging | documentation. If learning-loop: capture as lesson first. Then proceed with the appropriate approach.";

// ---------------------------------------------------------------------------
// Semantic search via MCP server
// ---------------------------------------------------------------------------

// Send a single-shot JSON-RPC request to `orqa mcp` and return parsed results.
// Returns an array of knowledge names (e.g. ["thinking-mode-implementation"])
// or null if the search is unavailable or fails.
function searchKnowledge(query, projectPath) {
  const searchQuery = query.length > 200 ? query.slice(0, 200) : query;

  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "prompt-injector", version: "1.0.0" },
    },
  });
  const toolCall = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "search_semantic",
      arguments: { query: searchQuery, scope: "artifacts", limit: 10 },
    },
  });

  const input = `${initialize}\n${toolCall}\n`;

  let result;
  try {
    result = spawnSync("orqa", ["mcp", projectPath], {
      input,
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    return null;
  }

  if (result.error || result.status !== 0 || !result.stdout) {
    return null;
  }

  const lines = result.stdout.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.id !== 2) continue;
    if (parsed.error) return null;

    const textContent = parsed.result?.content?.[0]?.text;
    if (!textContent) return null;

    let hits;
    try {
      hits = JSON.parse(textContent);
    } catch {
      return null;
    }
    if (!Array.isArray(hits)) return null;

    return extractKnowledgeNames(hits);
  }

  return null;
}

// Extract knowledge names from search result file paths.
// Handles both directory-style (name/KNOW.md) and flat-file-style (name.md).
function extractKnowledgeNames(hits) {
  const names = new Set();

  for (const hit of hits) {
    const filePath = hit.file || hit.file_path || "";
    if (!filePath) continue;

    const normalised = filePath.replace(/\\/g, "/");

    const dirMatch = normalised.match(/\.orqa\/process\/knowledge\/([^/]+)\/[^/]+$/);
    if (dirMatch) {
      names.add(dirMatch[1]);
      continue;
    }
    const flatMatch = normalised.match(/\.orqa\/process\/knowledge\/([^/]+)\.md$/);
    if (flatMatch) {
      names.add(flatMatch[1]);
      continue;
    }

    const pluginDirMatch = normalised.match(/knowledge\/([^/]+)\/KNOW\.md$/);
    if (pluginDirMatch) {
      names.add(pluginDirMatch[1]);
      continue;
    }
    const pluginFlatMatch = normalised.match(/knowledge\/([^/]+)\.md$/);
    if (pluginFlatMatch) {
      const candidate = pluginFlatMatch[1];
      if (candidate !== "context-reminder" && candidate !== "README") {
        names.add(candidate);
      }
    }
  }

  return [...names];
}

// ---------------------------------------------------------------------------
// Thinking mode classification
// ---------------------------------------------------------------------------

// Classify the thinking mode by searching the user prompt against thinking-mode-*
// knowledge artifacts via ONNX semantic search.
//
// Returns: { mode: string | null, source: "onnx" | "none" }
function classifyThinkingMode(userMessage, projectDir) {
  const names = searchKnowledge(userMessage, projectDir);

  if (!names || names.length === 0) {
    return { mode: null, source: "none" };
  }

  // Filter to only thinking-mode-* matches and return the best (first) one.
  const modeMatch = names.find((name) => name.startsWith("thinking-mode-"));
  if (!modeMatch) {
    return { mode: null, source: "none" };
  }

  // Strip the "thinking-mode-" prefix to get the mode name.
  const mode = modeMatch.replace(/^thinking-mode-/, "");
  return { mode, source: "onnx" };
}

// ---------------------------------------------------------------------------
// Context line (simplified)
// ---------------------------------------------------------------------------

// Read project.json and return a concise one-liner with project name + dogfood status.
function getContextLine(projectDir) {
  const projectJsonPath = join(projectDir, ".orqa", "project.json");
  if (!existsSync(projectJsonPath)) {
    return "Project: unknown. Run `orqa plugin list` to check installed plugins if needed.";
  }

  let settings;
  try {
    settings = JSON.parse(readFileSync(projectJsonPath, "utf-8"));
  } catch {
    return "Project: unknown. Run `orqa plugin list` to check installed plugins if needed.";
  }

  const name = settings.name || "unknown";
  const dogfoodStatus = settings.dogfood
    ? "active — you are editing the app from the CLI"
    : "inactive";

  return `Project: ${name}. Dogfood: ${dogfoodStatus}. Run \`orqa plugin list\` to check installed plugins if needed.`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();

  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookInput;
  try {
    hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const userMessage = hookInput.user_message || hookInput.prompt || "";
  const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || ".";

  if (!userMessage) {
    process.exit(0);
  }

  const agentType = detectAgentType(hookInput);

  // Step 1: Classify thinking mode via ONNX semantic search.
  const { mode, source } = classifyThinkingMode(userMessage, projectDir);

  // Step 2: Build mode injection.
  let modeInjection;
  if (mode && MODE_TEMPLATES[mode]) {
    modeInjection = MODE_TEMPLATES[mode];
  } else {
    modeInjection = FALLBACK_CLASSIFICATION_PROMPT;
  }

  // Step 3: Append concise context line.
  const contextLine = getContextLine(projectDir);

  const systemMessage = `${modeInjection}\n\n${contextLine}`;

  logTelemetry("prompt-injector", "UserPromptSubmit", startTime, "injected", {
    agent_type: agentType,
    mode,
    source,
    query: userMessage.slice(0, 100),
    action: "allow",
  }, projectDir);

  process.stdout.write(JSON.stringify({ systemMessage }));
  process.exit(0);
}

main().catch(() => process.exit(0));
