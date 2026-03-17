/**
 * Prompt Injector — classifies user intent and injects relevant skills.
 *
 * This is the TypeScript equivalent of the prompt-injector.mjs hook script,
 * extracted for reuse by other consumers.
 *
 * Skills are markdown artifacts in .orqa/process/skills/<name>/SKILL.md.
 * The injector maps user intent keywords to skill names, deduplicates
 * across a session, and returns the skill content for prompt injection.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface IntentMapping {
	keywords: string[];
	skills: string[];
}

export interface InjectionResult {
	injectedSkills: string[];
	content: string;
}

/** Default intent → skill mappings. Can be extended by plugins. */
const DEFAULT_INTENT_MAP: IntentMapping[] = [
	{ keywords: ["ipc", "invoke", "tauri", "command"], skills: ["ipc-patterns"] },
	{ keywords: ["store", "state", "svelte-store", "reactive"], skills: ["state-management"] },
	{ keywords: ["component", "svelte", "ui", "widget", "view"], skills: ["component-patterns"] },
	{ keywords: ["domain", "business", "model", "entity"], skills: ["domain-modelling"] },
	{ keywords: ["repository", "repo", "database", "sqlite"], skills: ["repository-patterns"] },
	{ keywords: ["stream", "sidecar", "ndjson", "provider"], skills: ["streaming-patterns"] },
	{ keywords: ["plan", "design", "architect", "approach"], skills: ["planning"] },
	{ keywords: ["review", "pr", "pull request", "check"], skills: ["code-review"] },
	{ keywords: ["debug", "fix", "error", "bug", "crash"], skills: ["debugging"] },
	{ keywords: ["test", "spec", "assert", "verify"], skills: ["testing"] },
	{ keywords: ["search", "find", "embed", "semantic"], skills: ["search-patterns"] },
	{ keywords: ["governance", "rule", "enforce", "compliance"], skills: ["governance"] },
	{ keywords: ["refactor", "rename", "extract", "clean"], skills: ["refactoring"] },
];

export class PromptInjector {
	private projectRoot: string;
	private injectedSkills: Set<string>;
	private intentMap: IntentMapping[];
	private trackingFile: string;

	constructor(projectRoot?: string) {
		this.projectRoot = projectRoot ?? process.cwd();
		this.intentMap = DEFAULT_INTENT_MAP;
		this.trackingFile = path.join(
			this.projectRoot,
			".orqa",
			"tmp",
			".injected-skills.json",
		);
		this.injectedSkills = this.loadTracking();
	}

	/**
	 * Classify user intent and inject matching skills.
	 *
	 * @param userMessage - The user's prompt message
	 * @returns Skills to inject (empty if all already injected this session)
	 */
	inject(userMessage: string): InjectionResult {
		const lower = userMessage.toLowerCase();
		const matchedSkills = new Set<string>();

		for (const mapping of this.intentMap) {
			if (mapping.keywords.some((kw) => lower.includes(kw))) {
				for (const skill of mapping.skills) {
					if (!this.injectedSkills.has(skill)) {
						matchedSkills.add(skill);
					}
				}
			}
		}

		if (matchedSkills.size === 0) {
			return { injectedSkills: [], content: "" };
		}

		// Load skill content
		const contents: string[] = [];
		const injected: string[] = [];

		for (const skillName of matchedSkills) {
			const content = this.loadSkillContent(skillName);
			if (content) {
				contents.push(content);
				injected.push(skillName);
				this.injectedSkills.add(skillName);
			}
		}

		// Persist tracking
		this.saveTracking();

		return {
			injectedSkills: injected,
			content: contents.join("\n\n---\n\n"),
		};
	}

	/**
	 * Register additional intent mappings (e.g. from plugins).
	 */
	addIntentMappings(mappings: IntentMapping[]): void {
		this.intentMap.push(...mappings);
	}

	/**
	 * Reset session tracking (called on new session).
	 */
	resetSession(): void {
		this.injectedSkills.clear();
		this.saveTracking();
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	private loadSkillContent(skillName: string): string | null {
		const skillPaths = [
			path.join(this.projectRoot, ".orqa", "process", "skills", skillName, "SKILL.md"),
			// Also check team/skills for app-specific layout
			path.join(this.projectRoot, ".orqa", "team", "skills", skillName, "SKILL.md"),
		];

		for (const skillPath of skillPaths) {
			if (fs.existsSync(skillPath)) {
				const content = fs.readFileSync(skillPath, "utf-8");
				// Strip YAML frontmatter before injecting
				return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
			}
		}

		return null;
	}

	private loadTracking(): Set<string> {
		try {
			if (fs.existsSync(this.trackingFile)) {
				const data = JSON.parse(fs.readFileSync(this.trackingFile, "utf-8"));
				return new Set(Array.isArray(data) ? data : []);
			}
		} catch {
			// Ignore
		}
		return new Set();
	}

	private saveTracking(): void {
		try {
			const dir = path.dirname(this.trackingFile);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(
				this.trackingFile,
				JSON.stringify([...this.injectedSkills]),
				"utf-8",
			);
		} catch {
			// Non-critical — tracking is best-effort
		}
	}
}
