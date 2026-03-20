---
name: orqa-governance
description: "How the .orqa/ governance structure works: artifact layering, config-driven discovery, relationship vocabulary, status lifecycle, lesson pipeline, and directory conventions. Use when: creating or maintaining governance artifacts, understanding how the three artifact layers merge, or working with the relationship graph."
user-invocable: true
---

Governance in OrqaStudio is the practice of making decisions, rules, lessons, and knowledge visible as first-class artifacts on a graph. Every governance artifact has typed relationships to other artifacts, a status drawn from a universal lifecycle, and frontmatter that machines can parse and humans can read. The `.orqa/` directory is the physical home for these artifacts, but the *meaning* of the structure — what types exist, how they connect, what statuses are valid — is defined entirely by configuration, not by convention or hardcoded logic.

## .orqa/ Directory Structure

Every OrqaStudio project uses the same canonical directory layout:

```
.orqa/
  project.json                # Project config — artifact navigation, project relationships
  principles/                 # Foundational artifacts (app-required layer)
    pillars/                  #   PILLAR-NNN.md — guiding principles
    vision/                   #   Vision statement
    personas/                 #   PERSONA-NNN.md — target user profiles
    grounding/                #   Grounding documents
  discovery/                  # Exploration artifacts
    ideas/                    #   IDEA-NNN.md — captured thoughts
    research/                 #   RES-NNN.md — investigations, spikes, designs
    wireframes/               #   Visual explorations
  delivery/                   # Execution artifacts
    milestones/               #   MS-NNN.md — time-boxed goals
    epics/                    #   EPIC-NNN.md — bodies of work (contain implementation design)
    tasks/                    #   TASK-NNN.md — individual work items
  process/                    # Governance artifacts
    decisions/                #   AD-NNN.md — architecture decisions
    lessons/                  #   IMPL-NNN.md — implementation lessons
    rules/                    #   RULE-NNN.md — enforceable standards
    agents/                   #   AGENT-NNN/ — agent definitions
    skills/                   #   skill-name/ — skill directories (each has SKILL.md)
  documentation/              # Human-readable docs
    platform/                 #   Platform documentation (ships with app)
    project/                  #   Project-specific documentation
```

## Three Artifact Homes

Artifacts live in one of three places, each with a distinct role:

### 1. Core (ships with the app — `app/.orqa/`)

Platform-level artifacts that define how OrqaStudio itself works. These are immutable by projects.

- `project.json` — canonical delivery hierarchy, project-level relationship types, status model
- `documentation/platform/` — platform documentation
- `process/agents/` — core agents (orchestrator, planner, implementer, etc.)
- `process/rules/` — core rules (`layer: core`)
- `process/skills/` — core and setup skills (`layer: core` or `setup`)

### 2. Plugins (registered via `orqa-plugin.json`)

Plugins extend the platform by registering new artifact types, relationship types, or navigation sections. Each plugin declares its contributions in its `orqa-plugin.json` manifest. Plugin-provided types and relationships merge into the runtime configuration alongside platform and project config.

### 3. Project (user's workspace — `.orqa/`)

Everything the user creates during a project's lifecycle:

- `principles/` — pillars, vision, personas, grounding
- `discovery/` — ideas, research, wireframes
- `delivery/` — milestones, epics, tasks
- `process/` — decisions, lessons, project-layer rules and skills
- `documentation/project/` — project-specific docs

## How Artifacts Are Discovered

Artifact discovery is entirely config-driven. Nothing is inferred from filesystem paths or naming conventions.

**`core.json`** (`libs/types/src/platform/core.json`) is the single source of truth for:
- Platform artifact types (key, label, icon, ID prefix)
- Platform relationship types (forward/inverse keys, type constraints, semantic categories)
- Validation constraints (required relationships, minimum counts)

**`project.json`** (in each `.orqa/` root) defines:
- Navigation sections — which directories map to which artifact views
- Project-level relationship types (e.g. `depends-on`/`depended-on-by`)
- Delivery hierarchy configuration

**`orqa-plugin.json`** (in each plugin) can register:
- Additional artifact types
- Additional relationship types
- Additional navigation sections

### Config Merging

At runtime, all three layers merge:

```
platform defaults (core.json)
  → project config (project.json)
    → plugin provides (orqa-plugin.json per plugin)
```

The scanner reads the merged config and walks exactly those paths. It does not guess or infer. Every `path` in the config must resolve to an actual directory on disk.

## Relationship Vocabulary

All artifact connections use the `relationships` frontmatter array with `target` and `type` fields. The canonical vocabulary is defined in `core.json` — never hardcode relationship keys in logic.

Relationships are grouped into semantic categories:

| Category | What it means | Example relationships |
|----------|---------------|----------------------|
| **foundation** | Anchoring to vision, pillars, personas | `upholds`, `grounded`, `benefits`, `revises` |
| **lineage** | One artifact becoming or spawning another | `crystallises`, `spawns`, `merged-into` |
| **governance** | Decisions and rules directing behaviour | `drives`, `governs`, `enforces`, `codifies` |
| **knowledge-flow** | Knowledge flowing between artifacts | `informs`, `teaches`, `guides`, `cautions`, `documents` |
| **observation** | Agents monitoring and using capabilities | `observes`, `employs` |
| **synchronisation** | Paired content kept in sync | `synchronised-with` |

Every relationship in `core.json` declares:
- **`from`/`to` type constraints** — which artifact types may appear on each end
- **`semantic` category** — enables queries like "show all governance relationships" without naming specific keys
- **`constraints`** (optional) — whether the relationship is required, minimum count

