#!/usr/bin/env node
// Rule engine: loads active rules with enforcement entries, evaluates patterns
// against tool call context. Used by PreToolUse hook.
//
// Reads hook input from stdin (JSON with tool_name, tool_input).
// Outputs JSON for Claude Code hook system.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { logTelemetry } from "./telemetry.mjs";

// Parse YAML frontmatter from a markdown file using the yaml library.
function parseFrontmatter(content) {
  const fmEnd = content.indexOf("\n---", 4);
  if (!content.startsWith("---\n") || fmEnd === -1) return null;
  try {
    return parseYaml(content.slice(4, fmEnd));
  } catch {
    return null;
  }
}

// Check if a file path matches a glob pattern
function matchGlob(filePath, pattern) {
  // Normalize separators
  const normalized = filePath.replace(/\\/g, "/");
  // Convert glob to regex
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*");
  return new RegExp(regex).test(normalized);
}

// Collect all rule directories: .orqa/process/rules + plugins/*/rules + connectors/*/rules
function findRulesDirs(projectDir) {
  const dirs = [];
  const devRules = join(projectDir, ".orqa", "process", "rules");
  if (existsSync(devRules)) dirs.push(devRules);

  for (const parentDir of ["plugins", "connectors"]) {
    const parent = join(projectDir, parentDir);
    if (!existsSync(parent)) continue;
    let entries;
    try { entries = readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const rulesDir = join(parent, entry.name, "rules");
      if (existsSync(rulesDir)) dirs.push(rulesDir);
    }
  }
  return dirs;
}

// Load all active rules with enforcement entries from all rule directories
function loadEnforcementRules(projectDir) {
  const rules = [];
  for (const rulesDir of findRulesDirs(projectDir)) {
    for (const file of readdirSync(rulesDir)) {
      if (!file.startsWith("RULE-") || !file.endsWith(".md")) continue;

      const content = readFileSync(join(rulesDir, file), "utf-8");
      const fm = parseFrontmatter(content);
      if (!fm) continue;
      if (fm.status && fm.status !== "active") continue;
      if (!fm.enforcement || !Array.isArray(fm.enforcement)) continue;

      for (const entry of fm.enforcement) {
        rules.push({
          ruleId: fm.id || file.replace(".md", ""),
          event: entry.event,
          pattern: entry.pattern,
          paths: entry.paths || null,
          action: entry.action,
          message: entry.message,
          skills: entry.skills || null,
        });
      }
    }
  }
  return rules;
}

