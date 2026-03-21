/**
 * Connector Setup — Claude Code-specific post-install setup.
 *
 * This module owns all Claude Code-specific directory wiring:
 * - .claude/agents/ — merged directory of core + plugin agent symlinks
 * - .claude/rules   — symlink to .orqa/process/rules/
 * - .lsp.json       — aggregated LSP server configurations
 * - .mcp.json       — aggregated MCP server configurations
 *
 * It is called by the Claude Code connector after plugin installation,
 * and can also be run standalone to repair a broken install.
 *
 * The CLI installer (installer.ts) has no knowledge of .claude/ — this
 * module is the single source of truth for that directory's structure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ensureSymlink } from "@orqastudio/cli";

export interface ConnectorSetupResult {
	symlinkAgents: "created" | "skipped" | "exists" | "replaced";
	symlinkRules: "created" | "skipped" | "exists" | "replaced";
	pluginAgentCount: number;
	lspCount: number;
	mcpCount: number;
}

/**
 * Run post-install setup for the Claude Code connector:
 * 1. Build .claude/agents/ as a merged directory containing symlinks to:
 *    - All core agents from app/.orqa/process/agents/ (or .orqa/process/agents/)
 *    - All plugin agents declared via provides.agents in installed plugin manifests
 *    Plugin agents are keyed by their manifest `key` field (e.g. "rust-specialist").
 *    Core agents take precedence: a plugin cannot shadow a core agent filename.
 * 2. Create .claude/rules → .orqa/process/rules/ symlink
 * 3. Aggregate lspServers/mcpServers from all plugins/connectors → .lsp.json/.mcp.json
 *    written into the connector's plugin directory.
 *
 * Called automatically by installPlugin when the installed plugin is the Claude Code connector.
 * Can also be called standalone to repair a broken install.
 *
 * NOTE: .claude/CLAUDE.md is NOT managed here — it is a Claude Code project artifact
 * maintained directly, not derived from any source file.
 */
