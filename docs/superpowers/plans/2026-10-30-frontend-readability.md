# Frontend readability refactor

**Goal:** Make the remaining frontend TypeScript and React code easier to read and maintain without changing behavior or UI.

**Scope:** Source under `src/`; existing Tauri command names, storage keys, event order, navigation, and rendering behavior remain unchanged. This work is separate from release v0.1.23.

1. Add a pinned formatter and a reproducible check for frontend TypeScript and TSX; format the existing source consistently.
2. Split the largest content and version-page components along feature boundaries. Keep their existing public interfaces and selectors.
3. Update the JSDOM integration module loader for any extracted components and retain real interaction coverage.
4. Run format verification, strict TypeScript, all existing tests, and the frontend build; inspect the resulting diff.

**Review focus:** search and IME behavior, local mod actions and dialogs, content pagination and thumbnails, version selection and install controls, startup and cancellation wiring, preserved JSX whitespace and accessibility labels.