Enforcement checks query by semantics, not by key name. For example, "does this idea have a foundation relationship?" rather than `if rel === "grounded"`.

### Bidirectionality

Every forward relationship has a declared inverse. When you create a forward edge, the inverse must also exist on the target artifact. The integrity scanner detects missing inverses.

### Type Constraints

Type constraints from `core.json` are enforced at validation time:
- `enforces` — only FROM rule, only TO decision
- `grounded`/`grounded-by` — only FROM idea, only TO pillar
- `drives`/`driven-by` — only FROM decision, only TO epic
- `observes`/`observed-by` — only FROM agent

Project-level relationships (e.g. `depends-on`/`depended-on-by`) are defined in `project.json`, not `core.json`.

## Artifact Lifecycle

### Status Model

The 12 canonical statuses are defined in `core.json` and `project.json`. They form a universal progression:

```
captured → exploring → ready → prioritised → active → hold / blocked
    → review → completed → surpassed / archived / recurring
```

Not every artifact type uses every status. The valid transitions for each type are defined in configuration, not hardcoded.

Status transitions can be graph-driven: when all nodes connected via `delivers` relationships reach `completed`, the parent node is proposed for `review`.

### Lesson Pipeline

Lessons follow a structured promotion path:

```
Lesson documented (.orqa/process/lessons/IMPL-NNN.md)
    → Recurrence tracked (frontmatter count field incremented)
    → Promoted at threshold (recurrence >= 2)
    → Becomes rule or coding standard addition
    → Enforcement verified
```

Lessons are never deleted. When a lesson is codified into a rule, the `codifies`/`codified-by` relationship makes the lineage traceable.

### Historical Preservation

- **Documentation** (`.orqa/documentation/`) — DELETE when outdated, replace with current
- **Research, tasks, decisions** — PRESERVE, mark `status: surpassed` with a lineage relationship (e.g. `evolves-into`, `merged-into`) pointing to the successor
- **Never delete** research, task, or decision files — they are historical records of reasoning

## Config-Driven Artifact Scanning

The `artifacts` array in `project.json` is the single source of truth for what gets scanned and displayed. The scanner does NOT guess — it reads config and scans exactly those paths.

```jsonc
"artifacts": [
  // Direct type — scans a directory (flat or tree)
  { "key": "docs", "label": "Documentation", "icon": "file-text", "path": ".orqa/documentation" },
  // Group — renders as expandable group, each child scanned independently
  { "key": "planning", "label": "Planning", "icon": "target",
    "children": [
      { "key": "ideas", "label": "Ideas", "path": ".orqa/discovery/ideas" },
      { "key": "research", "label": "Research", "path": ".orqa/discovery/research" },
      { "key": "epics", "label": "Epics", "path": ".orqa/delivery/epics" }
    ]
  }
]
```

Scanning behaviour:
1. **Flat directories** — scans `.md` files directly
2. **Tree directories** — recurses into subdirectories, creating folder nodes with children
3. **Frontmatter extraction** — every `.md` file gets YAML frontmatter parsed for `title` and `description`
4. **Label priority**: frontmatter `title` > humanised filename > raw filename
5. **Artifact IDs** (all-caps like `EPIC-e045ab6d`, `AD-69072318`) are preserved as-is, not humanised
6. **README.md** is navigation metadata, skipped as a browsable artifact at all levels
7. **Hidden entries** (`.` or `_` prefix) skipped
8. **Empty directories** omitted from tree

**Critical rule:** every `path` in the config must resolve to an actual directory. Moving files on disk requires updating the config.

## Directory README Format

Every artifact directory and group directory has a `README.md` that provides navigation metadata for the UI. READMEs are NOT browsable artifacts — they are skipped by the scanner.

### Group README (parent directories)

```yaml
---
role: group
label: "Planning"
description: "Strategic planning artifacts."
icon: "clipboard-list"
sort: 2
---

Body text describing what this group contains.
```

### Artifact README (leaf directories)

```yaml
---
role: artifacts
label: "Epics"
description: "Trackable work units that group related tasks together."
icon: "layers"
sort: 2
  - target: DOC-a1b2c3d4
    type: synchronised-with

---

# Epics

Description, lifecycle diagram, key concepts, and Related section.
```

### Fields

| Field | Required | Values | Purpose |
|-------|----------|--------|---------|
| `role` | Yes | `group` or `artifacts` | Group = parent with children, artifacts = scannable leaf directory |
| `label` | Yes | string | Display name in nav sidebar |
| `description` | Yes | string | Tooltip/subtitle in nav |
| `icon` | Yes | string | Lucide icon name (e.g., `layers`, `target`, `compass`) |
| `sort` | Yes | integer | Display order within parent (0 = first) |

### Body Structure (artifact READMEs)

1. **Heading** matching the label
2. **One-paragraph description** of what this artifact type is
3. **Lifecycle** section with status flow diagram
4. **Key concepts** — what makes a good artifact of this type, gates, relationships
5. **Related** section linking to connected artifact types

### When to Create/Update a README

- **New artifact directory**: create a README before adding any artifacts
- **New artifact type registered in project.json**: create matching README
- **Renaming or moving a directory**: update the README's label and description
- **Changing the artifact's lifecycle or schema**: update the README to match

## Pillar Alignment

Active pillars are defined in `.orqa/principles/pillars/PILLAR-NNN.md`. Every governance artifact and feature must serve at least one active pillar. To evaluate alignment, read each pillar's `gate` questions and check if the work can answer "yes" to at least one question from at least one pillar.

Pillars are equal in importance — when they conflict, flag the conflict to the user and ask for direction.

Features that serve no active pillar are out of scope.
