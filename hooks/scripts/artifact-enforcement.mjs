#!/usr/bin/env node
// PreToolUse hook: enforces relationship requirements when creating new .orqa/ artifacts.
//
// Fires on Write/Edit to .orqa/ files. When the target file does NOT yet exist
// (new artifact creation), checks the content for minimum required relationships
// based on the artifact type inferred from the file path and `type:` frontmatter.
//
// Issues a WARN (non-blocking systemMessage) listing any missing relationships.
// Never blocks — governance debt is surfaced, not prevented.

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { parse as parseYaml } from "yaml";
import { logTelemetry } from "./telemetry.mjs";
import { buildTypeRegistry, inferType, isGovernanceArtifact } from "./schema-registry.mjs";

// ---------------------------------------------------------------------------
// Type → required relationship rules
// ---------------------------------------------------------------------------

/**
 * Build relationship requirements by scanning plugin manifests at runtime.
 * Returns a map of artifact type → required relationship keys, derived from
 * the `constraints.required: true` flag on relationship definitions.
 *
 * @param {string} projectDir
 * @returns {Record<string, Array<{key: string, label: string}>>}
 */
function buildTypeRequirements(projectDir) {
  const requirements = {};

  for (const parentDir of ["plugins", "connectors"]) {
    const parent = join(projectDir, parentDir);
    if (!existsSync(parent)) continue;
    let entries;
    try { entries = readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const manifestPath = join(parent, entry.name, "orqa-plugin.json");
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); } catch { continue; }
      const rels = manifest?.provides?.relationships;
      if (!Array.isArray(rels)) continue;
      for (const rel of rels) {
        if (!rel.constraints?.required) continue;
        const fromTypes = Array.isArray(rel.from) ? rel.from : [];
        for (const fromType of fromTypes) {
          if (!requirements[fromType]) requirements[fromType] = [];
          const toLabel = Array.isArray(rel.to) ? rel.to.join(" or ") : String(rel.to);
          const existing = requirements[fromType];
          if (!existing.some((r) => r.key === rel.key)) {
            existing.push({ key: rel.key, label: `${rel.key} → ${toLabel}` });
          }
        }
      }
    }
  }
  return requirements;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// isOrqaArtifact and inferTypeFromPath replaced by schema-registry.mjs

/**
 * Parse YAML frontmatter from markdown content.
 *
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
 * Extract a scalar frontmatter field value.
 *
 * @param {Record<string, unknown>} fm
 * @param {string} field
 * @returns {string | null}
 */
function getFrontmatterField(fm, field) {
  const val = fm[field];
  if (val === undefined || val === null) return null;
  return String(val);
}

/**
 * Extract all relationship type keys from a parsed frontmatter object.
 * Relationships are expected under a top-level key whose value is an array
 * of objects with a `type` property.
 *
 * @param {Record<string, unknown>} fm
 * @returns {string[]}
 */
function extractRelationshipTypes(fm) {
  const types = [];
  for (const val of Object.values(fm)) {
    if (!Array.isArray(val)) continue;
    for (const item of val) {
      if (item && typeof item === "object" && "type" in item) {
        types.push(String(item.type));
      }
    }
  }
  return types;
}

// inferTypeFromPath removed — use inferType from schema-registry.mjs

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

  // Only run on NEW artifacts — if the file already exists, skip.
  if (existsSync(filePath)) {
    process.exit(0);
  }

  // Extract the content that is about to be written.
  const content =
    toolName === "Write"
      ? toolInput.content || ""
      : toolInput.new_string || toolInput.content || "";

  if (!content) {
    process.exit(0);
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    process.exit(0);
  }

  // Determine artifact type from schema registry.
  const relPath = relative(projectDir, filePath).replace(/\\/g, "/");
  const frontmatterType = getFrontmatterField(fm, "type");
  const frontmatterId = getFrontmatterField(fm, "id");
  const artifactType = inferType(registry, relPath, frontmatterId, frontmatterType);

  if (!artifactType) {
    process.exit(0);
  }

  const typeRequirements = buildTypeRequirements(projectDir);
  const requirements = typeRequirements[artifactType];
  if (!requirements || requirements.length === 0) {
    process.exit(0);
  }

  // Check which required relationships are present.
  const presentTypes = new Set(extractRelationshipTypes(fm));
  const missing = requirements.filter((req) => !presentTypes.has(req.key));

  logTelemetry(
    "artifact-enforcement",
    "PreToolUse",
    startTime,
    missing.length === 0 ? "ok" : "warned",
    {
      file: relPath,
      artifact_type: artifactType,
      missing_count: missing.length,
      missing: missing.map((r) => r.key),
    },
    projectDir
  );

  if (missing.length === 0) {
    process.exit(0);
  }

  const lines = [
    `ARTIFACT RELATIONSHIP WARNING — ${relPath} (type: ${artifactType}):`,
    `New ${artifactType} artifact is missing required relationships:`,
  ];
  for (const req of missing) {
    lines.push(`  - ${req.label}`);
  }
  lines.push("");
  lines.push(
    "Add these relationships before committing. " +
      "Run `orqa enforce` to check the full graph after writing."
  );

  process.stdout.write(JSON.stringify({ systemMessage: lines.join("\n") }));
  process.exit(0);
}

main().catch(() => process.exit(0));
