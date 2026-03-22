#!/usr/bin/env node
// Prompt injector — single injection point for all UserPromptSubmit context.
// Combines three sources into one systemMessage:
//   1. Agent role preamble (read from .orqa agent definition frontmatter `preamble` field)
//   2. Thinking mode (ONNX semantic search against thinking-mode-* artifacts, fallback: LLM self-classification)
//   3. Context line (project name + dogfood status + plugin discovery hint)
//
// Replaces the static context-reminder.md that Claude Code would auto-inject.
// Used by UserPromptSubmit hook. Reads hook input from stdin.

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
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
// Agent role preamble (read from .orqa agent definitions)
// ---------------------------------------------------------------------------

// Parse YAML frontmatter from a markdown file using the yaml library.
// Returns the parsed object or null if no frontmatter found.
function parseFrontmatter(content) {
  const fmEnd = content.indexOf("\n---", 4);
  if (!content.startsWith("---\n") || fmEnd === -1) return null;

  const yamlStr = content.slice(4, fmEnd);
  try {
    return parseYaml(yamlStr);
  } catch {
    return null;
  }
}

// Read the agent's preamble by scanning all agent directories (plugins, connectors, .orqa).
// Matches by title (case-insensitive) since filenames are now ID-based (AGENT-xxxx.md).
// Uses the `preamble` frontmatter field, falling back to `description`.
function getAgentPreamble(agentType, projectDir) {
  // Collect all agent directories: .orqa/process/agents + plugins/*/agents + connectors/*/agents
  const agentDirs = [];
  const orqaAgents = join(projectDir, ".orqa", "process", "agents");
  if (existsSync(orqaAgents)) agentDirs.push(orqaAgents);

  for (const parentDir of ["plugins", "connectors"]) {
    const parent = join(projectDir, parentDir);
    if (!existsSync(parent)) continue;
    let entries;
    try { entries = readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = join(parent, entry.name, "agents");
      if (existsSync(dir)) agentDirs.push(dir);
    }
  }

  // Search all agent files for one whose title matches the agent type
  const normalizedType = agentType.toLowerCase().replace(/[_-]/g, " ");
  for (const dir of agentDirs) {
    let files;
    try { files = readdirSync(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm) continue;

        const title = (fm.title || "").toLowerCase().replace(/[_-]/g, " ");
        if (title !== normalizedType) continue;

        const preamble = fm.preamble || fm.description;
        if (preamble) {
          return `You are the ${agentType}: ${preamble}`;
        }
      } catch {
        continue;
      }
    }
  }

  // Fallback for agents without a definition file
  return `You are a ${agentType}. Follow the task delegated to you.`;
}

// ---------------------------------------------------------------------------
// Mode templates
// ---------------------------------------------------------------------------

// Mode templates come from thinking-mode knowledge artifacts (semantic search).
// Behavioral rules come from active rule artifacts with mechanism: behavioral entries.
// Session reminders come from plugin manifests (provides.session_reminders).
// Nothing is hardcoded — all governance context is artifact-driven.

/**
 * Load behavioral rule messages from all active rule artifacts.
 * Reads enforcement entries with mechanism: "behavioral" and extracts messages.
 * Uses the yaml library for proper frontmatter parsing.
 *
 * @param {string} projectDir
 * @returns {string} Combined behavioral rules text
 */
