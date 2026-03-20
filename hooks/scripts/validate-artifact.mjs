#!/usr/bin/env node
// PostToolUse hook: validates .orqa/ artifacts after Write/Edit operations.
// Checks frontmatter schema, relationship validity, and bidirectional integrity.
//
// Runs after Write/Edit completes on .orqa/ files. Non-blocking — reports
// validation issues as systemMessage warnings without denying the operation.
//
// This replicates validation from libs/lsp-server/src/validation.rs.
// When the LSP is running as a dev process, this can be replaced with an LSP call.

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { logTelemetry } from "./telemetry.mjs";

// ---------------------------------------------------------------------------
// Core schema (loaded from libs/types/src/platform/core.json)
// ---------------------------------------------------------------------------

/**
 * Load core.json relationship keys (forward + inverse) from the project or
 * fall back to a hardcoded set so the hook still runs when the repo is not
 * fully checked out.
 *
 * @param {string} projectDir
 * @returns {{ validRelationshipTypes: Set<string> }}
 */
function loadCoreSchema(projectDir) {
  const candidates = [
    join(projectDir, "libs/types/src/platform/core.json"),
    // Connector installed into a target project — look two levels up
    join(projectDir, "../../libs/types/src/platform/core.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = JSON.parse(readFileSync(candidate, "utf-8"));
        const keys = new Set();
        if (Array.isArray(raw.relationships)) {
          for (const rel of raw.relationships) {
            if (rel.key) keys.add(rel.key);
            if (rel.inverse) keys.add(rel.inverse);
          }
        }
        return { validRelationshipTypes: keys };
      } catch {
        // fall through to hardcoded fallback
      }
    }
  }

  // Hardcoded fallback — mirrors core.json as of 2026-03-20.
  // Keep this in sync when core.json changes.
  return {
    validRelationshipTypes: new Set([
      "upholds", "upheld-by",
      "grounded", "grounded-by",
      "benefits", "benefited-by",
      "crystallises", "crystallised-by",
      "spawns", "spawned-by",
      "drives", "driven-by",
      "governs", "governed-by",
      "enforces", "enforced-by",
      "codifies", "codified-by",
      "informs", "informed-by",
      "teaches", "taught-by",
      "guides", "guided-by",
      "cautions", "cautioned-by",
      "observes", "observed-by",
      "employs", "employed-by",
      "documents", "documented-by",
      "synchronised-with",
      "merged-into", "merged-from",
      "revises", "revised-by",
      // Common delivery relationships not yet in core.json but widely used
      "delivers", "delivered-by",
      "fulfils", "fulfilled-by",
      "realises", "realised-by",
      "belongs-to",
      "depends-on", "depended-on-by",
      "related-to",
      "parent-of", "child-of",
      "supersedes", "superseded-by",
      "references",
    ]),
  };
}

// ---------------------------------------------------------------------------
// The 12 canonical artifact statuses (mirrors VALID_STATUSES in validation.rs)
// ---------------------------------------------------------------------------

const VALID_STATUSES = [
  "captured", "exploring", "ready", "prioritised", "active",
  "hold", "blocked", "review", "completed", "surpassed", "archived", "recurring",
];

// ---------------------------------------------------------------------------
// Artifact ID validation (mirrors is_valid_artifact_id + is_hex_artifact_id)
// ---------------------------------------------------------------------------

/**
 * Returns true for both legacy sequential IDs (TYPE-NNN) and hex IDs (TYPE-XXXXXXXX).
 * Supports compound prefixes like RULE-PREFIX-NNN.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isValidArtifactId(id) {
  if (!id) return false;
  const dashIdx = id.indexOf("-");
  if (dashIdx === -1) return false;

  const prefix = id.slice(0, dashIdx);
  const suffix = id.slice(dashIdx + 1);

  // Simple case: single UPPERCASE prefix
  if (/^[A-Z]+$/.test(prefix)) {
    return /^\d+$/.test(suffix) || (suffix.length === 8 && /^[0-9a-f]+$/i.test(suffix));
  }

  // Compound prefix: find the last dash, check final suffix
  const lastDash = id.lastIndexOf("-");
  if (lastDash === dashIdx) return false; // no compound possible
  const compoundPrefix = id.slice(0, lastDash);
  const finalSuffix = id.slice(lastDash + 1);
  if (!/^[A-Z][A-Z-]*[A-Z]$/.test(compoundPrefix)) return false;
  return /^\d+$/.test(finalSuffix) || (finalSuffix.length === 8 && /^[0-9a-f]+$/i.test(finalSuffix));
}

/**
 * Returns true if the ID uses the new hex format (TYPE-XXXXXXXX with 8 hex chars).
 *
 * @param {string} id
 * @returns {boolean}
 */
function isHexArtifactId(id) {
  if (!id) return false;
  const lastDash = id.lastIndexOf("-");
  if (lastDash === -1) return false;
  const suffix = id.slice(lastDash + 1);
  return suffix.length === 8 && /^[0-9a-f]+$/i.test(suffix);
}

