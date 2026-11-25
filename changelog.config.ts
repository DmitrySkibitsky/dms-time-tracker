import type { ChangelogConfig } from "changelogen";

// The changelog is for plugin users: tooling, tests, CI and contributor docs stay out of it.
// Scopes can't be filtered, so a user-invisible `fix(tests)` still shows up: trim it in the
// release pull request.
export default {
    types: {
        docs: false,
        refactor: false,
        build: false,
        chore: false,
        examples: false,
        test: false,
        style: false,
        ci: false
    },
    hideAuthorEmail: true
} satisfies Partial<ChangelogConfig>;
