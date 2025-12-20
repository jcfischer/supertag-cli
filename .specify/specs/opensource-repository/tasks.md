---
feature: "Open Source Supertag CLI Repository"
plan: "./plan.md"
status: "pending"
total_tasks: 27
completed: 0
---

# Tasks: Open Source Supertag CLI Repository

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)
- `[DOC]` - Documentation/file creation task (no TDD)

**Note:** Most tasks in this spec are infrastructure/documentation, not code. TDD applies only to the CI workflow verification.

## Task Groups

### Group 1: Repository Migration (Foundation)

- [ ] **T-1.1** Create new repository directory structure [DOC] [P]
  - Command: `mkdir ~/work/supertag-cli && cd ~/work/supertag-cli && git init`
  - Description: Create standalone repository directory with fresh git init

- [ ] **T-1.2** Copy files from KAI monorepo [DOC] [P]
  - Command: `rsync -av --exclude='.git' --exclude='node_modules' --exclude='*.db' /Users/fischer/work/DA/KAI/skills/tana/ ~/work/supertag-cli/`
  - Description: Copy all source code, tests, docs (excluding git history and build artifacts)

- [ ] **T-1.3** Verify independence - install dependencies (depends: T-1.2)
  - Command: `cd ~/work/supertag-cli && bun install`
  - Verification: Check for missing dependencies, resolve any imports
  - Description: Ensure repository can stand alone without KAI monorepo

- [ ] **T-1.4** Verify independence - run full test suite [T] (depends: T-1.3)
  - Command: `bun test:full`
  - Verification: All 379 tests must pass
  - Description: Confirm no dependencies on parent directories or missing modules

- [ ] **T-1.5** Verify independence - build binaries (depends: T-1.3)
  - Command: `bun build src/index.ts --compile --outfile supertag && bun build export/index.ts --compile --outfile export/supertag-export`
  - Verification: Both binaries compile successfully
  - Description: Ensure build process works independently

- [ ] **T-1.6** Search and replace absolute paths [DOC] (depends: T-1.2)
  - Command: `grep -r "/Users/fischer" --include="*.ts" --include="*.js" --include="*.md"`
  - Action: Replace with relative paths or environment variables if found
  - Description: Remove hardcoded paths that would break for other users

- [ ] **T-1.7** Initial git commit (depends: T-1.4, T-1.5, T-1.6)
  - Command: `git add . && git commit -m "Initial commit - Supertag CLI v0.12.0 (open source release)"`
  - Description: Create first commit in new repository with clean codebase

- [ ] **T-1.8** Update symlink to new location [DOC] (depends: T-1.7)
  - Command: `rm ~/.claude/skills/tana && ln -s ~/work/supertag-cli ~/.claude/skills/tana`
  - Verification: `ls -la ~/.claude/skills/tana` shows new target
  - Description: Point symlink to new repository location

### Group 2: Community Infrastructure Files

- [ ] **T-2.1** Create LICENSE file (MIT) [DOC] [P]
  - File: `LICENSE`
  - Source: https://choosealicense.com/licenses/mit/
  - Action: Copy MIT license, update year and author name
  - Commit: `git commit -m "docs: add MIT license"`

- [ ] **T-2.2** Create CODE_OF_CONDUCT.md [DOC] [P]
  - File: `CODE_OF_CONDUCT.md`
  - Source: https://www.contributor-covenant.org/version/2/1/code_of_conduct/
  - Action: Copy Contributor Covenant v2.1, update contact email
  - Commit: `git commit -m "docs: add code of conduct"`

- [ ] **T-2.3** Create SECURITY.md [DOC] [P]
  - File: `SECURITY.md`
  - Content: Supported versions, reporting instructions (private email), response timeline
  - Commit: `git commit -m "docs: add security policy"`

- [ ] **T-2.4** Create CONTRIBUTING.md [DOC]
  - File: `CONTRIBUTING.md`
  - Content: Development setup, testing (TDD workflow), PR process, code style, commit format
  - Commit: `git commit -m "docs: add contributing guidelines"`

- [ ] **T-2.5** Create GitHub issue templates [DOC] [P]
  - Files: `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`
  - Source: GitHub's default templates
  - Commit: `git commit -m "chore: add issue templates"`

- [ ] **T-2.6** Create GitHub PR template [DOC] [P]
  - File: `.github/pull_request_template.md`
  - Content: Checklist (tests pass, docs updated), description requirements
  - Commit: `git commit -m "chore: add PR template"`

