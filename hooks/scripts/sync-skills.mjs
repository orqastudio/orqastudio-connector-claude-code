#!/usr/bin/env node
/**
 * Skill sync: generates Claude Code-native skills from OrqaStudio skills.
 *
 * Reads OrqaStudio skills from .orqa/process/skills/ and app/.orqa/process/skills/,
 * transforms them to Claude Code folder/SKILL.md format, and writes to the
 * connector's skills/ directory.
 *
 * Skills that already exist in the connector and have no OrqaStudio source
 * (connector-specific like delegation-patterns) are preserved.
 *
 * Usage:
 *   node hooks/scripts/sync-skills.mjs                # from connector root
 *   CLAUDE_PROJECT_DIR=/path node hooks/scripts/sync-skills.mjs  # explicit project
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { createHash } from "crypto";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(import.meta.url.replace("file:///", "").replace("file://", "")));
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Discover all plugin skill directories in the project
function discoverPluginSkillDirs(projectDir) {
  const pluginsDir = join(projectDir, "plugins");
  if (!existsSync(pluginsDir)) return [];
  const dirs = [];
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillsDir = join(pluginsDir, entry.name, "skills");
    if (existsSync(skillsDir)) {
      dirs.push(skillsDir);
    }
  }
  return dirs;
}

// OrqaStudio skill sources (flat .md files)
// Includes project-level, app-level, and all plugin skill directories
const SKILL_SOURCES = [
  join(PROJECT_DIR, ".orqa", "process", "skills"),
  join(PROJECT_DIR, "app", ".orqa", "process", "skills"),
  // Plugin skills
  ...discoverPluginSkillDirs(PROJECT_DIR),
];

// Connector skills directory (Claude Code folder/SKILL.md format)
const CONNECTOR_SKILLS = join(PLUGIN_ROOT, "skills");

// Skills that are connector-native (not synced from OrqaStudio).
// These exist ONLY in the connector and have no OrqaStudio source.
const NATIVE_SKILLS = new Set([
  "delegation-patterns",
  "governance-context",
  "artifact-creation",
  "artifact-ids",
  "plugin-setup",
  "rule-enforcement",
]);

// Proactive skills — synced because agents need them BEFORE acting.
// Everything else is available via MCP on demand (graph_query + graph_read).
const PROACTIVE_SKILLS = new Set([
  // Agent preloads (from agent skills: frontmatter)
  "composability",
  "centralized-logging",
  // Coding standards
  "svelte5-best-practices",
  "tailwind-design-system",
  "rust-async-patterns",
  "typescript-advanced-types",
  "orqa-frontend-best-practices",
  "orqa-backend-best-practices",
  // Intent-mapped skills (from prompt-injector INTENT_MAP)
  "orqa-ipc-patterns",
  "orqa-error-composition",
  "orqa-store-patterns",
  "orqa-store-orchestration",
  "orqa-domain-services",
  "orqa-repository-pattern",
  "orqa-streaming",
  "planning",
  "systems-thinking",
  "orqa-governance",
  "orqa-documentation",
  "diagnostic-methodology",
  "orqa-testing",
  "orqa-code-search",
  "restructuring-methodology",
  // Search
  "search",
]);

/**
 * Strip OrqaStudio YAML frontmatter and return Claude Code-compatible frontmatter + body.
 */
function transformSkill(content, skillName) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const yaml = fmMatch[1];
  const body = fmMatch[2].trim();

  // Extract key fields from OrqaStudio frontmatter
  const titleMatch = yaml.match(/^title:\s*"?(.+?)"?\s*$/m);
  const descMatch = yaml.match(/^description:\s*"?(.+?)(?:"|$)/m);
  const descMultiMatch = yaml.match(/^description:\s*\|\s*\n((?:\s+.+\n?)+)/m);
  const invocableMatch = yaml.match(/^user-invocable:\s*(true|false)/m);

  const title = titleMatch?.[1] || skillName;
  const description = descMultiMatch
    ? descMultiMatch[1].trim().split("\n").map(l => l.trim()).join(" ")
    : descMatch?.[1] || title;
  const userInvocable = invocableMatch?.[1] === "true";

  // Build Claude Code frontmatter
  const ccFrontmatter = [
    `name: ${skillName}`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `user-invocable: ${userInvocable}`,
  ].join("\n");

  return `---\n${ccFrontmatter}\n---\n\n${body}\n`;
}

/**
 * Compute content hash for drift detection.
 */
function hashContent(content) {
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

// Main
let synced = 0;
let skipped = 0;
let unchanged = 0;

for (const sourceDir of SKILL_SOURCES) {
  if (!existsSync(sourceDir)) continue;

  for (const file of readdirSync(sourceDir)) {
    if (!file.endsWith(".md")) continue;

    const skillName = file.replace(".md", "");

    // Skip connector-native skills
    if (NATIVE_SKILLS.has(skillName)) {
      skipped++;
      continue;
    }

    // Only sync proactive skills — everything else is available via MCP on demand
    if (!PROACTIVE_SKILLS.has(skillName)) {
      continue;
    }

    const sourcePath = join(sourceDir, file);
    const content = readFileSync(sourcePath, "utf-8");
    const transformed = transformSkill(content, skillName);
    if (!transformed) continue;

    const targetDir = join(CONNECTOR_SKILLS, skillName);
    const targetPath = join(targetDir, "SKILL.md");

    // Check if unchanged
    if (existsSync(targetPath)) {
      const existing = readFileSync(targetPath, "utf-8");
      if (hashContent(existing) === hashContent(transformed)) {
        unchanged++;
        continue;
      }
    }

    // Write transformed skill
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(targetPath, transformed);
    synced++;
  }
}

if (synced > 0 || skipped > 0) {
  const msg = `Skill sync: ${synced} synced, ${unchanged} unchanged, ${skipped} native (skipped)`;
  // Output for session-start hook to capture
  process.stdout.write(msg);
}
