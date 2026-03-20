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
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
/** The canonical mappings between .claude/ and .orqa/ */
const BRIDGE_MAPPINGS = [
    {
        claudePath: "CLAUDE.md",
        orqaPath: ".orqa/process/agents/orchestrator.md",
        isDirectory: false,
        description: "Orchestrator agent definition",
    },
    {
        claudePath: "rules",
        orqaPath: ".orqa/process/rules",
        isDirectory: true,
        description: "Governance rules with enforcement arrays",
    },
    {
        claudePath: "agents",
        orqaPath: ".orqa/process/agents",
        isDirectory: true,
        description: "Agent role definitions (orchestrator, planner, implementer, etc.)",
    },
];
export class ArtifactBridge {
    projectRoot;
    claudeDir;
    orqaDir;
    constructor(projectRoot) {
        this.projectRoot = projectRoot ?? process.cwd();
        this.claudeDir = path.join(this.projectRoot, ".claude");
        this.orqaDir = path.join(this.projectRoot, ".orqa");
    }
    /** Get the canonical bridge mappings. */
    get mappings() {
        return BRIDGE_MAPPINGS;
    }
    /** Check if the OrqaStudio artifact directory exists. */
    hasOrqaDir() {
        return fs.existsSync(this.orqaDir);
    }
    /** Check if the .claude/ directory exists. */
    hasClaudeDir() {
        return fs.existsSync(this.claudeDir);
    }
    /**
     * Create or update all symlinks from .claude/ to .orqa/.
     *
     * This is called by the session-start hook. It ensures the .claude/
     * directory structure mirrors the corresponding .orqa/ artifacts.
     */
    setupSymlinks() {
        const created = [];
        const skipped = [];
        const errors = [];
        if (!this.hasOrqaDir()) {
            errors.push("No .orqa/ directory found — not an OrqaStudio project.");
            return { created, skipped, errors };
        }
        // Ensure .claude/ exists
        if (!fs.existsSync(this.claudeDir)) {
            fs.mkdirSync(this.claudeDir, { recursive: true });
        }
        for (const mapping of BRIDGE_MAPPINGS) {
            const claudeTarget = path.join(this.claudeDir, mapping.claudePath);
            const orqaSource = path.join(this.projectRoot, mapping.orqaPath);
            // Skip if the orqa source doesn't exist
            if (!fs.existsSync(orqaSource)) {
                skipped.push(`${mapping.claudePath} (source not found: ${mapping.orqaPath})`);
                continue;
            }
            // Skip if it's already a valid symlink
            try {
                if (fs.lstatSync(claudeTarget).isSymbolicLink()) {
                    const existingTarget = fs.readlinkSync(claudeTarget);
                    const expectedTarget = path.relative(path.dirname(claudeTarget), orqaSource);
                    if (existingTarget === expectedTarget || existingTarget === orqaSource) {
                        skipped.push(`${mapping.claudePath} (already linked)`);
                        continue;
                    }
                    // Wrong target — remove and re-create
                    fs.unlinkSync(claudeTarget);
                }
                else {
                    // Real file/dir exists — skip (don't overwrite user content)
                    skipped.push(`${mapping.claudePath} (real file exists, not overwriting)`);
                    continue;
                }
            }
            catch {
                // Doesn't exist — will create
            }
            // Create symlink
            try {
                const relativePath = path.relative(path.dirname(claudeTarget), orqaSource);
                this.createSymlink(relativePath, claudeTarget, mapping.isDirectory);
                created.push(mapping.claudePath);
            }
            catch (err) {
                errors.push(`${mapping.claudePath}: ${err instanceof Error ? err.message : err}`);
            }
        }
        return { created, skipped, errors };
    }
    /**
     * Resolve a .claude/ path to its .orqa/ artifact path.
     */
    resolveToOrqa(claudeRelativePath) {
        for (const mapping of BRIDGE_MAPPINGS) {
            if (claudeRelativePath === mapping.claudePath) {
                return mapping.orqaPath;
            }
            if (mapping.isDirectory &&
                claudeRelativePath.startsWith(mapping.claudePath + "/")) {
                const suffix = claudeRelativePath.slice(mapping.claudePath.length);
                return mapping.orqaPath + suffix;
            }
        }
        return null;
    }
    /**
     * List all agents from the .orqa/ agents directory.
     */
    listAgents() {
        const agentsDir = path.join(this.orqaDir, "process", "agents");
        if (!fs.existsSync(agentsDir))
            return [];
        return this.listArtifacts(agentsDir);
    }
    /**
     * List all skills from the .orqa/ skills directory.
     */
    listSkills() {
        const skillsDir = path.join(this.orqaDir, "process", "skills");
        if (!fs.existsSync(skillsDir))
            return [];
        return this.listArtifacts(skillsDir);
    }
    /**
     * List all rules from the .orqa/ rules directory.
     */
    listRules() {
        const rulesDir = path.join(this.orqaDir, "process", "rules");
        if (!fs.existsSync(rulesDir))
            return [];
        const results = [];
        for (const entry of fs.readdirSync(rulesDir, { withFileTypes: true })) {
            if (entry.name.endsWith(".md")) {
                const fullPath = path.join(rulesDir, entry.name);
                const content = fs.readFileSync(fullPath, "utf-8");
                const info = this.parseArtifactHeader(fullPath);
                if (info) {
                    results.push({
                        ...info,
                        hasEnforcement: content.includes("enforcement:"),
                    });
                }
            }
        }
        return results;
    }
    /**
     * Get the status of the bridge — what's linked, what's missing, what's broken.
     */
    getStatus() {
        const isOrqaProject = this.hasOrqaDir();
        const mappingStatuses = BRIDGE_MAPPINGS.map((mapping) => {
            const claudeTarget = path.join(this.claudeDir, mapping.claudePath);
            const orqaSource = path.join(this.projectRoot, mapping.orqaPath);
            if (!fs.existsSync(orqaSource)) {
                return { ...mapping, status: "missing-source" };
            }
            try {
                const stat = fs.lstatSync(claudeTarget);
                if (stat.isSymbolicLink()) {
                    return { ...mapping, status: "linked" };
                }
                return { ...mapping, status: "real-file" };
            }
            catch {
                return { ...mapping, status: "not-created" };
            }
        });
        return { isOrqaProject, mappings: mappingStatuses };
    }
    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------
    createSymlink(target, linkPath, isDirectory) {
        const isWindows = process.platform === "win32";
        if (isWindows) {
            // Windows requires admin for symlinks or developer mode
            // Use PowerShell New-Item for proper NTFS symlinks
            const type = isDirectory ? "SymbolicLink" : "SymbolicLink";
            const absTarget = path.resolve(path.dirname(linkPath), target);
            execSync(`powershell -Command "New-Item -ItemType ${type} -Path '${linkPath}' -Target '${absTarget}' -Force"`, { stdio: "pipe" });
        }
        else {
            fs.symlinkSync(target, linkPath, isDirectory ? "dir" : "file");
        }
    }
    listArtifacts(dir) {
        const results = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.endsWith(".md")) {
                const fullPath = path.join(dir, entry.name);
                const info = this.parseArtifactHeader(fullPath);
                if (info)
                    results.push(info);
            }
        }
        return results;
    }
    parseArtifactHeader(filePath) {
        const content = fs.readFileSync(filePath, "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch)
            return null;
        const idMatch = fmMatch[1].match(/^id:\s*(.+)/m);
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)/m);
        const titleMatch = content.match(/^#\s+(.+)/m);
        const id = idMatch?.[1]?.trim();
        if (!id)
            return null;
        const name = nameMatch?.[1]?.trim() ?? titleMatch?.[1]?.trim() ?? id;
        return {
            id,
            name,
            path: path.relative(this.projectRoot, filePath).replace(/\\/g, "/"),
        };
    }
}
//# sourceMappingURL=artifact-bridge.js.map