- [ ] **T-2.7** Create GitHub Actions CI workflow [T]
  - File: `.github/workflows/test.yml`
  - Test: Manually trigger workflow, verify runs successfully
  - Content: Run `bun install && bun test` on push and PRs
  - Commit: `git commit -m "ci: add GitHub Actions workflow"`

### Group 3: Documentation Updates

- [ ] **T-3.1** Update README.md with badges and sections [DOC]
  - File: `README.md`
  - Add: Badges (license, tests, version), License section, Contributing section, Security section
  - Add: "Building from Source" section
  - Remove: Any private URLs or references (if present)
  - Commit: `git commit -m "docs: update README for open source"`

- [ ] **T-3.2** Update package.json metadata [DOC]
  - File: `package.json`
  - Update: `"license": "MIT"`, ensure `private: false` (or remove)
  - Add: `repository`, `bugs`, `homepage` fields with GitHub URLs
  - Commit: `git commit -m "chore: update package.json metadata"`

- [ ] **T-3.3** Update CHANGELOG.md with open source entry [DOC]
  - File: `CHANGELOG.md`
  - Add: Section for open source release (v0.12.0 already has license removal)
  - Commit: `git commit -m "docs: add open source release to changelog"`

- [ ] **T-3.4** Review and update .gitignore [DOC]
  - File: `.gitignore`
  - Add: Ensure `.env`, `*.key`, `*.pem`, `credentials.json`, `secrets.json` covered
  - Commit: `git commit -m "chore: ensure .gitignore covers secrets"`

### Group 4: Website Updates (store.invisible.ch)

- [ ] **T-4.1** Update index.html landing page [DOC]
  - File: `~/work/web/invisible-store/tana/index.html`
  - Remove: Pricing section, "Purchase" buttons, LemonSqueezy scripts
  - Add: "Free & Open Source" badge, GitHub repository link, "Download" button → GitHub releases
  - Update: Hero text to "Free and open source CLI..."
  - Commit: `git commit -m "feat: convert landing page to open source"`

- [ ] **T-4.2** Delete pricing page [DOC]
  - File: `~/work/web/invisible-store/tana/pricing.html`
  - Action: Delete file, remove from navigation
  - Commit: `git commit -m "chore: remove pricing page"`

- [ ] **T-4.3** Update user guide [DOC]
  - Files: `~/work/web/invisible-store/tana/USER-GUIDE.md`, `guide.html`
  - Remove: License activation instructions
  - Update: Download links to GitHub releases
  - Keep: Usage examples, command reference
  - Commit: `git commit -m "docs: update user guide for open source"`

- [ ] **T-4.4** Sync website CHANGELOG.md [DOC]
  - File: `~/work/web/invisible-store/tana/CHANGELOG.md`
  - Action: Sync with repository CHANGELOG.md
  - Commit: `git commit -m "docs: sync changelog with repository"`

- [ ] **T-4.5** Remove LemonSqueezy integration code [DOC]
  - Files: `~/work/web/invisible-store/tana/*.js`
  - Remove: LemonSqueezy checkout scripts, purchase flow logic
  - Update: Download button handlers to link to GitHub releases
  - Commit: `git commit -m "refactor: remove commercial integration code"`

- [ ] **T-4.6** Build and verify website (depends: T-4.1, T-4.2, T-4.3, T-4.4, T-4.5)
  - Command: `cd ~/work/web/invisible-store && npm run build`
  - Verification: Check for broken links, verify no pricing visible, download links work
  - Description: Build website and verify all changes render correctly

### Group 5: GitHub Repository Setup

- [ ] **T-5.1** Create GitHub repository (depends: T-2.7, T-3.4)
  - Action: Create new repository on GitHub
  - Settings: Name=supertag-cli, Visibility=Private (initially), Description="CLI tool for Tana integration..."
  - Description: Create repository (keep private until security audit completes)

- [ ] **T-5.2** Push to GitHub (depends: T-5.1)
  - Command: `git remote add origin git@github.com:<username>/supertag-cli.git && git branch -M main && git push -u origin main && git tag v0.12.0 && git push --tags`
  - Description: Push all code and tags to GitHub

- [ ] **T-5.3** Configure repository settings (depends: T-5.2)
  - Action: GitHub Settings → About (website, topics), Features (Issues: ✅, Wiki: ❌, Discussions: ❌)
  - Topics: `tana`, `cli`, `knowledge-management`, `typescript`, `bun`, `sqlite`, `mcp`, `semantic-search`
  - Description: Configure repository metadata and features

