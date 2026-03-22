// schema-registry.mjs — Single source of truth for artifact type inference.
//
// Builds a type registry from plugin manifests at runtime. Replaces all
// hardcoded inferTypeFromPath functions across hooks. The plugin manifest
// schemas define what types exist, their ID prefixes, default paths,
// required frontmatter, status transitions, and metadata.
//
// Usage:
//   import { buildTypeRegistry, inferType, isGovernanceArtifact } from "./schema-registry.mjs";
//   const registry = buildTypeRegistry(projectDir);
//   const type = inferType(registry, relPath, frontmatterId, frontmatterType);

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";

/**
 * @typedef {{
 *   key: string,
 *   idPrefix: string,
 *   defaultPath: string,
 *   label: string,
 *   icon: string,
 *   frontmatterRequired: string[],
 *   frontmatterOptional: string[],
 *   statusTransitions: Record<string, string[]>,
 *   influence: string | null,
 *   pluginName: string,
 * }} TypeDef
 */

/**
 * @typedef {{
 *   types: TypeDef[],
 *   byKey: Map<string, TypeDef>,
 *   byPrefix: Map<string, TypeDef>,
 *   byPathSegment: Map<string, TypeDef>,
 *   artifactDirs: Set<string>,
 * }} TypeRegistry
 */

/**
 * Build a type registry by scanning all plugin manifests.
 *
 * @param {string} projectDir
 * @returns {TypeRegistry}
 */
export function buildTypeRegistry(projectDir) {
  const types = [];
  const byKey = new Map();
  const byPrefix = new Map();
  const byPathSegment = new Map();
  const artifactDirs = new Set();

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

      const schemas = manifest?.provides?.schemas;
      if (!Array.isArray(schemas)) continue;

      for (const schema of schemas) {
        const typeDef = {
          key: schema.key,
          idPrefix: schema.idPrefix || "",
          defaultPath: schema.defaultPath || "",
          label: schema.label || schema.key,
          icon: schema.icon || "",
          frontmatterRequired: schema.frontmatter?.required || [],
          frontmatterOptional: schema.frontmatter?.optional || [],
          statusTransitions: schema.statusTransitions || {},
          influence: schema.influence || null,
          pluginName: manifest.name || entry.name,
        };

        types.push(typeDef);
        byKey.set(typeDef.key, typeDef);

        if (typeDef.idPrefix) {
          byPrefix.set(typeDef.idPrefix, typeDef);
        }

        // Extract the last path segment as a type-to-directory mapping
        // e.g., ".orqa/delivery/epics" → "epics" maps to "epic"
        if (typeDef.defaultPath) {
          const lastSegment = typeDef.defaultPath.split("/").pop();
          if (lastSegment) {
            byPathSegment.set(lastSegment, typeDef);
            artifactDirs.add(lastSegment);
          }
        }
      }

      // Also collect non-schema artifact directories from the plugin
      for (const subdir of ["agents", "rules", "knowledge", "documentation"]) {
        if (existsSync(join(parent, entry.name, subdir))) {
          artifactDirs.add(subdir);
        }
      }
    }
  }

  return { types, byKey, byPrefix, byPathSegment, artifactDirs };
}

/**
 * Infer artifact type from available signals.
 * Priority: frontmatter type → ID prefix → path segment.
 *
 * @param {TypeRegistry} registry
 * @param {string} relPath — path relative to project root
 * @param {string | null} frontmatterId — artifact ID from frontmatter
 * @param {string | null} frontmatterType — type field from frontmatter
 * @returns {string | null}
 */
export function inferType(registry, relPath, frontmatterId, frontmatterType) {
  // 1. Explicit frontmatter type
  if (frontmatterType && registry.byKey.has(frontmatterType)) {
    return frontmatterType;
  }
  if (frontmatterType) return frontmatterType; // trust frontmatter even if not in registry

  // 2. ID prefix
  if (frontmatterId) {
    const prefix = frontmatterId.split("-")[0];
    if (prefix && registry.byPrefix.has(prefix)) {
      return registry.byPrefix.get(prefix).key;
    }
  }

  // 3. Path segment
  const norm = relPath.replace(/\\/g, "/");
  const parts = norm.split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    if (registry.byPathSegment.has(parts[i])) {
      return registry.byPathSegment.get(parts[i]).key;
    }
  }

  return null;
}

/**
 * Check if a file path is a governance artifact based on the registry.
 *
 * @param {string} filePath
 * @param {string} projectDir
 * @param {TypeRegistry} registry
 * @returns {boolean}
 */
export function isGovernanceArtifact(filePath, projectDir, registry) {
  if (!filePath.endsWith(".md")) return false;
  const rel = relative(projectDir, filePath).replace(/\\/g, "/");

  // .orqa/ is always a governance path
  if (rel.startsWith(".orqa/")) return true;

  // Check if the path contains a known artifact directory from any plugin
  for (const dir of registry.artifactDirs) {
    if (new RegExp(`^(?:plugins|connectors|integrations)/[^/]+/${dir}/`).test(rel)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an artifact type requires a specific frontmatter field.
 *
 * @param {TypeRegistry} registry
 * @param {string} typeKey
 * @param {string} field
 * @returns {boolean}
 */
export function requiresField(registry, typeKey, field) {
  const typeDef = registry.byKey.get(typeKey);
  if (!typeDef) return false;
  return typeDef.frontmatterRequired.includes(field);
}

/**
 * Check if an artifact type is high-influence (pillar, vision, decision, rule
 * or any type with influence: "high" in schema).
 *
 * @param {TypeRegistry} registry
 * @param {string} typeKey
 * @returns {boolean}
 */
export function isHighInfluence(registry, typeKey) {
  const typeDef = registry.byKey.get(typeKey);
  if (!typeDef) return false;
  if (typeDef.influence === "high") return true;
  // Default high-influence types based on governance role
  // These are the types that define the governance framework itself
  return ["pillar", "vision", "decision", "rule"].includes(typeKey);
}