function loadBehavioralRulesFromArtifacts(projectDir) {
  const messages = [];
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

      for (const entry of fm.enforcement) {
        if (typeof entry !== "object" || !entry) continue;
        if (entry.mechanism === "behavioral" && entry.message) {
          messages.push(entry.message);
        }
      }
    }
  }

  return messages.join(" ");
}

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
      if (candidate !== "README") {
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
// Session state freshness check
// ---------------------------------------------------------------------------

// Check tmp/session-state.md and return a reminder string if action is needed.
// Returns a reminder string if the session state is missing, auto-generated,
// lacks a step checklist, or is stale (>10 minutes old).
// Returns null if the session state is orchestrator-maintained and fresh.
// All errors are swallowed — this check must never block the hook.
function checkSessionState(projectDir) {
  try {
    const sessionPath = join(projectDir, "tmp", "session-state.md");

    if (!existsSync(sessionPath)) {
      return "Session state reminder: tmp/session-state.md does not exist. Create a working session state with: scope, step checklist with completion status, and architecture decisions. Update it in real time as decisions happen (RULE-4f7e2a91).";
    }

    let content;
    try {
      content = readFileSync(sessionPath, "utf-8");
    } catch {
      return null;
    }

    const isAutoGenerated = content.includes("Session state auto-generated by stop hook");
    const isOrchestratorMaintained = content.includes("### Steps");

    if (isAutoGenerated && !isOrchestratorMaintained) {
      return "Session state reminder: tmp/session-state.md is auto-generated. Replace with a working session state containing: scope, step checklist with completion status, and architecture decisions. Update it in real time as decisions happen (RULE-4f7e2a91).";
    }

    if (!isOrchestratorMaintained) {
      return "Session state reminder: tmp/session-state.md exists but has no step checklist. Add a ### Steps section with checkboxes tracking current work, and include the scoped epic (EPIC-XXXXXXXX) so the stop hook can check completion (RULE-4f7e2a91).";
    }

    // Check for scoped epic — the stop hook needs this to verify epic completion
    const hasEpicScope = /EPIC-[a-f0-9]{8}/i.test(content);
    if (!hasEpicScope) {
      return "Session state reminder: tmp/session-state.md has no scoped epic. Add the epic ID (EPIC-XXXXXXXX) so the stop hook can check completion status (RULE-4f7e2a91).";
    }

    let stat;
    try {
      stat = statSync(sessionPath);
    } catch {
      return null;
    }

    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;

    if (ageMinutes > 10) {
      return `Session state reminder: tmp/session-state.md hasn't been updated in ${Math.round(ageMinutes)} minutes. If scope has changed or decisions were made, update it now (RULE-4f7e2a91).`;
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Injector config (plugin hook contributions)
// ---------------------------------------------------------------------------

// Read .orqa/connectors/claude-code/injector-config.json if present.
// Falls back to live scan of plugin manifests if the file is absent.
// Returns null if nothing is available.
function loadInjectorConfig(projectDir) {
  // Primary: pre-generated config file.
  const configPath = join(projectDir, ".orqa", "connectors", "claude-code", "injector-config.json");
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Fall through to live scan.
    }
  }

  // Fallback: scan plugin manifests live.
  return scanPluginManifestsLive(projectDir);
}

// Scan plugins/ and connectors/ for behavioral_rules, mode_templates,
// and session_reminders without requiring the pre-generated config.
function scanPluginManifestsLive(projectDir) {
  const allBehavioralRules = [];
  const mergedModeTemplates = {};
  const allSessionReminders = [];

  const scanDirs = [
    join(projectDir, "plugins"),
    join(projectDir, "connectors"),
  ];

  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Sort alphabetically — first declaration wins for mode_templates.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const manifestPath = join(dir, entry.name, "orqa-plugin.json");
      if (!existsSync(manifestPath)) continue;

      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      } catch {
        continue;
      }

      const provides = manifest?.provides;
      if (!provides) continue;

      if (Array.isArray(provides.behavioral_rules)) {
        allBehavioralRules.push(...provides.behavioral_rules);
      }

      if (provides.mode_templates && typeof provides.mode_templates === "object") {
        for (const [key, value] of Object.entries(provides.mode_templates)) {
          if (!(key in mergedModeTemplates)) {
            mergedModeTemplates[key] = value;
          }
        }
      }

      if (Array.isArray(provides.session_reminders)) {
        allSessionReminders.push(...provides.session_reminders);
      }
    }
  }

  const hasContent =
    allBehavioralRules.length > 0 ||
    Object.keys(mergedModeTemplates).length > 0 ||
    allSessionReminders.length > 0;

  if (!hasContent) return null;

  return {
    behavioral_rules: allBehavioralRules.join(" "),
    mode_templates: mergedModeTemplates,
    session_reminders: allSessionReminders.join(" "),
  };
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

  // Step 1: Load plugin hook contributions.
  const injectorConfig = loadInjectorConfig(projectDir);

  // Behavioral rules loaded from rule artifacts (mechanism: behavioral messages).
  // Mode templates and session reminders from plugin manifests.
  const artifactBehavioralRules = loadBehavioralRulesFromArtifacts(projectDir);
  const pluginBehavioralRules = injectorConfig?.behavioral_rules || "";
  const behavioralRules = [artifactBehavioralRules, pluginBehavioralRules].filter(Boolean).join(" ");
  const modeTemplates = (injectorConfig?.mode_templates && typeof injectorConfig.mode_templates === "object")
    ? injectorConfig.mode_templates
    : {};
  const sessionConstant = injectorConfig?.session_reminders || "";

  // Step 2: Classify thinking mode via ONNX semantic search.
  const { mode, source } = classifyThinkingMode(userMessage, projectDir);

  // Step 3: Build role preamble from .orqa agent definition (replaces static context-reminder.md).
  const preamble = getAgentPreamble(agentType, projectDir);

  // Step 4: Build mode injection (mode template + behavioral rules).
  let modeInjection;
  if (mode && modeTemplates[mode]) {
    modeInjection = `${modeTemplates[mode]} ${behavioralRules}`;
  } else {
    modeInjection = `Classify this prompt before responding: implementation | research | learning-loop | planning | review | debugging | documentation. If learning-loop: capture as lesson first. Then proceed with the appropriate approach. ${behavioralRules}`;
  }

  // Step 5: Append concise context line.
  const contextLine = getContextLine(projectDir);

  // Step 6: Check session state freshness.
  const sessionReminder = checkSessionState(projectDir);

  let systemMessage = `${preamble}\n\n${modeInjection}\n\n${contextLine}\n\n${sessionConstant}`;
  if (sessionReminder) {
    systemMessage += `\n\n${sessionReminder}`;
  }

  logTelemetry("prompt-injector", "UserPromptSubmit", startTime, "injected", {
    agent_type: agentType,
    mode,
    source,
    query: userMessage.slice(0, 100),
    action: "allow",
    session_state_reminder: !!sessionReminder,
  }, projectDir);

  process.stdout.write(JSON.stringify({ systemMessage }));
  process.exit(0);
}

main().catch(() => process.exit(0));
