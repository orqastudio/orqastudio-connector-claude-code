#!/usr/bin/env node
// PreToolUse hook: checks Bash tool calls for dangerous command patterns.
//
// Loads bash enforcement patterns from rule artifacts (mechanism: hook,
// event: bash). No hardcoded patterns — all enforcement comes from rules.
//
// Reads hook input from stdin (JSON with tool_name, tool_input).
// Blocked patterns: exit 2, write JSON to stderr with permissionDecision: "deny".
// Warn patterns: exit 0, write JSON to stdout with systemMessage.
// Safe patterns: exit 0, no output.

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { logTelemetry } from "./telemetry.mjs";

/**
 * Parse YAML frontmatter from a markdown file.
 * @param {string} content
 * @returns {Record<string, unknown> | null}
 */
function parseFrontmatter(content) {
  const fmEnd = content.indexOf("\n---", 4);
  if (!content.startsWith("---\n") || fmEnd === -1) return null;
  try {
    return parseYaml(content.slice(4, fmEnd));
  } catch {
    return null;
  }
}

/**
 * Load bash enforcement rules from all active rule artifacts.
 * Uses the yaml library for proper frontmatter parsing.
 *
 * @param {string} projectDir
 * @returns {Array<{severity: "block"|"warn", id: string, pattern: RegExp, reason: string}>}
 */
function loadBashRulesFromArtifacts(projectDir) {
  const rules = [];
  const ruleDirs = [];

  const devRules = join(projectDir, ".orqa", "process", "rules");
  if (existsSync(devRules)) ruleDirs.push(devRules);

  for (const parentDir of ["plugins", "connectors"]) {
    const parent = join(projectDir, parentDir);
    if (!existsSync(parent)) continue;
    let entries;
    try { entries = readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const rulesDir = join(parent, entry.name, "rules");
      if (existsSync(rulesDir)) ruleDirs.push(rulesDir);
    }
  }

  for (const dir of ruleDirs) {
    for (const file of readdirSync(dir)) {
      if (!file.startsWith("RULE-") || !file.endsWith(".md")) continue;

      let content;
      try { content = readFileSync(join(dir, file), "utf-8"); } catch { continue; }

      const fm = parseFrontmatter(content);
      if (!fm) continue;
      if (fm.status && fm.status !== "active") continue;
      if (!Array.isArray(fm.enforcement)) continue;

      const ruleId = fm.id || file.replace(".md", "");

      for (const entry of fm.enforcement) {
        if (typeof entry !== "object" || !entry) continue;
        if (entry.event !== "bash") continue;
        if (!entry.pattern) continue;

        const action = entry.action || "warn";
        const reason = entry.message || `Rule ${ruleId} violation`;

        try {
          rules.push({
            severity: action === "block" ? "block" : "warn",
            id: `${ruleId}:bash`,
            pattern: new RegExp(entry.pattern, "i"),
            reason,
          });
        } catch {
          // Invalid regex in rule — skip
        }
      }
    }
  }

  return rules;
}

/**
 * Normalise a command string for pattern matching.
 * @param {string} command
 * @returns {string}
 */
function normaliseCommand(command) {
  return command.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * @param {string} command
 * @param {Array} rules
 * @returns {{ blocked: Array, warned: Array }}
 */
function checkCommand(command, rules) {
  const normalised = normaliseCommand(command);
  const blocked = [];
  const warned = [];
  const seenIds = new Set();

  for (const rule of rules) {
    if (seenIds.has(rule.id)) continue;
    if (!rule.pattern.test(normalised)) continue;

    seenIds.add(rule.id);
    if (rule.severity === "block") {
      blocked.push(rule);
    } else {
      warned.push(rule);
    }
  }

  return { blocked, warned };
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

  const toolName = hookInput.tool_name || "";
  const command = (hookInput.tool_input || {}).command || "";
  const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || ".";

  if (toolName !== "Bash") {
    process.exit(0);
  }

  if (!command.trim()) {
    process.exit(0);
  }

  // Load bash patterns from rule artifacts — no hardcoded patterns
  const rules = loadBashRulesFromArtifacts(projectDir);
  const { blocked, warned } = checkCommand(command, rules);

  if (blocked.length === 0 && warned.length === 0) {
    logTelemetry("bash-safety", "PreToolUse", startTime, "allowed", {
      command_checked: command.slice(0, 120),
      patterns_matched: 0,
      rules_loaded: rules.length,
      action: "allow",
    }, projectDir);
    process.exit(0);
  }

  if (blocked.length > 0) {
    logTelemetry("bash-safety", "PreToolUse", startTime, "blocked", {
      command_checked: command.slice(0, 120),
      patterns_matched: blocked.length + warned.length,
      rules_loaded: rules.length,
      action: "block",
      blocked_rules: blocked.map((r) => r.id),
      warned_rules: warned.map((r) => r.id),
    }, projectDir);

    const lines = ["BASH SAFETY — command blocked:"];
    for (const rule of blocked) {
      lines.push(`  [${rule.id}] ${rule.reason}`);
    }
    if (warned.length > 0) {
      lines.push("Additional warnings:");
      for (const rule of warned) {
        lines.push(`  [${rule.id}] ${rule.reason}`);
      }
    }

    process.stderr.write(
      JSON.stringify({
        hookSpecificOutput: { permissionDecision: "deny" },
        systemMessage: lines.join("\n"),
      })
    );
    process.exit(2);
  }

  // Warn-only path
  logTelemetry("bash-safety", "PreToolUse", startTime, "warned", {
    command_checked: command.slice(0, 120),
    patterns_matched: warned.length,
    rules_loaded: rules.length,
    action: "warn",
    warned_rules: warned.map((r) => r.id),
  }, projectDir);

  const lines = ["BASH SAFETY — command allowed with warnings:"];
  for (const rule of warned) {
    lines.push(`  [${rule.id}] ${rule.reason}`);
  }

  process.stdout.write(
    JSON.stringify({ systemMessage: lines.join("\n") })
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