// ---------------------------------------------------------------------------
// Frontmatter parser
//
// Handles simple scalar fields and multi-line relationship blocks:
//
//   relationships:
//     - target: EPIC-001
//       type: delivers
//       rationale: ...
//
// Returns:
//   { fields: Map<string, string>, relationships: Array<{type, target}>, raw: string }
// ---------------------------------------------------------------------------

/**
 * @param {string} content  Full file content
 * @returns {{ fields: Map<string, string>, relationships: Array<{type: string, target: string}>, raw: string } | null}
 */
function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return null;
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return null;

  const raw = content.slice(4, endIdx);
  const lines = raw.split("\n");

  const fields = new Map();
  const relationships = [];
  const duplicateKeys = [];

  let inRelationships = false;
  let currentRel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === "" || line.startsWith("  ") || line.startsWith("\t")) {
      // Indented line — part of a block value or relationship entry
      if (inRelationships) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          // New relationship item
          if (currentRel) relationships.push(currentRel);
          currentRel = {};
          const afterDash = trimmed.slice(2);
          const colonIdx = afterDash.indexOf(":");
          if (colonIdx !== -1) {
            const key = afterDash.slice(0, colonIdx).trim();
            const val = afterDash.slice(colonIdx + 1).trim().replace(/^"|"$/g, "");
            currentRel[key] = val;
          }
        } else if (currentRel && trimmed.length > 0) {
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx !== -1) {
            const key = trimmed.slice(0, colonIdx).trim();
            const val = trimmed.slice(colonIdx + 1).trim().replace(/^"|"$/g, "");
            currentRel[key] = val;
          }
        }
      }
      continue;
    }

    // Top-level key: value line
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^"|"$/g, "");

      if (key === "relationships") {
        if (currentRel) {
          relationships.push(currentRel);
          currentRel = null;
        }
        inRelationships = true;
      } else {
        inRelationships = false;
        if (currentRel) {
          relationships.push(currentRel);
          currentRel = null;
        }
        if (fields.has(key)) {
          duplicateKeys.push(key);
        } else {
          fields.set(key, val);
        }
      }
    }
  }

  if (currentRel) relationships.push(currentRel);

  return { fields, relationships, raw, duplicateKeys };
}

// ---------------------------------------------------------------------------
// Artifact graph builder
//
// Walks the .orqa/ directory tree collecting all artifact IDs and their
// relationships, so we can validate:
//   1. Relationship targets exist
//   2. Bidirectional relationships are declared in both directions
// ---------------------------------------------------------------------------

/**
 * Build a lightweight in-memory graph of all .orqa/ artifacts.
 *
 * @param {string} projectDir
 * @returns {Map<string, { path: string, relationships: Array<{type: string, target: string}> }>}
 */
function buildArtifactGraph(projectDir) {
  const orqaDir = join(projectDir, ".orqa");
  if (!existsSync(orqaDir)) return new Map();

  /** @type {Map<string, { path: string, relationships: Array<{type: string, target: string}> }>} */
  const graph = new Map();

  /**
   * @param {string} dir
   */
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".md")) {
        let text;
        try {
          text = readFileSync(full, "utf-8");
        } catch {
          continue;
        }
        const fm = parseFrontmatter(text);
        if (!fm) continue;
        const id = fm.fields.get("id");
        if (!id) continue;
        const relPath = relative(projectDir, full).replace(/\\/g, "/");
        graph.set(id, { path: relPath, relationships: fm.relationships || [] });
      }
    }
  }

  walk(orqaDir);
  return graph;
}

// ---------------------------------------------------------------------------
// Validation logic (mirrors libs/lsp-server/src/validation.rs)
// ---------------------------------------------------------------------------

/**
 * Validate a single artifact file.
 *
 * @param {string} filePath         Absolute path to the file
 * @param {string} projectDir       Absolute path to the project root
 * @param {Map<string, {path: string, relationships: Array<{type: string, target: string}>}>} graph
 * @param {Set<string>} validRelationshipTypes
 * @returns {{ errors: string[], warnings: string[], info: string[] }}
 */
