# Launcher entry readability Implementation Plan

> **For agentic workers:** Implement the existing refactor inline. Keep the current UI and runtime behavior.

**Goal:** Make `src/main.ts` readable as application composition rather than a compressed collection of callbacks.

**Architecture:** Group controller construction by account, content, and instance responsibilities. Keep rendering and event registration in dedicated app modules. Retain explicit, typed dependencies and existing library controllers; avoid a generic service registry.

**Tech Stack:** TypeScript, React, Tauri, existing Node/JSDOM tests.

**Spec:** User request: “main.ts可读性太差/代码风格太差，继续优化”. Preserve existing behavior.

## Constraints

- Do not change the UI, backend command names, persistence keys, or startup sequencing.
- Use descriptive module-qualified methods instead of chains of aliases.
- Format the touched composition code consistently, including multiline dependency objects.
- Work in the existing workspace. This request does not include a push or release.

## Review Focus

- Cached account avatar appears before background authentication finishes (account tests).
- Download completion invalidates only the relevant instance content (UI tests plus focused callback tests).
- IME composition and open dialogs survive background rendering (UI tests).
- Skin/theme restoration and desktop event subscription order remain unchanged (UI/account/crash tests).
- Instance-specific settings and pack/mod management retain their connections (instance/pack tests).

## Tasks

- [x] Establish baseline with `npm run check`.
- [x] Extract typed account/content/instance factories; preserve backend adapters and controller behavior.
- [x] Extract rendering and event wiring; simplify `main.ts` to ordered application setup.
- [x] Update integration test loader for extracted modules and add meaningful coverage for download completion branches.
- [x] Run `npm run check`, inspect the diff and module boundaries, record results.

## Validation

- Baseline `npm run check`: 68 tests, UI scenarios, strict TypeScript and Vite build passed.
- Final `npm run check`: 74 tests, UI scenarios, strict TypeScript and Vite build passed.
- Updated test loader to accept multiline imports; original single-line-only stripping caused test bootstrap syntax errors after formatting.
- No runtime dependency added. Existing appearance-preview chunk-size warning remains.
- Entry size reduced from 20,642 to 7,777 bytes; expanded formatting is intentional.
- Independent review found no concrete regressions or serious maintainability issues; account/content tests independently rerun: 32 passed.
