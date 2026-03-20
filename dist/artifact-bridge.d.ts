/**
 * Artifact Bridge — maps the .claude/ directory to OrqaStudio's artifact graph.
 *
 * The .claude/ directory is a set of symlinks into .orqa/, so that:
 * - CLAUDE.md → .orqa/process/agents/orchestrator.md (the orchestrator agent)
 * - rules/   → .orqa/process/rules/ (governance rules with enforcement YAML)
 * - agents/  → .orqa/process/agents/ (all agent definitions)
 *
 * This bridge:
 * 1. Creates/maintains the symlinks on session start
 * 2. Resolves .claude/ paths to their .orqa/ artifact counterparts
 * 3. Provides access to agent definitions, skills, and rules as typed artifacts
 * 4. Enables the same process workflow in Claude Code as in the app
 */
export interface BridgeMapping {
    /** .claude/ relative path. */
    claudePath: string;
    /** .orqa/ relative path. */
    orqaPath: string;
    /** Whether this is a directory (true) or file (false). */
    isDirectory: boolean;
    /** Description of what this mapping represents. */
    description: string;
}
export declare class ArtifactBridge {
    private projectRoot;
    private claudeDir;
    private orqaDir;
    constructor(projectRoot?: string);
    /** Get the canonical bridge mappings. */
    get mappings(): BridgeMapping[];
    /** Check if the OrqaStudio artifact directory exists. */
    hasOrqaDir(): boolean;
    /** Check if the .claude/ directory exists. */
    hasClaudeDir(): boolean;
    /**
     * Create or update all symlinks from .claude/ to .orqa/.
     *
     * This is called by the session-start hook. It ensures the .claude/
     * directory structure mirrors the corresponding .orqa/ artifacts.
     */
    setupSymlinks(): {
        created: string[];
        skipped: string[];
        errors: string[];
    };
    /**
     * Resolve a .claude/ path to its .orqa/ artifact path.
     */
    resolveToOrqa(claudeRelativePath: string): string | null;
    /**
     * List all agents from the .orqa/ agents directory.
     */
    listAgents(): Array<{
        id: string;
        name: string;
        path: string;
    }>;
    /**
     * List all skills from the .orqa/ skills directory.
     */
    listSkills(): Array<{
        id: string;
        name: string;
        path: string;
    }>;
    /**
     * List all rules from the .orqa/ rules directory.
     */
    listRules(): Array<{
        id: string;
        name: string;
        path: string;
        hasEnforcement: boolean;
    }>;
    /**
     * Get the status of the bridge — what's linked, what's missing, what's broken.
     */
    getStatus(): {
        isOrqaProject: boolean;
        mappings: Array<BridgeMapping & {
            status: "linked" | "missing-source" | "real-file" | "broken" | "not-created";
        }>;
    };
    private createSymlink;
    private listArtifacts;
    private parseArtifactHeader;
}
//# sourceMappingURL=artifact-bridge.d.ts.map