function validateArtifact(filePath, projectDir, graph, validRelationshipTypes) {
  const errors = [];
  const warnings = [];
  const info = [];

  if (!existsSync(filePath)) return { errors, warnings, info };

  const content = readFileSync(filePath, "utf-8");
  const rel = relative(projectDir, filePath).replace(/\\/g, "/");

  // 1. Frontmatter presence
  if (!content.startsWith("---\n")) {
    errors.push("Missing YAML frontmatter (file must start with ---)");
    return { errors, warnings, info };
  }
  if (!content.slice(4).includes("\n---")) {
    errors.push("Unclosed YAML frontmatter (missing closing ---)");
    return { errors, warnings, info };
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push("Could not parse YAML frontmatter");
    return { errors, warnings, info };
  }

  // 2. Duplicate frontmatter keys
  for (const key of fm.duplicateKeys) {
    errors.push(`Duplicate frontmatter key "${key}"`);
  }

  // 3. Required `id` field
  const id = fm.fields.get("id");
  if (!id) {
    errors.push("Missing required frontmatter field: id");
  } else {
    // 4. Artifact ID format
    if (!isValidArtifactId(id)) {
      errors.push(`Invalid artifact ID "${id}" — must be TYPE-XXXXXXXX (8 hex chars) or TYPE-NNN (sequential)`);
    } else if (!isHexArtifactId(id)) {
      warnings.push(`Legacy sequential ID "${id}" — new artifacts should use TYPE-XXXXXXXX hex format (AD-057)`);
    }
  }

  // 5. Status validation (status is not strictly required, but if present must be valid)
  const status = fm.fields.get("status");
  if (status && !VALID_STATUSES.includes(status)) {
    errors.push(`Invalid status "${status}" — must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  // 6. Knowledge artifact must have `synchronised-with`
  const artifactType = fm.fields.get("type");
  const isKnowledge = artifactType === "knowledge" || rel.includes("/knowledge/");
  if (isKnowledge) {
    const hasSyncWith = fm.relationships.some((r) => r.type === "synchronised-with");
    if (!hasSyncWith) {
      errors.push(
        "Knowledge artifacts must have at least one synchronised-with relationship to a human-facing doc (AD-058)"
      );
    }
  }

  // 7. Relationship type validation + target existence + bidirectional check
  if (fm.relationships.length > 0) {
    for (const rel_entry of fm.relationships) {
      const relType = rel_entry.type;
      const target = rel_entry.target;

      // 7a. Relationship type must be a known key from core.json
      if (relType && !validRelationshipTypes.has(relType)) {
        warnings.push(`Unknown relationship type "${relType}" — not a key in core.json relationships`);
      }

      // 7b. Relationship target must exist in the graph
      if (target && !graph.has(target)) {
        warnings.push(`Relationship target "${target}" not found in artifact graph`);
      }

      // 7c. Bidirectional check — if A→B exists, warn if B→A is missing
      // (only check when we have both ends in the graph)
      if (target && id && graph.has(target)) {
        const targetNode = graph.get(target);
        const hasInverse = targetNode.relationships.some((r) => r.target === id);
        if (!hasInverse) {
          info.push(
            `Bidirectional relationship missing: "${target}" has no back-reference to "${id}" — consider adding the inverse relationship`
          );
        }
      }
    }
  }

  // 8. Missing `relationships` section on delivery/process artifacts
  if (rel.startsWith(".orqa/delivery/") || rel.startsWith(".orqa/process/")) {
    if (fm.relationships.length === 0 && !fm.raw.includes("relationships:")) {
      info.push(
        "No relationships declared — most delivery/process artifacts should have at least one"
      );
    }
  }

  return { errors, warnings, info };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file path is within the .orqa/ directory.
 *
 * @param {string} filePath
 * @param {string} projectDir
 * @returns {boolean}
 */
function isOrqaArtifact(filePath, projectDir) {
  const rel = relative(projectDir, filePath).replace(/\\/g, "/");
  return rel.startsWith(".orqa/") && filePath.endsWith(".md");
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

  // Only validate Write and Edit on .orqa/ files
  if (!["Write", "Edit"].includes(toolName)) {
    process.exit(0);
  }

  const filePath = toolInput.file_path || "";
  if (!isOrqaArtifact(filePath, projectDir)) {
    process.exit(0);
  }

  const relPath = relative(projectDir, filePath).replace(/\\/g, "/");

  // Load schema and build artifact graph
  const { validRelationshipTypes } = loadCoreSchema(projectDir);
  const graph = buildArtifactGraph(projectDir);

  const { errors, warnings, info } = validateArtifact(
    filePath,
    projectDir,
    graph,
    validRelationshipTypes
  );

  const totalIssues = errors.length + warnings.length + info.length;

  if (totalIssues === 0) {
    logTelemetry("validate-artifact", "PostToolUse", startTime, "valid", {
      file: relPath,
      errors_found: 0,
      warnings_issued: 0,
      info_issued: 0,
    }, projectDir);
    process.exit(0);
  }

  logTelemetry("validate-artifact", "PostToolUse", startTime, "invalid", {
    file: relPath,
    errors_found: errors.length,
    warnings_issued: warnings.length,
    info_issued: info.length,
    errors,
    warnings,
    info,
  }, projectDir);

  const lines = [`ARTIFACT VALIDATION — ${relPath}:`];
  if (errors.length > 0) {
    lines.push("  Errors (must fix before committing):");
    for (const e of errors) lines.push(`    - ${e}`);
  }
  if (warnings.length > 0) {
    lines.push("  Warnings:");
    for (const w of warnings) lines.push(`    - ${w}`);
  }
  if (info.length > 0) {
    lines.push("  Info:");
    for (const i of info) lines.push(`    - ${i}`);
  }
  lines.push("");
  lines.push("Fix errors before committing. Run `orqa validate` for full integrity check.");

  process.stdout.write(JSON.stringify({ systemMessage: lines.join("\n") }));
  process.exit(0);
}

main().catch(() => process.exit(0));
