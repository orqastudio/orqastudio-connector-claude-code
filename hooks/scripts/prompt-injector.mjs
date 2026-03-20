#!/usr/bin/env node
// Prompt-based knowledge injector: examines user prompt, finds relevant domain
// knowledge via semantic search, and injects it as systemMessage.
//
// Used by UserPromptSubmit hook. Reads hook input from stdin.
// Outputs JSON with systemMessage containing knowledge content.
//
// Primary path: semantic search via orqa mcp (JSON-RPC over stdio).
// Fallback path: keyword-based INTENT_MAP when search is unavailable.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "node:child_process";
import { logTelemetry } from "./telemetry.mjs";

// ---------------------------------------------------------------------------
// Semantic search via MCP server
// ---------------------------------------------------------------------------

// Send a single-shot JSON-RPC request to `orqa mcp` and return parsed results.
// Returns an array of knowledge directory names (e.g. ["orqa-store-patterns"])
// or null if the search is unavailable or fails.
function searchKnowledge(query, projectPath) {
  // Truncate very long prompts — the search query doesn't need the full text.
  const searchQuery = query.length > 200 ? query.slice(0, 200) : query;

  // Two JSON-RPC messages: initialize + tools/call (newline-separated).
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

  // result.error is set when spawn fails (e.g. orqa not on PATH) or times out.
  // result.status is null on timeout, non-zero on process error.
  if (result.error || result.status !== 0 || !result.stdout) {
    return null;
  }

  // Parse newline-delimited JSON-RPC responses.
  // We want the response to id=2 (the tools/call).
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

    // The tool result is inside result.content[0].text as a JSON string.
    const textContent = parsed.result?.content?.[0]?.text;
    if (!textContent) return null;

    let hits;
    try {
      hits = JSON.parse(textContent);
    } catch {
      return null;
    }
    if (!Array.isArray(hits)) return null;

    // Extract knowledge directory names from file paths.
    // Paths look like: .orqa/process/knowledge/<name>/KNOW.md
    // or: .orqa/process/knowledge/<name>.md
    const names = extractKnowledgeNames(hits);
    return names;
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

    // Normalise separators.
    const normalised = filePath.replace(/\\/g, "/");

    // Match patterns under .orqa/process/knowledge/
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

    // Match plugin knowledge/ paths (e.g. plugins/claude-code/knowledge/<name>/KNOW.md)
    const pluginDirMatch = normalised.match(/knowledge\/([^/]+)\/KNOW\.md$/);
    if (pluginDirMatch) {
      names.add(pluginDirMatch[1]);
      continue;
    }
    const pluginFlatMatch = normalised.match(/knowledge\/([^/]+)\.md$/);
    if (pluginFlatMatch) {
      const candidate = pluginFlatMatch[1];
      // Exclude generic filenames that aren't knowledge entries.
      if (candidate !== "context-reminder" && candidate !== "README") {
        names.add(candidate);
      }
    }
  }

  return [...names];
}

