# Plan: Robust Pixel-Perfect PDF Explainer

Rebuild the extension's UI and extraction pipeline to achieve pixel-perfect fidelity with the reference video while solving critical real-world PDF engineering challenges (multi-column text, scanned pages, scroll synchronization, and "Peek" mode).

## Objective
Transform the current "Explainer Mode" into a high-fidelity, robust reading environment that feels native, handles complex layouts accurately, and provides defensive fallbacks for the "Invisible PDF Wars."

## Key Files & Context
- `content.js`: Main logic for extraction, state, and UI rendering.
- `styles/main.css`: All styling, including transitions and "Peek" mode.
- `manifest.json`: For `file:///` scheme considerations.

---

## Implementation Steps

### Phase 1: The Pixel-Perfect UI Shell
*   **Iconography**: Replace existing icons with custom SVGs matching the "Document + Sparkle" style.
*   **Header & Controls**:
    - Left: Document Title + Page Metadata.
    - Right: 
        - **Segmented Control (Levels)**: container with light-gray background; active segment with white background + shadow.
        - **Peek Toggle**: Manual button to trigger opacity drop.
        - **Explainer Toggle**: High-contrast orange/red theme when "ON".
*   **Typography**: Shift to Inter (UI) and Georgia/Merriweather (Doc) with precise line-heights (1.6–1.8).

### Phase 2: Robust Extraction Engine (Defensive Engineering)
*   **The Sanitizer**:
    - Implement a ligature-fix dictionary (e.g., `fi`, `fl` -> standard chars).
    - Regex patterns to strip headers, footers, and repetitive page numbers.
*   **The Sorter**:
    - Refactor `normalizeTextItems` to sort by `Y` then `X` with a bounding-box heuristic to detect and handle 2-column layouts (prevent horizontal sentence scrambling).
*   **Integrity Checks**:
    - **Text Density Check**: If extracted text < 50 chars, show "Scanned Page" error toast.
    - **Password Protection**: Catch `PasswordException` and show "Locked PDF" state.

### Phase 3: UX Mechanics & "The Glue"
*   **Scroll Sync Normalizer**:
    - Record `scrollTop / scrollHeight` before toggling modes.
    - Apply saved percentage to the new layer post-render to preserve reading position.
*   **Peek Mode (Dual Control)**:
    - **Manual**: Clickable button in header.
    - **Keyboard**: Listen for `Shift` key (down/up) to drop Explainer layer opacity to 10% instantly.
*   **Latency Handling**:
    - **Skeleton Loader**: Apply `blur(4px)` to native PDF and show pulsing header skeleton upon click until the first LLM token arrives.
*   **Page Boundary**:
    - Add "Next Page" footer trigger to Explainer view to prevent being "trapped" on a single page.

### Phase 4: Prompt & Permission Guard
*   **Defensive Prompting**:
    - Update LLM instructions to:
        - Preserve tables and formulas as raw text/placeholders.
        - Maintain numeric citations `[1]`.
        - Explicitly state `[Unreadable]` for fragmented data.
*   **File URL Onboarding**:
    - Check `chrome.extension.isAllowedFileSchemeAccess`.
    - If on `file:///` and blocked, show an "Unlock Local Files" overlay with instructions for Chrome settings.

---

## Verification & Testing

### 1. Visual Verification
- [ ] Compare Header, Mode Switcher, and Toggle states with video frames at 1:1 scale.
- [ ] Verify font-weight, letter-spacing, and transition fluidness (< 150ms).

### 2. Robustness Testing
- [ ] **2-Column Paper**: Verify text isn't scrambled between columns.
- [ ] **Scanned Document**: Verify "Scanned Page" fallback appears.
- [ ] **Math/Tables**: Verify LLM doesn't "hallucinate" new math but preserves original text.
- [ ] **Local Files**: Verify onboarding appears when dragging a PDF from desktop.

### 3. UX Verification
- [ ] **Scroll Sync**: Scroll to middle of page, toggle Explainer, verify you are still in the middle.
- [ ] **Peek Mode**: Hold Shift key; verify native PDF is visible underneath at 10% Explainer opacity.
- [ ] **Performance**: Verify "Dead Zone" blur signals work before first token.

## Migration & Rollback
- Maintain `originalText` in the state to allow instant rollback to "PDF" mode if the API fails.
- All UI elements scoped under `#open-pdf-root` to prevent CSS leaking into other parts of the browser UI.
