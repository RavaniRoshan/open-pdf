# PDF Fallback Viewer — Single Source of Truth (Final)

---

## 1. What this is (and is not)

**This is:**

* A fallback PDF viewer
* A **mode-switch system** that changes how a page is read
* A **browser extension** that overlays PDFs
* A **stateless, page-level AI transformation layer**

**This is NOT:**

* A PDF platform
* A chatbot
* A document system
* A multi-feature AI tool

---

## 2. Core UX (locked)

```text id="3r88x8"
User opens any PDF →
  Extension activates →
    User toggles "Explainer Mode" →
      Current page is rewritten into a clearer version
```

Rules:

* Manual toggle only
* Operates per page
* No persistence
* No auto-detection

---

## 3. Core Pipeline (Final)

```text id="gm6nhq"
PDF.js → extract text  
LLM → simplify text  
Pretext → render simplified text smoothly
```

---

## 4. System Principle

```text id="i3qmq5"
Change how the page is read, not what the page contains
```

---

# 5. Extension Behavior (Execution Model)

### Trigger

```text id="6nwr2k"
User opens PDF →
  Extension icon becomes active →
    User clicks → Explainer Mode ON
```

---

### Runtime Behavior

```text id="e6xnt3"
1. Detect PDF context
2. Inject content script
3. Hide native PDF viewer
4. Mount explainer layer
```

---

### Rendering Layers

```text id="7w5q9s"
Layer 1 → PDF (hidden)
Layer 2 → Explainer (active)
```

No hybrid rendering. Hard switch only.

---

# 6. Core Pipeline (Deep Breakdown)

---

## 6.1 Text Extraction — PDF.js

* Extract text from current page
* No layout guarantees

Reality:

* Output is noisy
* Order may be incorrect

Constraints:

* Works best on:

  * single-column PDFs
  * text-heavy documents

Unsupported (v1):

* scanned PDFs
* multi-column layouts
* complex formatting

---

## 6.2 Transformation — LLM

Purpose:

* Rewrite content for clarity

NOT:

* summarization
* compression
* interpretation

---

### Explainer Depth (Locked)

```text id="tsh7n3"
Simple      → intuitive, beginner-friendly  
Normal      → clear, faithful rewrite  
Technical   → precise, structured
```

---

### Prompt Logic

```text id="y38lqg"
Rewrite the content to improve clarity.

Constraints:
- Preserve meaning
- Do not remove key info
- No added commentary
- Match level: {simple | normal | technical}

Content:
{page_text}
```

---

### Principle

```text id="p0o9ef"
Rewrite form, not meaning
```

---

## 6.3 Rendering — Pretext

Purpose:

* Smooth, predictable rendering
* No DOM reflow
* Enable streaming

---

### Rendering Model

```text id="b0aj9v"
Explainer Mode ON:
  hide PDF
  render text via pretext
```

---

### Streaming

```text id="c5h9zq"
LLM output → streamed → rendered token-by-token
```

Effect:

* Immediate feedback
* No blocking

---

# 7. UI System (Explainer Mode)

---

## 7.1 Design Philosophy

```text id="wx2m2c"
Readable > Beautiful  
Fast > Fancy  
Calm > Feature-rich
```

---

## 7.2 Layout

```text id="6pq7b6"
----------------------------------
| Explainer | Level | Theme      |
----------------------------------
|                                |
|        TEXT CONTENT            |
|                                |
----------------------------------
```

---

## 7.3 Typography

* Serif → reading mode (default)
* Sans-serif → technical mode

Rules:

* 60–75 characters per line
* line-height: 1.6–1.8
* left-aligned only
* generous spacing

---

## 7.4 Color System

### Light Mode

* Background: white
* Text: black

### Dark Mode

* Background: near black (#0e0e0e)
* Text: soft white (#eaeaea)

No gradients. No decoration.

---

## 7.5 Brutalist Style (Controlled)

Allowed:

* sharp edges
* minimal UI
* high contrast

Avoid:

* visual noise
* inconsistent spacing
* decorative elements

---

## 7.6 Interactions

### Toggle

* instant (<150ms)
* no animation lag

---

### Streaming

* progressive text rendering
* no layout shifts

---

### Highlighting

* simple selection highlight
* no actions attached

---

### Level Switch

```text id="r7ok9g"
Simple | Normal | Technical
```

* re-renders text
* cancels previous stream

---

### Theme Switch

```text id="l9l9lm"
Light | Dark
```

* instant
* persisted locally

---

# 8. Vertical Slice Execution Plan

---

## Slice 1 — Toggle + Skeleton

* UI toggle
* switch between views

---

## Slice 2 — Text Extraction

* extract page text
* display raw output

---

## Slice 3 — AI Transform (blocking)

* send → receive → render

---

## Slice 4 — Streaming + Pretext

* stream tokens
* smooth rendering

---

## Slice 5 — Level Control

* switch depth

---

## Slice 6 — Failure Handling

* handle empty / errors

---

## Slice 7 — Performance

* cancel requests
* avoid duplication

---

# 9. Constraints (Non-Negotiable)

* Page-level only
* Stateless
* No storage
* No cross-page understanding
* No backend required initially

---

# 10. Known Hard Problems

| Problem    | Strategy               |
| ---------- | ---------------------- |
| messy text | accept v1              |
| latency    | streaming              |
| CORS       | proxy later            |
| large PDFs | single-page processing |

---

# 11. Anti-Scope

Do NOT build:

* chat UI
* summaries panel
* annotations
* storage
* multi-page AI memory

---

# 12. Performance Targets

```text id="phv2k7"
First token: < 2s  
Rendering: progressive  
No UI blocking
```

---

# 13. Product Identity

```text id="9r6k71"
A reading mode that rewrites complexity into clarity
```

---

# 14. Final System Flow

```text id="0ye72s"
User opens PDF →
  enables explainer →
    extract text →
      AI rewrites →
        pretext renders →
          user reads
```

---

# 15. One-line Definition

```text id="7tbp6l"
A browser extension that converts any PDF page into a clearer, rewritten version in real time.
```

---

# 16. Immediate Next Step

Start Slice 1:

* toggle
* no AI
* no extraction

Ship first interaction.
