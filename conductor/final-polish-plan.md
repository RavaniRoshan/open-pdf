# Final Polish Plan: Open PDF Extension

## Objective
Finalize the open-pdf extension by resolving remaining AI mode logic bugs, streamlining the UI controls, creating a professional README, and publishing a GitHub release.

## Scope & Impact
This plan touches the core UI logic in `content.js` and the documentation. The goal is to make the extension production-ready. We will ignore the authentication/login system for this release, focusing on a highly robust V1.

## Proposed Solution

### 1. Fix AI Mode & Mode Logic Transition
**Problem:** Currently, clicking "Explainer Mode" toggles a separate button, and "Normal", "Simple", "Technical" are sub-levels of the Explainer Mode. The user wants "Normal" to represent the raw extracted PDF text without AI intervention, and clicking "Simple" or "Technical" to automatically trigger the AI Explainer mode without needing a separate toggle.
**Solution:**
- Redefine `LEVELS = ['normal', 'simple', 'technical']`.
- Update `setLevel(nextLevel)` in `content.js`:
  - If `nextLevel === 'normal'`, set `state.mode = 'pdf'` (raw text).
  - If `nextLevel === 'simple'` or `'technical'`, set `state.mode = 'explainer'` and trigger `runExplainer()`.
- Remove the redundant "Sparkle Explainer ON/OFF" toggle button from `renderShell` and its click handlers in `attachRootEvents`.
- Ensure `marked` parsing is robust.

### 2. Professional README Construction
**Problem:** The current README is not professional enough.
**Solution:**
- Utilize `crafting-effective-readmes` to structure the README as a high-quality open-source project.
- Include sections: Title, Badges, "What it does", Features (Isolated Reader, True Peek Mode, Stealth Sync), Installation, Usage, and License.

### 3. GitHub Release Packaging
**Problem:** The user wants to package this as a release.
**Solution:**
- Zip the final source code (excluding development artifacts like `.kilo`, `.codex`, `conductor`).
- Create a Git tag `v1.0.0`.
- Push the tag and create a formal GitHub release via CLI or instruct the user on the final zip file generated.

## Verification
- Selecting "Normal" displays raw text instantly.
- Selecting "Simple" streams the simplified AI response.
- Selecting "Technical" streams the technical AI response.
- README.md is beautifully formatted.

## Alternatives Considered
- Keeping the separate Sparkle toggle was considered, but it violates the user's request for a seamless 1-click mode switch.
