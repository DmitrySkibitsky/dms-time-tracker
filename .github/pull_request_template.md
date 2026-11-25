<!-- Title: Conventional Commits, e.g. `fix(timer): keep the start time when editing the description`. -->
<!-- Rules: CONTRIBUTING.md. Keep every section; write "None" where nothing applies. -->

## Problem

<!-- What is wrong or missing, and how it shows. Link the issue if there is one. -->

## Change

<!-- What this pull request does, and why this way. Mention the docs it updates. -->

## Checks

<!-- Tick what you ran; say why a box that applies stays unticked. -->

- [ ] `npm run check` (types, lint, format, translations, manifest, bundle, unit and QML tests)
- [ ] `nix flake check`: the flake, QML or the toolchain changed
- [ ] Tried in a running DMS (`dms ipc call plugins reload timeTracker` or `dms restart`): the UI changed
- [ ] `lib/tracker.mjs` rebuilt and committed: `src/` changed
- [ ] `npm run i18n:sync` and translations filled in: UI strings changed
- [ ] New tests fail without the fix

<!-- Anything else you verified, and how. -->

## AI assistance

<!-- Required. Tick one. If AI was used, name the tool and the exact model, and say what it did. -->

- [ ] No AI tool was used.
- [ ] An AI tool was used.
  - Tool and model: <!-- e.g. Claude Code, claude-opus-5-5 -->
  - What it did: <!-- e.g. wrote the fix and the tests; the author reviewed every change -->
