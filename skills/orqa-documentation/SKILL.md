---
name: orqa-documentation
description: "OrqaStudio documentation authoring conventions: internal link format, cross-referencing between artifacts, markdown rendering pipeline, and content structure patterns. Use when: Writing or editing any markdown content in .orqa/ — documentation pages, artifact body text, research documents, epic designs, rule descriptions, README files."
user-invocable: true
---

How to write documentation and artifact content in OrqaStudio. Covers the internal link format, cross-referencing conventions, markdown rendering pipeline, and content structure patterns.

## Internal Link Format (MANDATORY)

All cross-references between artifacts use **artifact IDs as markdown links**. The app's markdown renderer detects these and renders them as navigable artifact links.

### Format

```markdown
[Display Text](ARTIFACT-ID)
```

### Examples

```markdown
See [RULE-7b770593](RULE-7b770593) for artifact lifecycle rules.
This was decided in [AD-2aa4d6db](AD-2aa4d6db).
Refer to the Streaming Pipeline for the full architecture.
The [Frontend Research](RES-df5560cb) covers component library selection.
```

### Artifact ID Prefixes

Every artifact type has a typed ID prefix:

| Prefix | Type | Location |
|--------|------|----------|
| `DOC-NNN` | Documentation page | `.orqa/documentation/**/*.md` |
| `EPIC-NNN` | Epic | `.orqa/delivery/epics/` |
| `TASK-NNN` | Task | `.orqa/delivery/tasks/` |
| `MS-NNN` | Milestone | `.orqa/delivery/milestones/` |
| `IDEA-NNN` | Idea | `.orqa/delivery/ideas/` |
| `RES-NNN` | Research | `.orqa/delivery/research/` |
| `PILLAR-NNN` | Pillar | `.orqa/process/pillars/` |
| `AD-NNN` | Architecture Decision | `.orqa/process/decisions/` |
| `RULE-NNN` | Rule | `.orqa/process/rules/` |
| `IMPL-NNN` | Lesson | `.orqa/process/lessons/` |
| `SKILL-NNN` | Skill | `.orqa/process/skills/` |
| `AGENT-NNN` | Agent | `.orqa/process/agents/` |

### How It Works

The `MarkdownRenderer` component passes a custom `MarkdownLink` renderer to SvelteMarkdown. When the renderer encounters a link:

1. **Artifact ID href** (matches `/^(EPIC|TASK|AD|MS|IDEA|IMPL|RES|PILLAR|RULE|DOC|SKILL|AGENT)-\d{3,}$/`) — renders an `ArtifactLink` component that resolves the ID via the artifact graph and navigates on click
2. **External URL** (`http://` or `https://`) — opens in the user's default browser via Tauri shell plugin
3. **Anything else** — renders as a plain `<a>` tag (likely broken — fix it)

See [RULE-2f7b6a31](RULE-2f7b6a31) for the full artifact link format constraint and enforcement.

### FORBIDDEN Link Formats

```markdown
<!-- WRONG: web-style paths — these don't resolve in the app -->
[Governance](/product/governance)
[Frontend Research](/research/frontend)

<!-- WRONG: file paths — use artifact IDs instead -->
[Governance](.orqa/documentation/about/governance.md)
[Governance](../about/governance.md)

<!-- WRONG: bare IDs without markdown link syntax — won't be detected -->
See RULE-7b770593 for details.

<!-- CORRECT -->
See [RULE-7b770593](RULE-7b770593) for details.
Product Governance
[Frontend Research](RES-df5560cb)
```

### Finding an Artifact's ID

Every artifact has an `id:` field in its YAML frontmatter. To find the ID for a documentation page:

```bash
grep "^id:" .orqa/documentation/about/governance.md
# id: DOC-1bc9d0b9
```

## External Links

Links to external websites use standard markdown and open in the user's default browser:

```markdown
[Tauri v2 docs](https://v2.tauri.app/)
```

## Content Structure Patterns

### Documentation Pages

Documentation pages in `.orqa/documentation/` describe the **current target state**. They are deleted and replaced when outdated — git history preserves old versions.

Standard structure:

```markdown
---
id: DOC-NNN
title: Page Title
description: Brief description for nav sidebar.
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
  - target: DOC-4b4fbc0f
    type: synchronised-with

---

Opening paragraph explaining what this page covers.

## Main Sections

Content organized by topic.

## Pillar Alignment

| Pillar | Alignment |
|--------|-----------|
| Clarity Through Structure | How this page serves this pillar, or N/A |
| Learning Through Reflection | How this page serves this pillar, or N/A |

## Related Documents

- [Related Doc](DOC-NNN) — brief description
- [Related Decision](AD-NNN) — brief description
```

### Artifact Body Text

Epic bodies contain implementation designs. Research bodies contain investigation findings. Rule bodies contain enforcement details. All follow the same link conventions.

### Related Documents Sections

Most documentation pages end with a "Related Documents" section. Use artifact ID links:

```markdown
## Related Documents

- IPC Command Catalog — Full parameter and return type documentation
- Architecture Decisions — [AD-a334623b](AD-a334623b) (IPC boundary), [AD-1ad08e5f](AD-1ad08e5f) (errors)
- MVP Specification — Features F-001 through F-013
```

### Inline References

When referencing artifacts inline, always use the link format:

```markdown
Per [RULE-7b770593](RULE-7b770593), epics must have a milestone reference.
This was investigated in [RES-df5560cb](RES-df5560cb) and decided in [AD-afc78f6e](AD-afc78f6e).
The Coding Standards require 80%+ test coverage.
```

## Frontmatter Conventions

- Every `.md` file in `.orqa/` has YAML frontmatter between `---` delimiters
- The `id:` field is the artifact's unique identifier — never modify after creation
- The `title:` field is used as the display label in the app's navigation
- Frontmatter must validate against the `schema.json` in the artifact's directory
- IDs auto-increment per type — scan existing files to determine the next ID
- **Field ordering is enforced** — frontmatter fields must appear in the order defined by `propertyOrder` in `schema.json`. Wrong order blocks the commit. The most common pattern across artifact types is: `id, title, description, status, created, updated` followed by type-specific fields. Always check the specific `schema.json` before writing frontmatter. See [SKILL-4368d782](SKILL-4368d782) for remediation patterns.

## What NOT to Document

- **Migration guides or deprecation notices** — this project is in alpha; docs describe current state only
- **"Moved to" redirect stubs** — delete old pages, update cross-references
- **TODO comments in documentation** — if something is incomplete, track it as a task
- **Emoji in headings or body** — use Lucide icon names in frontmatter only
