#!/usr/bin/env node
// Prompt-based skill injector: examines user prompt, classifies intent,
// and injects relevant domain skills as systemMessage.
//
// Used by UserPromptSubmit hook. Reads hook input from stdin.
// Outputs JSON with systemMessage containing skill content.
//
// Intent classification currently uses keyword heuristics. Designed for
// easy upgrade to AI classification (Haiku model call) when API access
// is available in the hook context.

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// Intent-to-knowledge mapping table
// Each entry: { keywords: string[], skills: string[], description: string }
// Knowledge names must match directory names under .orqa/process/knowledge/ or app/.orqa/process/knowledge/
const INTENT_MAP = [
  {
    keywords: ["tauri command", "ipc", "invoke", "#[tauri::command]", "add a command", "new command"],
    skills: ["orqa-ipc-patterns", "orqa-error-composition"],
    description: "IPC boundary work",
  },
  {
    keywords: ["store", "reactive", "$state", "$derived", "$effect", "rune"],
    skills: ["orqa-store-patterns", "orqa-store-orchestration"],
    description: "Store architecture",
  },
  {
    keywords: ["component", "svelte component", "ui component", "create a component"],
    skills: ["svelte5-best-practices", "tailwind-design-system"],
    description: "Component work",
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
    keywords: ["plan", "approach", "design", "architect", "tradeoff"],
    skills: ["planning", "systems-thinking"],
    description: "Planning phase",
  },
  {
    keywords: ["review", "check", "audit", "verify", "quality"],
    skills: ["orqa-governance"],
    description: "Review phase",
  },
  {
    keywords: ["debug", "fix", "broken", "error", "failing", "crash", "bug"],
    skills: ["diagnostic-methodology", "systems-thinking"],
    description: "Diagnostic work",
  },
  {
    keywords: ["test", "testing", "vitest", "cargo test", "coverage"],
    skills: ["orqa-testing"],
    description: "Testing work",
  },
  {
    keywords: ["search", "find", "where is", "locate"],
    skills: ["orqa-code-search"],
    description: "Code search",
  },
  {
    keywords: ["governance", "rule", "knowledge", "artifact", "enforcement"],
    skills: ["orqa-governance", "orqa-documentation"],
    description: "Governance work",
  },
  {
    keywords: ["refactor", "restructur", "reorganiz", "extract", "consolidat"],
    skills: ["restructuring-methodology", "systems-thinking"],
    description: "Refactoring work",
  },
  {
    keywords: ["log", "logging", "logger", "console.log", "tracing"],
    skills: ["centralized-logging"],
    description: "Logging work",
  },
];

// Classify intent from user prompt using keyword matching
// Returns array of unique skill names to inject
function classifyIntent(prompt) {
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

// Read knowledge files, deduplicating against already-injected
function collectKnowledgeContent(projectDir, skillNames) {
  const alreadyInjected = readInjectedSkills(projectDir);
  const alreadySet = new Set(alreadyInjected);

  // Filter to only new skills
  const newSkills = skillNames.filter((name) => !alreadySet.has(name));
  if (newSkills.length === 0) return null;

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

  if (parts.length === 0) return null;

  // Persist updated state
  writeInjectedSkills(projectDir, [...alreadyInjected, ...injectedNow]);

  return parts.join("\n\n---\n\n");
}

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

// Main
async function main() {
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

  // Always inject context reminder with resolved project variables
  const reminder = readContextReminder(projectDir);
  if (reminder) {
    parts.push(reminder);
  }

  // Skill injection is DISABLED for the orchestrator's UserPromptSubmit hook.
  // The orchestrator delegates — it doesn't implement. Implementation agents
  // receive domain skills via their Agent tool prompt, not via this hook.
  // Only the context reminder (above) injects into the orchestrator.

  if (parts.length === 0) {
    process.exit(0);
  }

  // Return combined content as systemMessage
  const output = JSON.stringify({
    systemMessage: parts.join("\n\n---\n\n"),
  });
  process.stdout.write(output);
  process.exit(0);
}

main().catch(() => process.exit(0));