- [ ] **T-5.4** Create GitHub Release v0.12.0 (depends: T-5.2)
  - Action: GitHub Releases → New Release
  - Tag: v0.12.0
  - Title: "v0.12.0 - Open Source Release"
  - Body: Copy from CHANGELOG.md
  - Attachments: Upload 4 distribution zips (from kDrive)
  - Description: Create first public release with binaries

### Group 6: Security Audit & Final Verification

- [ ] **T-6.1** Search for hardcoded credentials [DOC]
  - Command: `cd ~/work/supertag-cli && grep -r "api_key\|secret\|password\|token" --include="*.ts" --include="*.js"`
  - Verification: No hardcoded secrets found (config references are OK)
  - Description: Ensure no credentials in code

- [ ] **T-6.2** Check for absolute paths [DOC]
  - Command: `grep -r "/Users/fischer" --include="*.ts" --include="*.js" --include="*.md"`
  - Verification: Should be clean from T-1.6
  - Description: Double-check no absolute paths remain

- [ ] **T-6.3** Verify git history is clean [DOC]
  - Command: `git log -p | grep -i "password\|secret\|api_key" || echo "Clean"`
  - Verification: "Clean" or only config references
  - Description: Confirm no secrets in commit history (fresh repo should be clean)

- [ ] **T-6.4** Final test from clean clone [T] (depends: T-5.2)
  - Command: `cd /tmp && git clone ~/work/supertag-cli supertag-test && cd supertag-test && bun install && bun test:full`
  - Verification: All 379 tests pass
  - Description: Verify repository works in isolation

- [ ] **T-6.5** Make repository public (depends: T-6.1, T-6.2, T-6.3, T-6.4)
  - Action: GitHub Settings → Danger Zone → Change visibility → Public
  - Description: Make repository public for community access

## Dependency Graph

```
Group 1: Repository Migration
T-1.1 ──┐
T-1.2 ──┼──> T-1.3 ──> T-1.4 ──┐
        │              T-1.5 ──┤──> T-1.7 ──> T-1.8
        └──────────> T-1.6 ────┘

Group 2: Community Files (independent, can run in parallel after Group 1)
T-2.1 ──┐
T-2.2 ──┤
T-2.3 ──┼──> (all independent)
T-2.5 ──┤
T-2.6 ──┘
T-2.4 (after research)
T-2.7 (after understanding CI)

Group 3: Documentation Updates (independent, can run in parallel after Group 1)
T-3.1 ──┐
T-3.2 ──┼──> (all independent)
T-3.3 ──┤
T-3.4 ──┘

Group 4: Website Updates (independent, can run in parallel)
T-4.1 ──┐
T-4.2 ──┤
T-4.3 ──┼──> T-4.6
T-4.4 ──┤
T-4.5 ──┘

Group 5: GitHub Setup (sequential after Groups 2 & 3)
T-2.7 ──┐
T-3.4 ──┴──> T-5.1 ──> T-5.2 ──┬──> T-5.3
                                └──> T-5.4

Group 6: Security Audit (parallel, then final)
T-6.1 ──┐
T-6.2 ──┼──> T-6.5
T-6.3 ──┤
T-5.2 ──┴──> T-6.4 ──┘
```

## Execution Order

### Batch 1: Repository Foundation (Sequential)
1. T-1.1, T-1.2 (parallel)
2. T-1.3 (after T-1.2)
3. T-1.4, T-1.5, T-1.6 (parallel, after T-1.3)
4. T-1.7 (after all above)
5. T-1.8 (after T-1.7)

### Batch 2: Community & Documentation (Parallel after Batch 1)
6. **Group 2 (Community Files):** T-2.1, T-2.2, T-2.3, T-2.5, T-2.6 (all parallel)
7. **Group 2 (Sequential):** T-2.4, T-2.7
8. **Group 3 (Documentation):** T-3.1, T-3.2, T-3.3, T-3.4 (all parallel)

### Batch 3: Website Updates (Parallel with Batch 2)
9. T-4.1, T-4.2, T-4.3, T-4.4, T-4.5 (all parallel)
10. T-4.6 (after all Group 4 tasks)

### Batch 4: GitHub Setup (Sequential after Batch 2)
11. T-5.1 (after T-2.7, T-3.4)
12. T-5.2 (after T-5.1)
13. T-5.3, T-5.4 (parallel, after T-5.2)

