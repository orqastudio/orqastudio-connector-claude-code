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
import { parse as parseYaml } from "yaml";

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

			if (!content.startsWith("---\n")) continue;
			const fmEnd = content.indexOf("\n---", 4);
			if (fmEnd === -1) continue;

			let fm: Record<string, unknown>;
			try {
				fm = parseYaml(content.slice(4, fmEnd)) as Record<string, unknown>;
			} catch {
				continue;
			}

			if (!fm || typeof fm !== "object" || !fm.id) continue;

			const enforcement = Array.isArray(fm.enforcement) ? fm.enforcement : [];
			if (enforcement.length === 0) continue;

			this.rules.push({
				id: String(fm.id),
				name: String(fm.name ?? fm.title ?? fm.id),
				enforcement: enforcement.map((e: Record<string, unknown>) => ({
					event: String(e.event ?? ""),
					action: String(e.action ?? "warn"),
					pattern: String(e.pattern ?? ""),
					paths: Array.isArray(e.paths) ? e.paths.map(String) : null,
					message: String(e.message ?? ""),
					skills: Array.isArray(e.skills) ? e.skills.map(String) : null,
				})),
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
