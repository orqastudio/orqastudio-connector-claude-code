/**
 * Prompt Injector — classifies user intent and injects relevant skills.
 *
 * This is the TypeScript equivalent of the prompt-injector.mjs hook script,
 * extracted for reuse by other consumers.
 *
 * Knowledge files are markdown artifacts in .orqa/process/knowledge/<name>/KNOW.md.
 * The injector maps user intent keywords to knowledge names, deduplicates
 * across a session, and returns the knowledge content for prompt injection.
 */
import * as fs from "node:fs";
import * as path from "node:path";
/** Default intent → knowledge mappings. Can be extended by plugins.
 *  Knowledge names must match directory names under .orqa/process/knowledge/ or app/.orqa/process/knowledge/. */
const DEFAULT_INTENT_MAP = [
    { keywords: ["ipc", "invoke", "tauri", "command"], skills: ["orqa-ipc-patterns", "orqa-error-composition"] },
    { keywords: ["store", "state", "svelte-store", "reactive", "rune"], skills: ["orqa-store-patterns", "orqa-store-orchestration"] },
    { keywords: ["component", "svelte", "ui", "widget", "view"], skills: ["svelte5-best-practices", "tailwind-design-system"] },
    { keywords: ["domain", "business", "model", "entity"], skills: ["orqa-domain-services", "orqa-error-composition"] },
    { keywords: ["repository", "repo", "database", "sqlite"], skills: ["orqa-repository-pattern"] },
    { keywords: ["stream", "sidecar", "ndjson", "provider"], skills: ["orqa-streaming"] },
    { keywords: ["plan", "design", "architect", "approach"], skills: ["planning", "systems-thinking"] },
    { keywords: ["review", "pr", "pull request", "check"], skills: ["orqa-governance"] },
    { keywords: ["debug", "fix", "error", "bug", "crash"], skills: ["diagnostic-methodology", "systems-thinking"] },
    { keywords: ["test", "spec", "assert", "verify"], skills: ["orqa-testing"] },
    { keywords: ["search", "find", "embed", "semantic"], skills: ["orqa-code-search"] },
    { keywords: ["governance", "rule", "enforce", "compliance"], skills: ["orqa-governance", "orqa-documentation"] },
    { keywords: ["refactor", "rename", "extract", "clean"], skills: ["restructuring-methodology", "systems-thinking"] },
    { keywords: ["log", "logging", "logger", "tracing"], skills: ["centralized-logging"] },
];
export class PromptInjector {
    projectRoot;
    injectedSkills;
    intentMap;
    trackingFile;
    constructor(projectRoot) {
        this.projectRoot = projectRoot ?? process.cwd();
        this.intentMap = DEFAULT_INTENT_MAP;
        this.trackingFile = path.join(this.projectRoot, ".orqa", "tmp", ".injected-skills.json");
        this.injectedSkills = this.loadTracking();
    }
    /**
     * Classify user intent and inject matching skills.
     *
     * @param userMessage - The user's prompt message
     * @returns Skills to inject (empty if all already injected this session)
     */
    inject(userMessage) {
        const lower = userMessage.toLowerCase();
        const matchedSkills = new Set();
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
        const contents = [];
        const injected = [];
        for (const skillName of matchedSkills) {
            const content = this.loadKnowledgeContent(skillName);
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
    addIntentMappings(mappings) {
        this.intentMap.push(...mappings);
    }
    /**
     * Reset session tracking (called on new session).
     */
    resetSession() {
        this.injectedSkills.clear();
        this.saveTracking();
    }
    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------
    loadKnowledgeContent(skillName) {
        const candidates = [
            // Project-level knowledge (primary)
            path.join(this.projectRoot, ".orqa", "process", "knowledge", skillName, "KNOW.md"),
            path.join(this.projectRoot, ".orqa", "process", "knowledge", `${skillName}.md`),
            // App-level knowledge (monorepo)
            path.join(this.projectRoot, "app", ".orqa", "process", "knowledge", skillName, "KNOW.md"),
            path.join(this.projectRoot, "app", ".orqa", "process", "knowledge", `${skillName}.md`),
        ];
        for (const candidatePath of candidates) {
            if (fs.existsSync(candidatePath)) {
                const content = fs.readFileSync(candidatePath, "utf-8");
                // Strip YAML frontmatter before injecting
                return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
            }
        }
        return null;
    }
    loadTracking() {
        try {
            if (fs.existsSync(this.trackingFile)) {
                const data = JSON.parse(fs.readFileSync(this.trackingFile, "utf-8"));
                return new Set(Array.isArray(data) ? data : []);
            }
        }
        catch {
            // Ignore
        }
        return new Set();
    }
    saveTracking() {
        try {
            const dir = path.dirname(this.trackingFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.trackingFile, JSON.stringify([...this.injectedSkills]), "utf-8");
        }
        catch {
            // Non-critical — tracking is best-effort
        }
    }
}
//# sourceMappingURL=prompt-injector.js.map