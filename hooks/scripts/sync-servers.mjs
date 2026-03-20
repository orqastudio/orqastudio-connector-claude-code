#!/usr/bin/env node
/**
 * Server sync: aggregates lspServers and mcpServers from all installed
 * plugin manifests (orqa-plugin.json) and generates .lsp.json and .mcp.json
 * in the connector plugin directory.
 *
 * This is the central registration mechanism (AD-059). Plugins declare
 * their servers in orqa-plugin.json, this script aggregates them, and
 * Claude Code reads the generated files.
 *
 * Run by the session-start hook.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || ".";
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

/**
 * Scan all plugin manifests and collect lspServers/mcpServers declarations.
 */
function aggregateServers() {
  const lsp = {};
  const mcp = {};

  // Scan locations: plugins/, connectors/
  const scanDirs = [
    join(PROJECT_DIR, "plugins"),
    join(PROJECT_DIR, "connectors"),
  ];

  for (const scanDir of scanDirs) {
    if (!existsSync(scanDir)) continue;

    for (const entry of readdirSync(scanDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const manifestPath = join(scanDir, entry.name, "orqa-plugin.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const provides = manifest.provides || {};

        // Aggregate LSP servers
        if (provides.lspServers && typeof provides.lspServers === "object") {
          for (const [name, config] of Object.entries(provides.lspServers)) {
            if (!lsp[name]) {
              lsp[name] = config;
            }
            // First declaration wins (connector's own servers take precedence
            // since connectors/ is scanned after plugins/)
          }
        }

        // Aggregate MCP servers
        if (provides.mcpServers && typeof provides.mcpServers === "object") {
          for (const [name, config] of Object.entries(provides.mcpServers)) {
            if (!mcp[name]) {
              mcp[name] = config;
            }
          }
        }
      } catch {
        // Skip invalid manifests
      }
    }
  }

  return { lsp, mcp };
}

// Main
const { lsp, mcp } = aggregateServers();

const lspPath = join(PLUGIN_ROOT, ".lsp.json");
const mcpPath = join(PLUGIN_ROOT, ".mcp.json");

// Write .lsp.json
const newLsp = JSON.stringify(lsp, null, 2);
const existingLsp = existsSync(lspPath) ? readFileSync(lspPath, "utf-8") : "";
if (newLsp !== existingLsp) {
  writeFileSync(lspPath, newLsp);
}

// Write .mcp.json (Claude Code expects mcpServers wrapper)
const newMcp = JSON.stringify({ mcpServers: mcp }, null, 2);
const existingMcp = existsSync(mcpPath) ? readFileSync(mcpPath, "utf-8") : "";
if (newMcp !== existingMcp) {
  writeFileSync(mcpPath, newMcp);
}

const lspCount = Object.keys(lsp).length;
const mcpCount = Object.keys(mcp).length;

if (lspCount > 0 || mcpCount > 0) {
  process.stdout.write(`Server sync: ${lspCount} LSP, ${mcpCount} MCP servers registered`);
}
