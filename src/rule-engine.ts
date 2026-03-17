/**
 * Rule Engine — evaluates OrqaStudio governance rules against tool calls.
 *
 * This is the TypeScript equivalent of the rule-engine.mjs hook script,
 * extracted for reuse by other consumers (e.g. the OrqaStudio plugin).
 *
 * Rules are markdown artifacts in .orqa/process/rules/ with YAML frontmatter
 * containing an `enforcement` array. Each enforcement entry specifies:
 * - event: "file" (Write/Edit) or "bash" (Bash)
 * - action: "block" (deny), "warn" (proceed + message), "inject" (load skills)
 * - pattern: regex to match against content
 * - paths: glob patterns to match against file paths
 * - message: human-readable enforcement message
 * - skills: skill names to inject (for "inject" action)
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface RuleEnforcementEntry {
	event: "file" | "bash";
	action: "block" | "warn" | "inject";
	pattern?: string;
	paths?: string[];
	message?: string;
	skills?: string[];
}

export interface ParsedRule {
	id: string;
	name: string;
	enforcement: RuleEnforcementEntry[];
	filePath: string;
}

export interface RuleEnforcementResult {
	blocked: boolean;
	blockMessage?: string;
	warnings: string[];
	injectedSkills: string[];
	matchedRules: string[];
}

export class RuleEngine {
	private projectRoot: string;
	private rules: ParsedRule[] | null = null;

	constructor(projectRoot?: string) {
		this.projectRoot = projectRoot ?? process.cwd();
	}

	/**
	 * Load all rules from the .orqa/process/rules/ directory.
	 * Results are cached after first load.
	 */
	loadRules(): ParsedRule[] {
		if (this.rules) return this.rules;

		const rulesDir = path.join(this.projectRoot, ".orqa", "process", "rules");
		if (!fs.existsSync(rulesDir)) {
			this.rules = [];
			return this.rules;
		}

		this.rules = [];

		for (const entry of fs.readdirSync(rulesDir)) {
			if (!entry.endsWith(".md") || !entry.startsWith("RULE-")) continue;

			const filePath = path.join(rulesDir, entry);
			const content = fs.readFileSync(filePath, "utf-8");

			const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (!fmMatch) continue;

			const frontmatter = fmMatch[1];
			const idMatch = frontmatter.match(/^id:\s*(.+)/m);
			const nameMatch = frontmatter.match(/^name:\s*(.+)/m);

			if (!idMatch) continue;

			// Parse enforcement array from YAML
			const enforcement = this.parseEnforcement(frontmatter);
			if (enforcement.length === 0) continue;

			this.rules.push({
				id: idMatch[1].trim(),
				name: nameMatch?.[1]?.trim() ?? idMatch[1].trim(),
				enforcement,
				filePath,
			});
		}

		return this.rules;
	}

	/**
	 * Evaluate rules against a tool call.
	 *
	 * @param event - "file" for Write/Edit, "bash" for Bash
	 * @param content - file content or bash command
	 * @param filePath - file path (for file events)
	 */
	evaluate(
		event: "file" | "bash",
		content: string,
		filePath?: string,
	): RuleEnforcementResult {
		const rules = this.loadRules();
		const result: RuleEnforcementResult = {
			blocked: false,
			warnings: [],
			injectedSkills: [],
			matchedRules: [],
		};

		for (const rule of rules) {
			for (const entry of rule.enforcement) {
				if (entry.event !== event) continue;

				// Check path filter
				if (entry.paths && filePath) {
					const matches = entry.paths.some((glob) =>
						this.matchGlob(filePath, glob),
					);
					if (!matches) continue;
				}

				// Check pattern
				if (entry.pattern) {
					try {
						const regex = new RegExp(entry.pattern);
						if (!regex.test(content)) continue;
					} catch {
						continue;
					}
				}

				// Rule matched
				result.matchedRules.push(rule.id);

				switch (entry.action) {
					case "block":
						result.blocked = true;
						result.blockMessage =
							entry.message ?? `Blocked by ${rule.id}: ${rule.name}`;
						return result; // Block is immediate
					case "warn":
						result.warnings.push(
							entry.message ?? `Warning from ${rule.id}: ${rule.name}`,
						);
						break;
					case "inject":
						if (entry.skills) {
							result.injectedSkills.push(...entry.skills);
						}
						break;
				}
			}
		}

		return result;
	}

	/** Invalidate the cached rules (e.g. after rules are modified). */
	invalidateCache(): void {
		this.rules = null;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private parseEnforcement(yaml: string): RuleEnforcementEntry[] {
		const entries: RuleEnforcementEntry[] = [];

		// Find the enforcement: block in YAML
		const enfMatch = yaml.match(/^enforcement:\s*\n((?:\s+-[\s\S]*?)(?=\n[a-z]|\n---|$))/m);
		if (!enfMatch) return entries;

		// Split into individual entries (each starts with "  - ")
		const entryBlocks = enfMatch[1].split(/\n\s+-\s+/).filter(Boolean);

		for (const block of entryBlocks) {
			const lines = block.replace(/^\s+-\s+/, "").split("\n");
			const entry: Partial<RuleEnforcementEntry> = {};

			for (const line of lines) {
				const kvMatch = line.match(/^\s*(\w+):\s*(.+)/);
				if (!kvMatch) continue;

				const [, key, value] = kvMatch;
				switch (key) {
					case "event":
						entry.event = value.trim() as "file" | "bash";
						break;
					case "action":
						entry.action = value.trim() as "block" | "warn" | "inject";
						break;
					case "pattern":
						entry.pattern = value.trim().replace(/^["']|["']$/g, "");
						break;
					case "message":
						entry.message = value.trim().replace(/^["']|["']$/g, "");
						break;
				}

				// Handle paths as inline array
				if (key === "paths") {
					const pathsMatch = value.match(/\[(.+)\]/);
					if (pathsMatch) {
						entry.paths = pathsMatch[1].split(",").map((p) =>
							p.trim().replace(/^["']|["']$/g, ""),
						);
					}
				}

				// Handle skills as inline array
				if (key === "skills") {
					const skillsMatch = value.match(/\[(.+)\]/);
					if (skillsMatch) {
						entry.skills = skillsMatch[1].split(",").map((s) =>
							s.trim().replace(/^["']|["']$/g, ""),
						);
					}
				}
			}

			if (entry.event && entry.action) {
				entries.push(entry as RuleEnforcementEntry);
			}
		}

		return entries;
	}

	private matchGlob(filePath: string, glob: string): boolean {
		// Simple glob matching: * matches any chars, ** matches any path segments
		const pattern = glob
			.replace(/\*\*/g, "<<<DOUBLESTAR>>>")
			.replace(/\*/g, "[^/]*")
			.replace(/<<<DOUBLESTAR>>>/g, ".*")
			.replace(/\//g, "[\\\\/]");
		return new RegExp(`^${pattern}$`).test(filePath);
	}
}