// ---------------------------------------------------------------------------
// INTENT_MAP: fallback when semantic search unavailable.
// Remove when search is always available.
// ---------------------------------------------------------------------------
const INTENT_MAP = [
  // ── Backend / IPC ──────────────────────────────────────────────────────────
  {
    keywords: ["tauri command", "ipc", "invoke", "#[tauri::command]", "add a command", "new command"],
    skills: ["orqa-ipc-patterns", "orqa-error-composition"],
    description: "IPC boundary work",
  },
  {
    keywords: ["domain", "domain service", "domain model", "business logic"],
    skills: ["orqa-domain-services", "orqa-error-composition"],
    description: "Domain logic",
  },
  {
    keywords: ["repository", "database", "sqlite", "migration", "query"],
    skills: ["orqa-repository-pattern"],
    description: "Data access layer",
  },
  {
    keywords: ["stream", "sidecar", "ndjson", "provider", "streaming"],
    skills: ["orqa-streaming"],
    description: "Streaming pipeline",
  },
  {
    keywords: ["rust", "async", "tokio", "future", "trait", "impl", "cargo"],
    skills: ["rust-async-patterns", "orqa-backend-best-practices"],
    description: "Rust / async backend work",
  },
  {
    keywords: ["typescript", "type alias", "generic", "discriminated union", "mapped type", "conditional type"],
    skills: ["typescript-advanced-types"],
    description: "TypeScript advanced types",
  },
  // ── Frontend / UI ─────────────────────────────────────────────────────────
  {
    keywords: ["store", "reactive", "$state", "$derived", "$effect", "rune"],
    skills: ["orqa-store-patterns", "orqa-store-orchestration"],
    description: "Store architecture",
  },
  {
    keywords: ["component", "svelte component", "ui component", "create a component"],
    skills: ["svelte5-best-practices", "orqa-frontend-best-practices"],
    description: "Component work",
  },
  {
    keywords: ["tailwind", "design system", "css", "theme", "token", "color", "spacing", "typography"],
    skills: ["tailwind-design-system"],
    description: "Tailwind / design system",
  },
  {
    keywords: ["extract component", "shared component", "reusable component", "component library"],
    skills: ["component-extraction", "svelte5-best-practices"],
    description: "Component extraction",
  },
  {
    keywords: ["ux", "accessibility", "usability", "a11y", "user experience", "ux review", "compliance"],
    skills: ["ux-compliance-review"],
    description: "UX and accessibility compliance",
  },
  // ── Testing ────────────────────────────────────────────────────────────────
  {
    keywords: ["test", "testing", "vitest", "cargo test", "coverage", "unit test", "integration test"],
    skills: ["orqa-testing"],
    description: "Testing work",
  },
  {
    keywords: ["e2e", "playwright", "end-to-end", "test engineering", "test strategy", "test plan"],
    skills: ["test-engineering"],
    description: "Test engineering and E2E",
  },
  {
    keywords: ["qa", "quality assurance", "acceptance", "verification", "qa verification"],
    skills: ["qa-verification"],
    description: "QA verification process",
  },
  // ── Debugging / Diagnostics ───────────────────────────────────────────────
  {
    keywords: ["debug", "fix", "broken", "error", "failing", "crash", "bug", "investigate", "diagnose"],
    skills: ["diagnostic-methodology", "systems-thinking"],
    description: "Diagnostic work",
  },
  // ── Planning / Architecture ────────────────────────────────────────────────
  {
    keywords: ["plan", "approach", "design", "architect", "tradeoff", "trade-off"],
    skills: ["planning", "systems-thinking"],
    description: "Planning phase",
  },
  {
    keywords: ["architecture", "evaluate architecture", "assess design", "design review", "architectural decision", "adr"],
    skills: ["architectural-evaluation", "systems-thinking"],
    description: "Architectural evaluation",
  },
  {
    keywords: ["system", "holistic", "impact analysis", "second-order", "ripple effect", "dependencies between"],
    skills: ["systems-thinking"],
    description: "Systems thinking",
  },
  {
    keywords: ["research", "investigate", "gather information", "explore options", "compare"],
    skills: ["research-methodology"],
    description: "Research methodology",
  },
  // ── Refactoring / Tech Debt ────────────────────────────────────────────────
  {
    keywords: ["refactor", "restructur", "reorganiz", "extract", "consolidat", "move files", "migrate files"],
    skills: ["restructuring-methodology", "systems-thinking"],
    description: "Refactoring work",
  },
  {
    keywords: ["tech debt", "cleanup", "refactor debt", "pay down debt", "dead code", "legacy code"],
    skills: ["tech-debt-management"],
    description: "Tech debt management",
  },
  {
    keywords: ["compose", "composable", "modular", "reuse", "combine", "compose modules"],
    skills: ["composability"],
    description: "Composability and modularity",
  },
  // ── Code Quality ───────────────────────────────────────────────────────────
  {
    keywords: ["code review", "quality review", "lint", "static analysis", "clippy", "eslint", "code quality"],
    skills: ["code-quality-review"],
    description: "Code quality review",
  },
  {
    keywords: ["security", "audit", "vulnerability", "owasp", "injection", "xss", "auth", "permissions"],
    skills: ["security-audit"],
    description: "Security audit",
  },
  // ── Search ─────────────────────────────────────────────────────────────────
  {
    keywords: ["search", "find", "where is", "locate", "grep", "semantic search", "chunkhound"],
    skills: ["search"],
    description: "Code and artifact search",
  },
  // ── Governance / Artifacts ─────────────────────────────────────────────────
  {
    keywords: ["governance", "rule", "knowledge", "artifact", "enforcement"],
    skills: ["orqa-governance", "orqa-documentation"],
    description: "Governance work",
  },
  {
    keywords: ["artifact status", "status transition", "promote", "lifecycle", "state machine", "in progress", "complete"],
    skills: ["artifact-status-management"],
    description: "Artifact status management",
  },
  {
    keywords: ["relationship", "link artifact", "connect artifact", "bidirectional", "artifact graph", "references"],
    skills: ["artifact-relationships"],
    description: "Artifact relationships",
  },
  {
    keywords: ["create artifact", "new artifact", "write artifact", "artifact template", "frontmatter"],
    skills: ["artifact-creation", "artifact-ids"],
    description: "Artifact creation",
  },
  {
    keywords: ["artifact id", "generate id", "artifact identifier", "id format"],
    skills: ["artifact-ids"],
    description: "Artifact ID generation",
  },
  {
    keywords: ["governance maintenance", "maintain governance", "audit governance", "graph health", "integrity check"],
    skills: ["governance-maintenance"],
    description: "Governance maintenance",
  },
  {
    keywords: ["governance context", "governance background", "orqa overview", "orqa architecture"],
    skills: ["governance-context", "orqa-architecture"],
    description: "Governance context and architecture",
  },
  {
    keywords: ["schema", "validate", "frontmatter", "core.json", "schema validation", "yaml schema"],
    skills: ["schema-validation"],
    description: "Schema validation",
  },
  {
    keywords: ["naming", "convention", "rename", "identifier", "naming convention", "name format"],
    skills: ["naming-conventions"],
    description: "Naming conventions",
  },
  {
    keywords: ["delegate", "delegation", "agent role", "orchestrat", "subagent", "assign task"],
    skills: ["delegation-patterns"],
    description: "Delegation patterns",
  },
  {
    keywords: ["rule enforcement", "enforce rule", "gate check", "pipeline gate", "pre-commit hook"],
    skills: ["rule-enforcement"],
    description: "Rule enforcement",
  },
  // ── Plugin Development ──────────────────────────────────────────────────────
  {
    keywords: ["plugin", "develop plugin", "create plugin", "build plugin", "first-party plugin", "core plugin"],
    skills: ["plugin-development-first-party", "orqa-plugin-development"],
    description: "First-party plugin development",
  },
  {
    keywords: ["third-party plugin", "community plugin", "external plugin", "publish plugin"],
    skills: ["plugin-development-third-party"],
    description: "Third-party plugin development",
  },
  {
    keywords: ["install plugin", "plugin setup", "configure plugin", "enable plugin", "plugin config"],
    skills: ["plugin-setup"],
    description: "Plugin setup and installation",
  },
  // ── Project Setup / Inference ───────────────────────────────────────────────
  {
    keywords: ["infer project", "detect project", "project type", "stack detection", "detect stack"],
    skills: ["project-inference", "project-type-software"],
    description: "Project inference and detection",
  },
  {
    keywords: ["project setup", "setup project", "initialize project", "new project", "onboard project"],
    skills: ["project-setup"],
    description: "Project setup",
  },
  {
    keywords: ["project migration", "migrate project", "upgrade project", "move project"],
    skills: ["project-migration"],
    description: "Project migration",
  },
  // ── Epic / Skills Maintenance ───────────────────────────────────────────────
  {
    keywords: ["epic", "requirement", "infer requirement", "epic scope", "derive requirement"],
    skills: ["epic-requirement-inference"],
    description: "Epic requirement inference",
  },
  {
    keywords: ["skills maintenance", "update skill", "maintain skill", "skill quality", "knowledge quality"],
    skills: ["skills-maintenance"],
    description: "Skills and knowledge maintenance",
  },
  // ── Logging ────────────────────────────────────────────────────────────────
  {
    keywords: ["log", "logging", "logger", "console.log", "tracing"],
    skills: ["centralized-logging"],
    description: "Logging work",
  },
  // ── Licensing ──────────────────────────────────────────────────────────────
  {
    keywords: ["license", "licensing", "dependency license", "license compatibility", "open source license"],
    skills: ["dependency-license-compatibility", "licensing-decisions"],
    description: "License and dependency licensing",
  },
];

