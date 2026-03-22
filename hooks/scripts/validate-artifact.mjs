#!/usr/bin/env node
// PostToolUse hook: validates .orqa/ artifacts after Write/Edit operations.
//
// Delegates to `orqa enforce <file> --json` for schema-driven integrity checks.
// Non-blocking — reports validation issues as systemMessage warnings without
// denying the operation.

import { relative } from "path";
import { spawnSync } from "node:child_process";
import { logTelemetry } from "./telemetry.mjs";
import { buildTypeRegistry, isGovernanceArtifact } from "./schema-registry.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// isOrqaArtifact replaced by schema-registry.mjs

/**
 * Run `orqa enforce <filePath> --json` and return the parsed result.
 * Returns null if the CLI is unavailable or output is unparseable.
 *
 * @param {string} filePath  Absolute path to the artifact file
 * @param {string} projectDir  Project root (cwd for the spawn)
 * @returns {{ totalFindings: number, errors: number, warnings: number, findings: Array } | null}
 */
function runOrqaValidate(filePath, projectDir) {
  let result;
  try {
    result = spawnSync("orqa", ["validate", filePath, "--json"], {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    return null;
  }

  if (result.error || !result.stdout) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
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

  // Only validate Write and Edit on .orqa/ files.
  if (!["Write", "Edit"].includes(toolName)) {
    process.exit(0);
  }

  const filePath = toolInput.file_path || "";
  const registry = buildTypeRegistry(projectDir);
  if (!isGovernanceArtifact(filePath, projectDir, registry)) {
    process.exit(0);
  }

  const relPath = relative(projectDir, filePath).replace(/\\/g, "/");

  // ---------------------------------------------------------------------------
  // Delegate to `orqa enforce`
  // ---------------------------------------------------------------------------

  const validation = runOrqaValidate(filePath, projectDir);

  if (!validation) {
    // CLI unavailable — log and exit silently (no blocking).
    logTelemetry(
      "validate-artifact",
      "PostToolUse",
      startTime,
      "unavailable",
      { file: relPath, orqa_available: false },
      projectDir
    );
    process.exit(0);
  }

  const findings = Array.isArray(validation.findings) ? validation.findings : [];
  const errorFindings = findings.filter((f) => f.severity === "error" || f.severity === "Error");
  const warnFindings = findings.filter((f) => f.severity !== "error" && f.severity !== "Error");

  logTelemetry(
    "validate-artifact",
    "PostToolUse",
    startTime,
    validation.totalFindings === 0 ? "valid" : "invalid",
    {
      file: relPath,
      orqa_available: true,
      errors_found: validation.errors ?? errorFindings.length,
      warnings_issued: validation.warnings ?? warnFindings.length,
    },
    projectDir
  );

  if (validation.totalFindings === 0) {
    process.exit(0);
  }

  const lines = [`ARTIFACT VALIDATION — ${relPath}:`];

  if (errorFindings.length > 0) {
    lines.push("  Errors (must fix before committing):");
    for (const f of errorFindings) lines.push(`    - ${f.message}`);
  }

  if (warnFindings.length > 0) {
    lines.push("  Warnings:");
    for (const f of warnFindings) lines.push(`    - ${f.message}`);
  }

  lines.push("");
  lines.push("Fix errors before committing. Run `orqa enforce --fix` for auto-remediation.");

  process.stdout.write(JSON.stringify({ systemMessage: lines.join("\n") }));
  process.exit(0);
}

main().catch(() => process.exit(0));