### Batch 5: Security Audit (Parallel, then final)
14. T-6.1, T-6.2, T-6.3, T-6.4 (parallel, T-6.4 needs T-5.2)
15. T-6.5 (after all T-6.x)

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| **Group 1: Repository Migration** |
| T-1.1 | pending | - | - | |
| T-1.2 | pending | - | - | |
| T-1.3 | pending | - | - | |
| T-1.4 | pending | - | - | |
| T-1.5 | pending | - | - | |
| T-1.6 | pending | - | - | |
| T-1.7 | pending | - | - | |
| T-1.8 | pending | - | - | |
| **Group 2: Community Infrastructure** |
| T-2.1 | pending | - | - | |
| T-2.2 | pending | - | - | |
| T-2.3 | pending | - | - | |
| T-2.4 | pending | - | - | |
| T-2.5 | pending | - | - | |
| T-2.6 | pending | - | - | |
| T-2.7 | pending | - | - | |
| **Group 3: Documentation Updates** |
| T-3.1 | pending | - | - | |
| T-3.2 | pending | - | - | |
| T-3.3 | pending | - | - | |
| T-3.4 | pending | - | - | |
| **Group 4: Website Updates** |
| T-4.1 | pending | - | - | |
| T-4.2 | pending | - | - | |
| T-4.3 | pending | - | - | |
| T-4.4 | pending | - | - | |
| T-4.5 | pending | - | - | |
| T-4.6 | pending | - | - | |
| **Group 5: GitHub Setup** |
| T-5.1 | pending | - | - | |
| T-5.2 | pending | - | - | |
| T-5.3 | pending | - | - | |
| T-5.4 | pending | - | - | |
| **Group 6: Security Audit** |
| T-6.1 | pending | - | - | |
| T-6.2 | pending | - | - | |
| T-6.3 | pending | - | - | |
| T-6.4 | pending | - | - | |
| T-6.5 | pending | - | - | |

## TDD Reminder

For tasks marked [T] (T-1.4, T-2.7, T-6.4):

1. **RED:** Write failing test first (or verify command fails/succeeds as expected)
2. **GREEN:** Execute command/action to make verification pass
3. **VERIFY:** Run full test suite if applicable (`bun test:full`)

For [DOC] tasks:
- No TDD required - these are file creation/modification tasks
- Verification is manual: file exists, content correct, commit successful

## Special Notes

### Repository Migration (Group 1)
- **Critical:** Verify independence thoroughly (T-1.3, T-1.4, T-1.5) before committing
- **Important:** T-1.6 (absolute paths) must be clean before initial commit
- **Symlink update:** T-1.8 updates PAI integration - test CLI still works after

### Community Files (Group 2)
- Use standard templates from official sources (MIT license, Contributor Covenant)
- T-2.4 (CONTRIBUTING.md) should reference TDD requirements from TESTING.md override
- T-2.7 (CI workflow) should test on ubuntu-latest, install Bun, run `bun test`

### Website (Group 4)
- Backup website before changes (just in case)
- T-4.1 requires finding/replacing LemonSqueezy integration code
- T-4.6 is critical - verify no broken links, pricing removed, download works

### GitHub Setup (Group 5)
- T-5.1: Keep repo private until security audit (T-6.5) completes
- T-5.4: Distribution zips are in `/Users/fischer/kDrive/tana-cli/`
- Branch protection can be added later (single maintainer initially)

### Security Audit (Group 6)
- T-6.1, T-6.2, T-6.3 should all return clean (fresh repo)
- T-6.4 is critical - tests MUST pass from clean clone
- T-6.5 is the final step - no going back once public

## Blockers & Issues

[Track any blockers discovered during implementation]

| Task | Issue | Resolution |
|------|-------|------------|
| - | - | - |

## Estimated Time

| Group | Tasks | Estimated Time |
|-------|-------|----------------|
| Group 1: Repository Migration | 8 tasks | ~30 min |
| Group 2: Community Infrastructure | 7 tasks | ~2 hrs |
| Group 3: Documentation Updates | 4 tasks | ~1 hr |
| Group 4: Website Updates | 6 tasks | ~2 hrs |
| Group 5: GitHub Setup | 4 tasks | ~1 hr |
| Group 6: Security Audit | 5 tasks | ~1 hr |
| **Total** | **27 tasks** | **~8 hrs** |

**Parallel opportunities:** Groups 2, 3, 4 can run concurrently after Group 1 completes (~4 hours can be reduced to ~2 hours).

---

**Tasks Status:** ✅ Ready for Review
**Next Step:** `/speckit.implement` after user approval