// Classify intent from user prompt using keyword matching (INTENT_MAP fallback).
// Returns array of unique skill names to inject.
function classifyIntentFallback(prompt) {
  const lower = prompt.toLowerCase();
  const matchedSkills = new Set();

  for (const entry of INTENT_MAP) {
    const matches = entry.keywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (matches) {
      for (const skill of entry.skills) {
        matchedSkills.add(skill);
      }
    }
  }

  return [...matchedSkills];
}

// ---------------------------------------------------------------------------
// Deduplication state
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Knowledge file loading
// ---------------------------------------------------------------------------

// Strip YAML frontmatter from knowledge content
function stripFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  if (match) return match[1].trim();
  return content.trim();
}

// Read knowledge files, deduplicating against already-injected.
// Caps injection at maxKnowledge files per call.
// Returns { content: string|null, injected: string[], dedupCount: number }
function collectKnowledgeContent(projectDir, skillNames, maxKnowledge = 5) {
  const alreadyInjected = readInjectedSkills(projectDir);
  const alreadySet = new Set(alreadyInjected);

  // Filter to only new skills, then cap at maxKnowledge.
  const newSkills = skillNames.filter((name) => !alreadySet.has(name)).slice(0, maxKnowledge);
  const dedupCount = skillNames.length - newSkills.length;
  if (newSkills.length === 0) return { content: null, injected: [], dedupCount };

  const parts = [];
  const injectedNow = [];

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || "";

  for (const name of newSkills) {
    // Search plugin knowledge/ first, then project-level, then app-level.
    // KNOW.md is the canonical filename post-rename; SKILL.md is the legacy fallback.
    const candidates = [
      pluginRoot ? join(pluginRoot, "knowledge", name, "KNOW.md") : "",
      pluginRoot ? join(pluginRoot, "knowledge", name, "SKILL.md") : "",
      pluginRoot ? join(pluginRoot, "knowledge", `${name}.md`) : "",
      join(projectDir, ".orqa", "process", "knowledge", name, "KNOW.md"),
      join(projectDir, ".orqa", "process", "knowledge", `${name}.md`),
      join(projectDir, "app", ".orqa", "process", "knowledge", name, "KNOW.md"),
      join(projectDir, "app", ".orqa", "process", "knowledge", `${name}.md`),
    ].filter(Boolean);
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

  if (parts.length === 0) return { content: null, injected: [], dedupCount };

  // Persist updated state
  writeInjectedSkills(projectDir, [...alreadyInjected, ...injectedNow]);

  return { content: parts.join("\n\n---\n\n"), injected: injectedNow, dedupCount };
}

// ---------------------------------------------------------------------------
// Project settings and context reminder
// ---------------------------------------------------------------------------

// Read project.json and extract settings for template resolution
function readProjectSettings(projectDir) {
  const projectJsonPath = join(projectDir, ".orqa", "project.json");
  if (!existsSync(projectJsonPath)) return {};
  try {
    return JSON.parse(readFileSync(projectJsonPath, "utf-8"));
  } catch {
    return {};
  }
}

// Resolve {{variables}} in template from project settings
function resolveTemplate(template, projectDir) {
  const settings = readProjectSettings(projectDir);
  const pluginsConfig = settings.plugins || {};
  const plugins = Object.entries(pluginsConfig)
    .filter(([, cfg]) => cfg.installed && cfg.enabled)
    .map(([name]) => name);

  const vars = {
    "project.name": settings.name || "unknown",
    "project.dogfood": settings.dogfood ? "active — you are editing the app from the CLI" : "inactive",
    "project.plugins": plugins.length > 0 ? plugins.join(", ") : "none",
  };

  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => {
    return vars[key] ?? match;
  });
}

