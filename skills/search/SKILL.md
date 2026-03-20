---
name: search
description: "Unified search across the project via MCP tools. Three modes: regex for exact patterns, semantic for natural language, research for compound queries. Replaces chunkhound, orqa-code-search, and orqa-native-search. Use when: searching before creating new code, finding callers before refactoring, understanding how a system works end-to-end."
user-invocable: true
---

# Search

Three MCP tools for structured search. Works for code and non-code projects.

## Tool Selection

| Situation | Tool |
|-----------|------|
| Know the exact function or class name | `search_regex` |
| Know the exact route or command name | `search_regex` |
| Need all callers before refactoring | `search_regex` |
| Know the concept, not the file | `search_semantic` |
| About to create something — check it doesn't exist | `search_semantic` |
| Need to understand how a system works end-to-end | `search_research` |
| Implementing a feature touching 3+ files | `search_research` (mandatory first) |
| Debugging a cross-layer issue | `search_research` |

## search_regex

Pattern-based search across indexed content.

```
search_regex({ pattern: "build_artifact_graph", limit: 20 })
search_regex({ pattern: "pub fn.*Result", path_filter: "src/domain" })
```

## search_semantic

Natural language search using ONNX embeddings (requires model loaded).

```
search_semantic({ query: "how does the artifact validation pipeline work?", limit: 10 })
search_semantic({ query: "error handling in IPC commands" })
```

## search_research

Compound query for deep understanding:
1. Semantic search for relevant chunks
2. Symbol extraction from results
3. Regex follow-up for definitions and callers
4. Assembled context with primary + related results

```
search_research({ question: "how does the plugin system discover and load plugins?" })
```

## search_status

Check index health:

```
search_status()
→ { is_indexed: true, chunk_count: 4521, has_embeddings: true }
```

## When to Use

- **Before writing new code**: always search first to avoid duplicating existing functionality
- **Before refactoring**: find all callers with regex before changing a function
- **When debugging**: use research to understand the full call chain
- **When planning**: use semantic search to find related patterns and prior art
