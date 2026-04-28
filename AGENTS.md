# Agent Instructions for open-pdf

## Status
New project. No code exists yet—only `plan.md` defines the architecture.

## Single Source of Truth
`plan.md` is the authoritative specification. All implementation must follow it exactly. Key constraints:
- Page-level only, stateless, no storage
- Hard switch between PDF and explainer (no hybrid)
- Manual toggle only, no auto-detection
- Explainer Depth levels: Simple | Normal | Technical (locked)
- Rendering via Pretext, streaming tokens
- Brutalist/calm UI: serif for Simple/Normal, sans for Technical

## immediate task
Implement Slice 1 (Toggle + Skeleton) per plan.md §8. No AI, no extraction yet. Build the toggle UI and view switching mechanism.

## tech stack (inferred from plan)
- Browser extension (manifest v3 likely)
- PDF.js for text extraction
- LLM API for transformation
- Pretext for rendering
- Vanilla JS or minimal framework (plan emphasizes simplicity)

## notes
- Do NOT add chat, summaries, annotations, storage, or multi-page features (Anti-Scope §11)
- Performance target: first token <2s, progressive rendering
- Theme (Light/Dark) persisted locally; Level switch re-renders and cancels previous stream
