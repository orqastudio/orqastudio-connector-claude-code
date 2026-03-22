#!/usr/bin/env node
// PostToolUse hook: injects impact context when high-influence artifacts are modified.
//
// After a Write/Edit to .orqa/ files:
//   - Always injects context when the artifact is a pillar, vision, decision, or rule.
//   - Injects context when the artifact has > 20 downstream dependents.
//
// Uses graph_relationships from the MCP server to count downstream artifacts.
// Falls back to a minimal path-based check when MCP is unavailable.

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { logTelemetry } from "./telemetry.mjs";
import { buildTypeRegistry, inferType, isGovernanceArtifact, isHighInfluence } from "./schema-registry.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// HIGH_INFLUENCE_TYPES removed — use isHighInfluence from schema-registry.mjs

/** Threshold: inject impact context if downstream count exceeds this. */
const DOWNSTREAM_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// MCP bridge
// ---------------------------------------------------------------------------

/**
 * Call the MCP server for a single tool and return the parsed result, or null.
 *
 * @param {string} projectPath
 * @param {string} toolName
 * @param {Record<string, unknown>} toolArgs
 * @returns {unknown | null}
 */
function callMcpTool(projectPath, toolName, toolArgs) {
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "impact-check", version: "1.0.0" },
    },
  });

  const toolCall = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });

  const input = [initialize, toolCall].join("\n") + "\n";

  let result;
  try {
    result = spawnSync("orqa", ["mcp", projectPath], {
      input,
      encoding: "utf-8",
      timeout: 8000,
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
    try {
      return JSON.parse(textContent);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// isOrqaArtifact and inferTypeFromPath replaced by schema-registry.mjs

/**
 * Parse YAML frontmatter from file content and return a scalar field value.
 *
 * @param {string} content
 * @param {string} field
 * @returns {string | null}
 */
function readFrontmatterField(content, field) {
  const fmEnd = content.indexOf("\n---", 4);
  if (!content.startsWith("---\n") || fmEnd === -1) return null;
  let fm;
  try {
    fm = parseYaml(content.slice(4, fmEnd));
  } catch {
    return null;
  }
  if (!fm || typeof fm !== "object") return null;
  const val = fm[field];
  if (val === undefined || val === null) return null;
  return String(val);
}

/**
 * Count incoming references from a graph_relationships result.
 *
 * @param {unknown} relResult  Parsed graph_relationships JSON
 * @returns {number}
 */
function countIncoming(relResult) {
  if (!relResult || typeof relResult !== "object") return 0;
  const incoming = relResult.incoming;
  if (!Array.isArray(incoming)) return 0;
  return incoming.length;
}

/**
 * Summarise downstream dependencies by type for the impact message.
 *
 * @param {unknown} relResult  Parsed graph_relationships JSON
 * @returns {string}
 */
function summariseIncoming(relResult) {
  if (!relResult || typeof relResult !== "object") return "";
  const incoming = relResult.incoming;
  if (!Array.isArray(incoming) || incoming.length === 0) return "";

  /** @type {Record<string, number>} */
  const byType = {};
  for (const rel of incoming) {
    const t = rel.type || "unknown";
    byType[t] = (byType[t] || 0) + 1;
  }

  return Object.entries(byType)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
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

  const toolName = hookInput.tool_name || "";
  const toolInput = hookInput.tool_input || {};
  const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || ".";

  if (!["Write", "Edit"].includes(toolName)) {
    process.exit(0);
  }

  const filePath = toolInput.file_path || "";
  const registry = buildTypeRegistry(projectDir);
  if (!isGovernanceArtifact(filePath, projectDir, registry)) {
    process.exit(0);
  }

  if (!existsSync(filePath)) {
    process.exit(0);
  }

  const relPath = relative(projectDir, filePath).replace(/\\/g, "/");

  // Read the artifact to extract its ID and type.
  let fileContent = "";
  try {
    fileContent = readFileSync(filePath, "utf-8");
  } catch {
    process.exit(0);
  }

  const artifactId = readFrontmatterField(fileContent, "id");
  const frontmatterType = readFrontmatterField(fileContent, "type");
  const artifactType = inferType(registry, relPath, artifactId, frontmatterType);

  if (!artifactId) {
    process.exit(0);
  }

  const highInfluence = artifactType
    ? isHighInfluence(registry, artifactType)
    : false;

  // Query the MCP server for relationship data.
  const relResult = callMcpTool(projectDir, "graph_relationships", {
    id: artifactId,
    direction: "in",
  });

  const downstreamCount = countIncoming(relResult);
  const shouldInject = highInfluence || downstreamCount > DOWNSTREAM_THRESHOLD;

  logTelemetry(
    "impact-check",
    "PostToolUse",
    startTime,
    shouldInject ? "injected" : "skipped",
    {
      file: relPath,
      artifact_id: artifactId,
      artifact_type: artifactType,
      is_high_influence: highInfluence,
      downstream_count: downstreamCount,
      mcp_available: relResult !== null,
    },
    projectDir
  );

  if (!shouldInject) {
    process.exit(0);
  }

  const lines = [`IMPACT CONTEXT — ${artifactId} (${artifactType || "unknown type"}):`];

  if (highInfluence) {
    lines.push(
      `This is a ${artifactType} artifact. Changes affect the entire governance framework.`
    );
  }

  if (downstreamCount > 0) {
    const summary = summariseIncoming(relResult);
    lines.push(
      `It has ${downstreamCount} downstream relationship${downstreamCount !== 1 ? "s" : ""}: ${summary || "(see graph_relationships for details)"}.`
    );
    lines.push(
      "Review downstream artifacts for cascading effects before committing."
    );
  } else if (relResult === null) {
    lines.push(
      "MCP server unavailable — downstream impact count unknown. " +
        "Run `orqa enforce` to check graph integrity after this change."
    );
  }

  if (lines.length > 1) {
    process.stdout.write(JSON.stringify({ systemMessage: lines.join("\n") }));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
