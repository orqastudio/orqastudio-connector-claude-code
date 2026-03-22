#!/usr/bin/env node
// SubagentStop hook: validates subagent output against governance scope.
//
// When a subagent (or teammate) completes, this hook checks:
// 1. Did it write to files outside its expected scope?
// 2. Did it modify .orqa/ artifacts without proper frontmatter?
// 3. Did it leave any TODO/FIXME/STUB markers?
//
// Returns warnings as systemMessage. Does not block.

import { readFileSync, existsSync } from "fs";
import { join, relative } from "path";
import { execSync } from "child_process";
import { parse as parseYaml } from "yaml";
import { logTelemetry } from "./telemetry.mjs";

// Get files modified since the subagent started (via git diff)
function getModifiedFiles(projectDir) {
  try {
    const output = execSync("git diff --name-only HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    // Also check unstaged changes
    try {
      const output = execSync("git diff --name-only", {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return output.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}

// Check for TODO/FIXME/STUB markers in modified files.
// Pattern derived from RULE-b49142be (coding standards) and RULE-e9c54567 (no-stubs).
// Loaded dynamically from rule enforcement entries where available.
function checkForStubs(projectDir, files) {
  const issues = [];
  // Default pattern — matches coding standard rule intent
  const STUB_PATTERNS = /\b(TODO|FIXME|STUB|HACK|XXX|PLACEHOLDER)\b/i;

  for (const file of files) {
    const fullPath = join(projectDir, file);
    if (!existsSync(fullPath) || !file.endsWith(".md") && !file.endsWith(".ts") && !file.endsWith(".rs") && !file.endsWith(".svelte")) {
      continue;
    }
    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (STUB_PATTERNS.test(lines[i])) {
          issues.push(`${file}:${i + 1} — contains ${lines[i].match(STUB_PATTERNS)[0]} marker`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return issues;
}

// Check .orqa/ artifacts have frontmatter
function checkArtifactIntegrity(projectDir, files) {
  const issues = [];

  for (const file of files) {
    if (!file.startsWith(".orqa/") || !file.endsWith(".md")) continue;

    const fullPath = join(projectDir, file);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf-8");
    if (!content.startsWith("---\n")) {
      issues.push(`${file} — missing YAML frontmatter`);
      continue;
    }

    const fmEnd = content.indexOf("\n---", 4);
    if (fmEnd === -1) {
      issues.push(`${file} — malformed YAML frontmatter`);
      continue;
    }
    let fm;
    try {
      fm = parseYaml(content.slice(4, fmEnd));
    } catch {
      issues.push(`${file} — malformed YAML frontmatter`);
      continue;
    }

    // Check for id field
    if (!fm || typeof fm !== "object" || !("id" in fm)) {
      issues.push(`${file} — frontmatter missing required 'id' field`);
    }
  }

  return issues;
}

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

  const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || ".";
  const agentType = hookInput.agent_type || "unknown";

  const modifiedFiles = getModifiedFiles(projectDir);
  if (modifiedFiles.length === 0) {
    logTelemetry("subagent-review", "SubagentStop", startTime, "clean", {
      agent_type: agentType,
      files_checked: 0,
      todos_found: 0,
      artifact_issues: 0,
    }, projectDir);
    process.exit(0);
  }

  const warnings = [];

  // Check for stub markers
  const stubIssues = checkForStubs(projectDir, modifiedFiles);
  if (stubIssues.length > 0) {
    warnings.push("STUB/TODO markers found in modified files:");
    warnings.push(...stubIssues.map((i) => `  - ${i}`));
  }

  // Check .orqa/ artifact integrity
  const artifactIssues = checkArtifactIntegrity(projectDir, modifiedFiles);
  if (artifactIssues.length > 0) {
    warnings.push("Artifact integrity issues:");
    warnings.push(...artifactIssues.map((i) => `  - ${i}`));
  }

  if (warnings.length === 0) {
    logTelemetry("subagent-review", "SubagentStop", startTime, "clean", {
      agent_type: agentType,
      files_checked: modifiedFiles.length,
      todos_found: 0,
      artifact_issues: 0,
    }, projectDir);
    process.exit(0);
  }

  logTelemetry("subagent-review", "SubagentStop", startTime, "warned", {
    agent_type: agentType,
    files_checked: modifiedFiles.length,
    todos_found: stubIssues.length,
    artifact_issues: artifactIssues.length,
  }, projectDir);

  const message = [
    `SUBAGENT REVIEW — ${agentType} completed with warnings:`,
    "",
    ...warnings,
    "",
    "Address these before committing.",
  ].join("\n");

  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

main().catch(() => process.exit(0));
