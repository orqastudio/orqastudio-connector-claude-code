---
id: KNOW-82ceb1bd
title: Project Inference
description: |
  Reads a project's folder structure and files to infer its characteristics:
  languages, frameworks, build tools, existing governance, and project type.
  Produces a structured project profile that drives setup decisions.
  Use when: Setting up OrqaStudio on an existing project, or detecting
  project characteristics for skill/rule selection.
status: active
created: 2026-03-01
updated: 2026-03-10
category: tool
version: 1.0.0
user-invocable: true
relationships:
  - target: DOC-a1b2c3d4
    type: synchronised-with
---

> **Forward-looking:** This skill will be activated when project initialisation is implemented. See [EPIC-be023ed2](EPIC-be023ed2) for context.

Analyses a project's folder structure and configuration files to infer its characteristics. The output is a structured project profile that other setup skills use to make decisions.

## Detection Categories

### 1. Languages

| Signal | Language |
|--------|----------|
| `*.rs`, `Cargo.toml` | Rust |
| `*.ts`, `*.tsx`, `tsconfig.json` | TypeScript |
| `*.js`, `*.jsx`, `package.json` | JavaScript |
| `*.py`, `pyproject.toml`, `setup.py` | Python |
| `*.go`, `go.mod` | Go |
| `*.java`, `pom.xml`, `build.gradle` | Java |
| `*.cs`, `*.csproj` | C# |
| `*.swift`, `Package.swift` | Swift |

### 2. Frameworks

| Signal | Framework |
|--------|-----------|
| `svelte.config.js`, `*.svelte` | Svelte |
| `next.config.*`, `app/layout.tsx` | Next.js |
| `nuxt.config.*` | Nuxt |
| `angular.json` | Angular |
| `tauri.conf.json`, `backend/src-tauri/` | Tauri |
| `electron-builder.*`, `electron/` | Electron |
| `Cargo.toml` with `actix-web`/`axum`/`rocket` | Rust web framework |
| `django/`, `manage.py` | Django |
| `Gemfile` with `rails` | Ruby on Rails |

### 3. Build Tools

| Signal | Tool |
|--------|------|
| `Makefile` | Make |
| `package.json` with `scripts` | npm/yarn/bun scripts |
| `Cargo.toml` | Cargo |
| `Dockerfile`, `docker-compose.yml` | Docker |
| `.github/workflows/` | GitHub Actions |
| `Jenkinsfile` | Jenkins |

### 4. Existing Governance

| Signal | What It Means |
|--------|---------------|
| `.claude/`, `CLAUDE.md` | Claude Code configuration exists |
| `.cursor/`, `.cursorrules` | Cursor configuration exists |
| `.github/copilot-instructions.md` | Copilot configuration exists |
| `.aider*` | Aider configuration exists |
| `.orqa/` | OrqaStudio already initialised |
| `AGENTS.md` | Agent instructions exist |
| `CONVENTIONS.md`, `CONTRIBUTING.md` | Project conventions documented |
| `.editorconfig` | Editor configuration exists |
| `.pre-commit-config.yaml` | Pre-commit hooks exist |

### 5. Project Type Signals

| Signals | Likely Type |
|---------|-------------|
| `backend/src-tauri/` + `ui/` or `src/` + `Cargo.toml` + `package.json` | Desktop app (Tauri) |
| `package.json` + framework config + no backend | Frontend web app |
| `Cargo.toml` + no frontend | Rust library/service |
| `package.json` + `server/` or `api/` | Full-stack web app |
| No code files, mostly `.md` | Documentation/knowledge project |
| Mixed languages, no clear structure | Monorepo or multi-project |

## Project Profile Output

The inference produces a structured profile:

```yaml
project:
  name: "my-project"
  type: "desktop-app"  # or web-app, library, service, documentation, etc.
  languages: [rust, typescript, svelte]
  frameworks: [tauri-v2, svelte-5]
  build_tools: [make, cargo, npm]
  existing_governance:
    claude_code: true
    cursor: false
    copilot: false
    aider: false
    orqa: false
  detected_patterns:
    has_tests: true
    has_ci: true
    has_linting: true
    has_pre_commit: true
  recommendations:
    project_type_skill: "project-type-software"
    migration_needed: true  # if existing governance detected
    skills_to_load: [rust-async-patterns, svelte5-best-practices, tauri-v2]
```

## Inference Procedure

1. Scan root directory for configuration files (package.json, Cargo.toml, etc.)
2. Scan first two levels of subdirectories for language/framework signals
3. Check for existing governance configurations
4. Classify the project type based on combined signals
5. Generate the project profile
6. Recommend the appropriate project type skill and any migrations

## Critical Rules

- NEVER modify any project files during inference — this is READ-ONLY
- Report confidence levels: high (multiple confirming signals), medium (some signals), low (single signal)
- If signals conflict, report all possibilities rather than guessing
- Always check for existing OrqaStudio setup before recommending fresh initialisation
