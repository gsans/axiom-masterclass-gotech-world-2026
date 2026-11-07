# AGENTS.md

## Principles (Slow Engineering)
* **01 AI is Infrastructure**: Propose artifacts; humans approve.
* **03 Rules in Code**: Enforce constraints via TypeScript types, schemas, and exit predicates.
* **04 Evidence First**: Pair execution with independent verification (`DecisionCard`).
* **06 Fail Soft**: Cap all `LoopAgent` iterations (`maxIterations <= 3`).
* **10 Every Input is a Stranger**: Validate all MCP and A2A payloads.

## Stack
* Node.js v22+, strict TypeScript, `@google/adk`, `@modelcontextprotocol/sdk`.
* Models: `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-4-argon`.
