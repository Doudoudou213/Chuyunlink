# ChuLink-Legacy agent guidance

Before changing this repository, read:

- `docs/PROJECT_MEMORY.md`
- `docs/DEVELOPMENT_BACKLOG.md`
- the domain-specific document relevant to the task

## Source of truth

- The personal development checkout is `D:/OneDrive/文档/ChatGPT/楚韵链迹/work/Chuyunlink`, branch `doudoudou`. Preserve the older backend/UI/integration worktrees and their unfinished work.
- This checkout retains the development history after removing a legacy credential from historical blobs. Never merge the unsanitized old Git history back into this repository. Transfer later legacy-worktree changes as reviewed patches or selected file changes, with tests. The original-to-clean commit mapping is in `docs/HISTORY_MIGRATION_COMMIT_MAP_20261004.txt`.
- The personal repository is `https://github.com/Doudoudou213/Chuyunlink.git`, configured as remote `personal`. Use `doudoudou` for the integrated code. Never push to the former shared repository (`cgygygg/ChuLink-Legacy`, remote `origin`). Preserve any existing `main` branch and uncommitted work; do not force-push or deploy without current authorization.
- Do not mix changes with the older `ChuLink-Legacy` worktree on branch `shan`.
- Preserve all existing commits and user changes. Never discard, reset, or overwrite unrelated work.

## Safety and product rules

- Never put API keys, CloudBase secrets, OCR credentials, user identifiers, or private file URLs in source control, frontend code, chat output, or screenshots.
- AI output is advisory. It must not establish historical facts, publish story relationships, delete data, change rewards, or approve content without the existing human review flow.
- Material analysis requires explicit, versioned user consent. Old consent must not be reinterpreted or backfilled.
- Do not delete or migrate production user data unless the user explicitly requests a reviewed migration.
- Do not push, merge, deploy, or enable paid AI/OCR services unless the user explicitly authorizes that action in the current task.

## Frontend rules

- The public web application is primarily `index.html` plus `static/cloudbase-app.js`; the admin application is `admin.html`.
- Keep existing submission, review, comments, likes, rewards, maps, story evidence, and CloudBase behavior intact during visual work.
- Reuse semantic tokens and components rather than scattering new hardcoded styles.
- Maintain responsive layouts, 44 px touch targets, visible keyboard focus, readable contrast, reduced-motion behavior, and image source/copyright affordances.
- The approved visual direction is summarized in `docs/PROJECT_MEMORY.md`: Chu-specific “夜漆朱凤” rather than generic palace-style Chinese UI.

## Verification

- Inspect the relevant diff before editing because the main HTML files are large.
- Run the repository checks that cover the touched area and report anything not run.
- For UI work, verify at mobile, tablet, and desktop widths and compare screenshots before claiming completion.