// Evaluate enforcement rules against a tool call
function evaluate(rules, toolName, toolInput) {
  const violations = [];

  for (const rule of rules) {
    let matched = false;

    if (rule.event === "file" && (toolName === "Write" || toolName === "Edit")) {
      // Get file path and content from tool input
      const filePath = toolInput.file_path || "";
      const content =
        toolName === "Write"
          ? toolInput.content || ""
          : toolInput.new_string || "";

      // Check path filter
      if (rule.paths) {
        const pathList = Array.isArray(rule.paths)
          ? rule.paths
          : [rule.paths];
        const pathMatches = pathList.some((p) => matchGlob(filePath, p));
        if (!pathMatches) continue;
      }

      // Check content pattern
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(content)) {
          matched = true;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    if (rule.event === "bash" && toolName === "Bash") {
      const command = toolInput.command || "";
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(command)) {
          matched = true;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    if (matched) {
      violations.push({
        ruleId: rule.ruleId,
        action: rule.action,
        message: rule.message,
        skills: rule.skills,
      });
    }
  }

  return violations;
}

// Read the session-level injected skills state
function readInjectedSkills(projectDir) {
  const stateFile = join(projectDir, "tmp", ".injected-skills.json");
  if (!existsSync(stateFile)) return [];
  try {
    return JSON.parse(readFileSync(stateFile, "utf-8"));
  } catch {
    return [];
  }
}

// Write the session-level injected skills state
function writeInjectedSkills(projectDir, skills) {
  const tmpDir = join(projectDir, "tmp");
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  writeFileSync(join(tmpDir, ".injected-skills.json"), JSON.stringify(skills));
}

// Strip YAML frontmatter from skill content
function stripFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  if (match) return match[1].trim();
  return content.trim();
}

// Read knowledge content for injection, deduplicating against already-injected skills
function collectKnowledgeContent(projectDir, injectViolations) {
  const alreadyInjected = readInjectedSkills(projectDir);
  const alreadySet = new Set(alreadyInjected);

  // Gather all unique skill names from all inject violations
  const allSkillNames = [];
  for (const v of injectViolations) {
    if (!v.skills) continue;
    const skillList = Array.isArray(v.skills) ? v.skills : [v.skills];
    for (const name of skillList) {
      if (!alreadySet.has(name) && !allSkillNames.includes(name)) {
        allSkillNames.push(name);
      }
    }
  }

  if (allSkillNames.length === 0) return null;

  // Read skill files
  const parts = [];
  const injectedNow = [];
  for (const name of allSkillNames) {
    // Search project-level, then plugin/connector knowledge directories
    const candidates = [
      join(projectDir, ".orqa", "process", "knowledge", name, "KNOW.md"),
      join(projectDir, ".orqa", "process", "knowledge", `${name}.md`),
    ];
    // Add plugin and connector knowledge paths
    for (const parentDir of ["plugins", "connectors"]) {
      const parent = join(projectDir, parentDir);
      if (!existsSync(parent)) continue;
      let entries;
      try { entries = readdirSync(parent, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        candidates.push(join(parent, entry.name, "knowledge", name, "KNOW.md"));
        candidates.push(join(parent, entry.name, "knowledge", `${name}.md`));
      }
    }
    const knowledgePath = candidates.find((p) => existsSync(p));
    if (!knowledgePath) continue;
    try {
      const raw = readFileSync(knowledgePath, "utf-8");
      const content = stripFrontmatter(raw);
      if (content) {
        parts.push(content);
        injectedNow.push(name);
      }
    } catch {
      // Skip unreadable files silently
    }
  }

  if (parts.length === 0) return null;

  // Persist updated state
  writeInjectedSkills(projectDir, [...alreadyInjected, ...injectedNow]);

  return parts.join("\n\n---\n\n");
}

// Cache for dogfood flag — read project.json once per process
let _dogfoodCache = null;

// Check if dogfood mode is active in .orqa/project.json
function isDogfoodMode(projectDir) {
  if (_dogfoodCache !== null) return _dogfoodCache;
  try {
    const projectJsonPath = join(projectDir, ".orqa", "project.json");
    if (!existsSync(projectJsonPath)) {
      _dogfoodCache = false;
      return false;
    }
    const raw = readFileSync(projectJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    _dogfoodCache = parsed.dogfood === true;
  } catch {
    _dogfoodCache = false;
  }
  return _dogfoodCache;
}

// Check dogfood-conditional enforcement rules.
// Rules with condition: "dogfood: true" are only evaluated when dogfood mode is active.
// This replaces the old hardcoded checkDogfoodPluginSafety function.
function checkDogfoodRules(projectDir, toolName, toolInput, rules) {
  if (!isDogfoodMode(projectDir)) return null;
  if (!["Write", "Edit"].includes(toolName)) return null;

  const filePath = (toolInput.file_path || "").replace(/\\/g, "/");

  for (const rule of rules) {
    if (rule.condition !== "dogfood: true") continue;
    if (rule.event !== "file") continue;

    if (rule.pattern && filePath.includes(rule.pattern)) {
      return {
        decision: rule.action || "block",
        reason: rule.message || `[${rule.ruleId}] Dogfood safety: blocked by conditional enforcement`,
      };
    }
  }
  return null;
}

// Main
async function main() {
  const startTime = Date.now();

  // Read stdin
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

  // Only evaluate for Write, Edit, and Bash tools
  if (!["Write", "Edit", "Bash"].includes(toolName)) {
    process.exit(0);
  }

  // Load rules first so dogfood checks can use them
  const rules = loadEnforcementRules(projectDir);

  // Dogfood-conditional rules (evaluated before general rules)
  const dogfoodBlock = checkDogfoodRules(projectDir, toolName, toolInput, rules);
  if (dogfoodBlock) {
    logTelemetry("rule-engine", "PreToolUse", startTime, "blocked", {
      violations_found: 1,
      rules_evaluated: 0,
      tool: toolName,
      action: "block",
      blocked_rules: ["dogfood-plugin-safety"],
      warned_rules: [],
      injected_rules: [],
    }, projectDir);

    const output = JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "deny",
      },
      systemMessage: dogfoodBlock.reason,
    });
    process.stderr.write(output);
    process.exit(2);
  }

  const violations = evaluate(rules, toolName, toolInput);

  if (violations.length === 0) {
    logTelemetry("rule-engine", "PreToolUse", startTime, "clean", {
      violations_found: 0,
      rules_evaluated: rules.length,
      tool: toolName,
      action: "allow",
    }, projectDir);
    process.exit(0);
  }

  // Separate violations by action
  const blockViolations = violations.filter((v) => v.action === "block");
  const warnViolations = violations.filter((v) => v.action === "warn");
  const injectViolations = violations.filter((v) => v.action === "inject");

  // Collect knowledge content for inject entries (with session dedup)
  const knowledgeContent = injectViolations.length > 0
    ? collectKnowledgeContent(projectDir, injectViolations)
    : null;

  // Determine overall action: block > warn > inject-only
  const hasBlock = blockViolations.length > 0;
  const hasWarn = warnViolations.length > 0;

  if (hasBlock) {
    logTelemetry("rule-engine", "PreToolUse", startTime, "blocked", {
      violations_found: violations.length,
      rules_evaluated: rules.length,
      tool: toolName,
      action: "block",
      blocked_rules: blockViolations.map((v) => v.ruleId),
      warned_rules: warnViolations.map((v) => v.ruleId),
      injected_rules: injectViolations.map((v) => v.ruleId),
    }, projectDir);

    // Blocking: deny the tool call
    const messages = [...blockViolations, ...warnViolations].map(
      (v) => `[${v.ruleId}] ${v.message}`
    );
    const combinedMessage = [
      ...messages,
      ...(knowledgeContent ? [knowledgeContent] : []),
    ].join("\n");

    const output = JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "deny",
      },
      systemMessage: combinedMessage,
    });
    process.stderr.write(output);
    process.exit(2);
  } else if (hasWarn || knowledgeContent) {
    logTelemetry("rule-engine", "PreToolUse", startTime, "warned", {
      violations_found: violations.length,
      rules_evaluated: rules.length,
      tool: toolName,
      action: "warn",
      warned_rules: warnViolations.map((v) => v.ruleId),
      injected_rules: injectViolations.map((v) => v.ruleId),
    }, projectDir);

    // Non-blocking: warn and/or inject knowledge
    const messages = warnViolations.map((v) => `[${v.ruleId}] ${v.message}`);
    const combinedMessage = [
      ...messages,
      ...(knowledgeContent ? [knowledgeContent] : []),
    ].join("\n");

    const output = JSON.stringify({
      systemMessage: combinedMessage,
    });
    process.stdout.write(output);
    process.exit(0);
  } else {
    logTelemetry("rule-engine", "PreToolUse", startTime, "inject-deduped", {
      violations_found: violations.length,
      rules_evaluated: rules.length,
      tool: toolName,
      action: "allow",
      injected_rules: injectViolations.map((v) => v.ruleId),
    }, projectDir);

    // Inject entries had no new skills to inject (all already injected)
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
