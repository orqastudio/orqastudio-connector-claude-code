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
export interface IntentMapping {
    keywords: string[];
    skills: string[];
}
export interface InjectionResult {
    injectedSkills: string[];
    content: string;
}
export declare class PromptInjector {
    private projectRoot;
    private injectedSkills;
    private intentMap;
    private trackingFile;
    constructor(projectRoot?: string);
    /**
     * Classify user intent and inject matching skills.
     *
     * @param userMessage - The user's prompt message
     * @returns Skills to inject (empty if all already injected this session)
     */
    inject(userMessage: string): InjectionResult;
    /**
     * Register additional intent mappings (e.g. from plugins).
     */
    addIntentMappings(mappings: IntentMapping[]): void;
    /**
     * Reset session tracking (called on new session).
     */
    resetSession(): void;
    private loadKnowledgeContent;
    private loadTracking;
    private saveTracking;
}
//# sourceMappingURL=prompt-injector.d.ts.map