// Read the context reminder from plugin root and resolve template variables
function readContextReminder(projectDir) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || "";
  if (!pluginRoot) return "";
  const reminderPath = join(pluginRoot, "context-reminder.md");
  if (!existsSync(reminderPath)) return "";
  try {
    const template = readFileSync(reminderPath, "utf-8").trim();
    return resolveTemplate(template, projectDir);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Skill resolution (semantic search primary, INTENT_MAP fallback)
// ---------------------------------------------------------------------------

// Resolve skill names to inject for a given prompt.
// Tries semantic search first; falls back to INTENT_MAP if search unavailable.
// Returns { skillNames: string[], source: "semantic_search" | "intent_map_fallback" }
function resolveSkillNames(userMessage, projectDir) {
  // Attempt semantic search.
  const searchResults = searchKnowledge(userMessage, projectDir);
  if (searchResults !== null && searchResults.length > 0) {
    return { skillNames: searchResults, source: "semantic_search" };
  }

  // Fallback to keyword INTENT_MAP.
  const fallbackSkills = classifyIntentFallback(userMessage);
  return { skillNames: fallbackSkills, source: "intent_map_fallback" };
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

  const parts = [];

  // Always inject context reminder with resolved project variables.
  const reminder = readContextReminder(projectDir);
  if (reminder) {
    parts.push(reminder);
  }

  // Skill injection is DISABLED for the orchestrator's UserPromptSubmit hook.
  // The orchestrator delegates — it doesn't implement. Implementation agents
  // receive domain skills via their Agent tool prompt, not via this hook.
  // Only the context reminder (above) injects into the orchestrator.
  //
  // To enable knowledge injection, remove this block and let execution fall
  // through to the injection section below.
  {
    if (parts.length === 0) {
      logTelemetry("prompt-injector", "UserPromptSubmit", startTime, "skipped", {
        source: null,
        query: userMessage.slice(0, 100),
        matches: 0,
        knowledge_injected: [],
        dedup_count: 0,
        action: "allow",
      }, projectDir);
      process.exit(0);
    }

    logTelemetry("prompt-injector", "UserPromptSubmit", startTime, "injected", {
      source: null,
      query: userMessage.slice(0, 100),
      matches: 0,
      knowledge_injected: [],
      dedup_count: 0,
      action: "allow",
      reminder_injected: true,
    }, projectDir);

    const output = JSON.stringify({ systemMessage: parts.join("\n\n---\n\n") });
    process.stdout.write(output);
    process.exit(0);
  }

  // Knowledge injection block — reached when injection is enabled (above block removed).
  // Uses semantic search primary, INTENT_MAP fallback.
  /* eslint-disable no-unreachable */
  const { skillNames, source } = resolveSkillNames(userMessage, projectDir);
  const { content, injected, dedupCount } = collectKnowledgeContent(projectDir, skillNames);

  if (content) {
    parts.push(content);
  }

  if (parts.length === 0) {
    logTelemetry("prompt-injector", "UserPromptSubmit", startTime, "skipped", {
      source,
      query: userMessage.slice(0, 100),
      matches: skillNames.length,
      knowledge_injected: [],
      dedup_count: dedupCount,
      action: "allow",
    }, projectDir);
    process.exit(0);
  }

  logTelemetry("prompt-injector", "UserPromptSubmit", startTime, "injected", {
    source,
    query: userMessage.slice(0, 100),
    matches: skillNames.length,
    knowledge_injected: injected,
    dedup_count: dedupCount,
    action: "allow",
    reminder_injected: reminder.length > 0,
  }, projectDir);

  const output = JSON.stringify({ systemMessage: parts.join("\n\n---\n\n") });
  process.stdout.write(output);
  process.exit(0);
  /* eslint-enable no-unreachable */
}

main().catch(() => process.exit(0));