export function runConnectorSetup(
	projectRoot: string,
	connectorPluginDir: string,
): ConnectorSetupResult {
	const orqaDir = path.join(projectRoot, ".orqa");
	const appOrqaDir = path.join(projectRoot, "app", ".orqa");
	const claudeDir = path.join(projectRoot, ".claude");

	// Ensure .claude/ exists
	if (!fs.existsSync(claudeDir)) {
		fs.mkdirSync(claudeDir, { recursive: true });
	}

	// Agents live in app/.orqa/process/agents/ (OrqaStudio monorepo structure).
	// Fall back to .orqa/process/agents/ for non-monorepo projects.
	const agentsSource = fs.existsSync(path.join(appOrqaDir, "process", "agents"))
		? path.join(appOrqaDir, "process", "agents")
		: path.join(orqaDir, "process", "agents");

	// Build the merged .claude/agents/ directory with core + plugin agent symlinks.
	const symlinkAgents = setupMergedAgentsDir(
		path.join(claudeDir, "agents"),
		agentsSource,
		projectRoot,
	);

	const rulesTarget = path.join(orqaDir, "process", "rules");
	const symlinkRules: "created" | "skipped" | "exists" | "replaced" = fs.existsSync(rulesTarget)
		? ensureSymlink(rulesTarget, path.join(claudeDir, "rules")).status
		: "skipped";

	const { lsp, mcp } = aggregateServers(projectRoot);
	const pluginAgentCount = countPluginAgents(projectRoot);

	const lspPath = path.join(connectorPluginDir, ".lsp.json");
	const mcpPath = path.join(projectRoot, ".mcp.json");

	const newLsp = JSON.stringify(lsp, null, 2);
	const existingLsp = fs.existsSync(lspPath) ? fs.readFileSync(lspPath, "utf-8") : "";
	if (newLsp !== existingLsp) {
		fs.writeFileSync(lspPath, newLsp);
	}

	const newMcp = JSON.stringify({ mcpServers: mcp }, null, 2);
	const existingMcp = fs.existsSync(mcpPath) ? fs.readFileSync(mcpPath, "utf-8") : "";
	if (newMcp !== existingMcp) {
		fs.writeFileSync(mcpPath, newMcp);
	}

	return {
		symlinkAgents,
		symlinkRules,
		pluginAgentCount,
		lspCount: Object.keys(lsp).length,
		mcpCount: Object.keys(mcp).length,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build or repair the .claude/agents/ merged directory.
 *
 * Strategy:
 * - If the path is an old-style symlink pointing to a directory, remove it and
 *   recreate as a real directory. This migrates existing installs transparently.
 * - Create the directory if it doesn't exist.
 * - Symlink every core agent .md file from agentsSource into the directory.
 * - Symlink every plugin agent declared in provides.agents from installed plugins.
 *   Plugin agents are skipped if a core agent with the same filename already exists.
 *
 * Returns:
 * - "created": directory was newly created (or migrated from a symlink)
 * - "exists": directory already existed and was updated in-place
 * - "skipped": agentsSource does not exist — nothing to link
 */
function setupMergedAgentsDir(
	agentsDirPath: string,
	coreAgentsSource: string,
	projectRoot: string,
): "created" | "skipped" | "exists" {
	if (!fs.existsSync(coreAgentsSource)) {
		return "skipped";
	}

	let wasCreated = false;

	// Migrate: if it's a symlink, remove it so we can create a real directory
	try {
		const stat = fs.lstatSync(agentsDirPath);
		if (stat.isSymbolicLink()) {
			fs.unlinkSync(agentsDirPath);
			wasCreated = true;
		}
	} catch {
		// Path does not exist — will be created below
		wasCreated = true;
	}

	if (!fs.existsSync(agentsDirPath)) {
		fs.mkdirSync(agentsDirPath, { recursive: true });
		wasCreated = true;
	}

	// Collect core agent filenames so we can detect conflicts
	const coreAgentFiles = new Set<string>();
	for (const entry of fs.readdirSync(coreAgentsSource)) {
		if (!entry.endsWith(".md")) continue;
		coreAgentFiles.add(entry);
		const linkPath = path.join(agentsDirPath, entry);
		const targetPath = path.join(coreAgentsSource, entry);
		ensureSymlink(targetPath, linkPath);
	}

	// Link plugin agents
	const pluginsDirPath = path.join(projectRoot, "plugins");
	if (fs.existsSync(pluginsDirPath)) {
		for (const entry of fs.readdirSync(pluginsDirPath, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

			const pluginDir = path.join(pluginsDirPath, entry.name);
			const manifestPath = path.join(pluginDir, "orqa-plugin.json");
			if (!fs.existsSync(manifestPath)) continue;

			try {
				const raw = fs.readFileSync(manifestPath, "utf-8");
				const manifest = JSON.parse(raw) as {
					provides?: {
						agents?: Array<{ key: string; path: string }>;
					};
				};
				const agentEntries = manifest.provides?.agents ?? [];

				for (const agentEntry of agentEntries) {
					const agentFile = path.basename(agentEntry.path);
					// Core agents take precedence — never shadow them
					if (coreAgentFiles.has(agentFile)) continue;

					const targetPath = path.join(pluginDir, agentEntry.path);
					if (!fs.existsSync(targetPath)) continue;

					const linkPath = path.join(agentsDirPath, agentFile);
					ensureSymlink(targetPath, linkPath);
				}
			} catch {
				// Skip plugins with invalid manifests
			}
		}
	}

	return wasCreated ? "created" : "exists";
}

/**
 * Count the total number of plugin agent entries across all installed plugins.
 */
function countPluginAgents(projectRoot: string): number {
	let count = 0;
	const pluginsDirPath = path.join(projectRoot, "plugins");
	if (!fs.existsSync(pluginsDirPath)) return count;

	for (const entry of fs.readdirSync(pluginsDirPath, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const manifestPath = path.join(pluginsDirPath, entry.name, "orqa-plugin.json");
		if (!fs.existsSync(manifestPath)) continue;
		try {
			const raw = fs.readFileSync(manifestPath, "utf-8");
			const manifest = JSON.parse(raw) as {
				provides?: { agents?: unknown[] };
			};
			count += manifest.provides?.agents?.length ?? 0;
		} catch {
			// Skip invalid
		}
	}

	return count;
}

interface ServerMap {
	[name: string]: unknown;
}

/**
 * Scan plugins/ and connectors/ directories for orqa-plugin.json manifests
 * and aggregate their lspServers/mcpServers declarations.
 * First declaration wins (plugins/ is scanned before connectors/).
 */
function aggregateServers(projectRoot: string): { lsp: ServerMap; mcp: ServerMap } {
	const lsp: ServerMap = {};
	const mcp: ServerMap = {};

	const scanDirs = [
		path.join(projectRoot, "plugins"),
		path.join(projectRoot, "connectors"),
	];

	for (const scanDir of scanDirs) {
		if (!fs.existsSync(scanDir)) continue;

		for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

			const manifestPath = path.join(scanDir, entry.name, "orqa-plugin.json");
			if (!fs.existsSync(manifestPath)) continue;

			try {
				const raw = fs.readFileSync(manifestPath, "utf-8");
				const manifest = JSON.parse(raw) as {
					provides?: {
						lspServers?: Record<string, unknown>;
						mcpServers?: Record<string, unknown>;
					};
				};
				const provides = manifest.provides ?? {};

				if (provides.lspServers && typeof provides.lspServers === "object") {
					for (const [name, config] of Object.entries(provides.lspServers)) {
						if (!(name in lsp)) {
							lsp[name] = config;
						}
					}
				}

				if (provides.mcpServers && typeof provides.mcpServers === "object") {
					for (const [name, config] of Object.entries(provides.mcpServers)) {
						if (!(name in mcp)) {
							// Strip "type" field — Claude Code doesn't use it
							const { type: _type, ...mcpConfig } = config as Record<string, unknown>;
							mcp[name] = mcpConfig;
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
