---
feature: "Open Source Supertag CLI Repository"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Open Source Supertag CLI Repository

## Architecture Overview

This plan implements repository migration from KAI monorepo to standalone GitHub repository with complete open source infrastructure. The approach is **fresh start** - create new repository with clean git history, copy current code, add community files, update website, and configure GitHub.

```
Current State:
┌─────────────────────────────────────┐
│ KAI Monorepo (Private)              │
│ /Users/fischer/work/DA/KAI/         │
│ └── skills/tana/                    │
│     ├── src/                        │
│     ├── export/                     │
│     ├── mcp/                        │
│     └── ...                         │
└─────────────────────────────────────┘
         │
         ↓ (symlink)
         │
┌────────────────────┐
│ ~/.claude/skills/  │
│ └── tana → (link)  │
└────────────────────┘

Target State:
┌──────────────────────────────────────────┐
│ Standalone Repo (Public)                 │
│ ~/work/supertag-cli/                     │
│ ├── src/                                 │
│ ├── export/                              │
│ ├── mcp/                                 │
│ ├── LICENSE (MIT)                        │
│ ├── CONTRIBUTING.md                      │
│ ├── CODE_OF_CONDUCT.md                   │
│ ├── SECURITY.md                          │
│ └── .github/                             │
│     ├── workflows/test.yml               │
│     ├── ISSUE_TEMPLATE/                  │
│     └── pull_request_template.md         │
└──────────────────────────────────────────┘
         │
         ↓ (symlink updated)
         │
┌────────────────────────────────┐
│ ~/.claude/skills/              │
│ └── tana → ~/work/supertag-cli │
└────────────────────────────────┘

Website (store.invisible.ch):
┌────────────────────────────────┐
│ Before: Commercial              │
│ - Pricing page                 │
│ - Purchase CTAs                │
│ - LemonSqueezy integration     │
└────────────────────────────────┘
         │
         ↓ (update)
         │
┌────────────────────────────────┐
│ After: Open Source Landing     │
│ - Download links to GitHub     │
│ - "Free & Open Source" badge   │
│ - Repository link              │
│ - User guide (no activation)   │
└────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Already in use, PAI standard |
| Runtime | Bun | Already in use, PAI standard |
| Repository | GitHub | Industry standard, excellent CI/CD |
| License | MIT | Maximum permissiveness, simple, well-known |
| CI/CD | GitHub Actions | Native integration, free for public repos |
| Documentation | Markdown | Already in use, GitHub renders natively |
| Templates | GitHub's defaults | Community-tested, professional |

## Constitutional Compliance

- ✅ **CLI-First:** Already compliant - Supertag CLI is a command-line tool
- ✅ **Library-First:** Already compliant - Core logic separated from CLI commands
- ✅ **Test-First:** Already compliant - TDD enforced, 379 tests passing
- ✅ **Deterministic:** Already compliant - No probabilistic behavior in CLI
- ✅ **Code Before Prompts:** Already compliant - Logic in TypeScript, not prompts

**Note:** This spec is about infrastructure (repository setup, documentation, community files), not new features. The existing codebase already meets PAI constitutional requirements.

## Data Model

No database changes required. This is purely infrastructure and documentation work.

## API Contracts

No API changes. Existing CLI commands and MCP tools unchanged.

## Implementation Strategy

### Phase 1: Repository Migration (Foundation)

Create standalone repository with clean history:

1. **Create new directory structure**
   ```bash
   mkdir ~/work/supertag-cli
   cd ~/work/supertag-cli
   git init
   ```

2. **Copy files from KAI monorepo** (excluding git history)
   ```bash
   rsync -av --exclude='.git' \
            --exclude='node_modules' \
            --exclude='*.db' \
            /Users/fischer/work/DA/KAI/skills/tana/ \
            ~/work/supertag-cli/
   ```

3. **Verify independence**
   - Run `bun install` in new location
   - Run `bun test:full` - all 379 tests must pass
   - Run build scripts - all binaries must compile
   - Check for absolute path references (search for `/Users/fischer`)

4. **Update symlink**
   ```bash
   rm ~/.claude/skills/tana
   ln -s ~/work/supertag-cli ~/.claude/skills/tana
   ```

5. **Initial commit**
   ```bash
   git add .
   git commit -m "Initial commit - Supertag CLI v0.12.0 (open source release)"
   ```

### Phase 2: Community Infrastructure

Add open source community files:

1. **LICENSE file** (MIT)
   - Copy from https://choosealicense.com/licenses/mit/
   - Update copyright year and author name
   - Commit: `git commit -m "docs: add MIT license"`

2. **CODE_OF_CONDUCT.md**
   - Use Contributor Covenant v2.1
   - Copy from https://www.contributor-covenant.org/version/2/1/code_of_conduct/
   - Update contact method (email)
   - Commit: `git commit -m "docs: add code of conduct"`

3. **SECURITY.md**
   - Create security policy with:
     - Supported versions
     - Reporting instructions (private email)
     - Response timeline expectations
   - Commit: `git commit -m "docs: add security policy"`

4. **CONTRIBUTING.md**
   - Development setup (Bun, clone, install)
   - Testing requirements (TDD workflow)
   - PR process and checklist
   - Code style (TypeScript conventions)
   - Commit message format
   - Commit: `git commit -m "docs: add contributing guidelines"`

5. **GitHub templates**
   ```
   .github/
   ├── ISSUE_TEMPLATE/
   │   ├── bug_report.md
   │   └── feature_request.md
   └── pull_request_template.md
   ```
   - Use GitHub's default templates
   - Customize for project-specific needs
   - Commit: `git commit -m "chore: add issue and PR templates"`

6. **GitHub Actions CI**
   - Create `.github/workflows/test.yml`
   - Run `bun test` on push and PRs
   - Commit: `git commit -m "ci: add GitHub Actions workflow"`

### Phase 3: Documentation Updates

Update existing documentation for public audience:

1. **README.md**
   - Add badges (license, tests, version)
   - Add "License" section at bottom
   - Add "Contributing" section at bottom
   - Add "Security" section reference
   - Remove any private URLs (if present)
   - Add "Building from Source" section
   - Commit: `git commit -m "docs: update README for open source"`

2. **package.json**
   - Update `license` field to "MIT"
   - Ensure `private: false` (or remove field)
   - Add `repository` field with GitHub URL
   - Add `bugs` field with GitHub issues URL
   - Add `homepage` field
   - Commit: `git commit -m "chore: update package.json metadata"`

3. **CHANGELOG.md**
   - Add entry for open source release
   - Commit: `git commit -m "docs: add open source release to changelog"`

### Phase 4: Website Updates (store.invisible.ch)

Update website to reflect open source status:

**Location:** `~/work/web/invisible-store/tana/`

1. **index.html** (landing page)
   - Remove: Pricing section, "Purchase" buttons, LemonSqueezy scripts
   - Add: "Free & Open Source" badge/banner
   - Add: GitHub repository link (prominent)
   - Add: "Download" button → links to GitHub releases
   - Update: Hero text to "Free and open source CLI..."
   - Commit: `git commit -m "feat: convert landing page to open source"`

2. **pricing.html** (if exists)
   - Delete file entirely
   - Remove from navigation
   - Commit: `git commit -m "chore: remove pricing page"`

3. **guide.html / USER-GUIDE.md**
   - Remove: License activation instructions
   - Update: Download links to GitHub releases
   - Keep: Usage examples, command reference
   - Commit: `git commit -m "docs: update user guide for open source"`

4. **CHANGELOG.md** (website copy)
   - Sync with repository CHANGELOG.md
   - Commit: `git commit -m "docs: sync changelog with repository"`

5. **JavaScript/CSS cleanup**
   - Remove LemonSqueezy integration code
   - Update download button handlers
   - Remove purchase flow logic
   - Commit: `git commit -m "refactor: remove commercial integration code"`

6. **Build and deploy**
   ```bash
   cd ~/work/web/invisible-store
   npm run build
   # (Deploy process - user's existing workflow)
   ```

### Phase 5: GitHub Repository Setup

Configure GitHub repository for public release:

1. **Create GitHub repository**
   - Repository name: `supertag-cli`
   - Visibility: Public
   - Description: "CLI tool for Tana integration - query, create, sync, and manage Tana workspaces with semantic search"
   - Initialize with: None (we have our own)

2. **Push to GitHub**
   ```bash
   cd ~/work/supertag-cli
   git remote add origin git@github.com:<username>/supertag-cli.git
   git branch -M main
   git push -u origin main
   git tag v0.12.0
   git push --tags
   ```

3. **Configure repository settings**
   - About section:
     - Website: https://store.invisible.ch/tana (or docs URL)
     - Topics: `tana`, `cli`, `knowledge-management`, `typescript`, `bun`, `sqlite`, `mcp`, `semantic-search`
   - Features:
     - Issues: ✅ Enabled
     - Wiki: ❌ Disabled
     - Discussions: ❌ Disabled (for now)
   - Branch protection (main):
     - Require pull request reviews: ❌ (single maintainer initially)
     - Require status checks: ✅ (GitHub Actions tests must pass)

4. **Create initial GitHub Release**
   - Tag: v0.12.0
   - Title: "v0.12.0 - Open Source Release"
   - Body: Copy from CHANGELOG.md
   - Attach binaries:
     - supertag-cli-v0.12.0-macos-arm64.zip
     - supertag-cli-v0.12.0-macos-x64.zip
     - supertag-cli-v0.12.0-linux-x64.zip
     - supertag-cli-v0.12.0-windows-x64.zip

### Phase 6: Security Audit & Final Verification

Perform security review before making public:

1. **Search for hardcoded credentials**
   ```bash
   cd ~/work/supertag-cli
   grep -r "api_key\|secret\|password\|token" --include="*.ts" --include="*.js"
   ```

2. **Check for absolute paths**
   ```bash
   grep -r "/Users/fischer" --include="*.ts" --include="*.js" --include="*.md"
   ```

3. **Review .gitignore**
   - Ensure secrets, .env, *.db, node_modules covered
   - Add any missing patterns

4. **Verify no sensitive data in git history**
   ```bash
   git log -p | grep -i "password\|secret\|api_key" || echo "Clean"
   ```

5. **Final test**
   - Clone repository to temporary location
   - Run `bun install && bun test:full`
   - Verify all tests pass
   - Verify builds work

6. **Make repository public**
   - GitHub Settings → Danger Zone → Change visibility → Public

## File Structure

### New Repository Structure

```
~/work/supertag-cli/
├── .github/
│   ├── workflows/
│   │   └── test.yml                      # [New] - CI workflow
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md                 # [New] - Bug report template
│   │   └── feature_request.md            # [New] - Feature request template
│   └── pull_request_template.md          # [New] - PR template
├── src/                                   # [Copied] - Existing code
├── export/                                # [Copied] - Existing code
├── mcp/                                   # [Copied] - Existing code
├── tests/                                 # [Copied] - Existing tests
├── LICENSE                                # [New] - MIT license
├── CONTRIBUTING.md                        # [New] - Contributor guidelines
├── CODE_OF_CONDUCT.md                     # [New] - Code of conduct
├── SECURITY.md                            # [New] - Security policy
├── README.md                              # [Modified] - Add badges, sections
├── CHANGELOG.md                           # [Modified] - Add open source entry
├── package.json                           # [Modified] - Update metadata
├── .gitignore                             # [Modified] - Add secret patterns
└── (all other existing files)             # [Copied] - Unchanged
```

### Website Structure (store.invisible.ch)

```
~/work/web/invisible-store/tana/
├── index.html                 # [Modified] - Remove pricing, add download links
├── pricing.html               # [Deleted] - No longer needed
├── guide.html                 # [Modified] - Remove activation instructions
├── USER-GUIDE.md              # [Modified] - Source for guide.html
├── CHANGELOG.md               # [Modified] - Sync with repository
├── build-guide.ts             # [Unchanged] - Build script
├── build-changelog.ts         # [Unchanged] - Build script
└── *.js, *.css                # [Modified] - Remove LemonSqueezy code
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Sensitive data in git history | Critical | Low | Security audit before making public, fresh repo eliminates this |
| Breaking existing symlinks/workflows | High | Medium | Update symlink immediately, test in new location |
| Absolute path references break | High | Low | Search and replace, verify builds |
| Low-quality contributions | Medium | Medium | Clear CONTRIBUTING.md, PR templates, require tests |
| Security vulnerabilities reported publicly | High | Low | SECURITY.md with private reporting instructions |
| Website downtime during updates | Medium | Low | Test locally, deploy during low-traffic hours |
| Repository name conflicts | Low | Low | Verify `supertag-cli` available on GitHub first |
| Missing dependencies in standalone repo | High | Low | Test `bun install` from clean state |

## Dependencies

### External (New)

None - this is infrastructure work, no new npm packages.

### Internal (No Changes)

All existing dependencies remain unchanged. The codebase is copied as-is.

### Tool Dependencies

- **git-filter-repo** (Optional, not needed for fresh start)
- **rsync** (For copying files)
- **GitHub CLI (`gh`)** (Optional, for creating releases)

## Migration/Deployment

### Pre-Migration Checklist

- [x] License removal completed (v0.12.0)
- [x] All tests passing (379/379)
- [x] Multi-platform builds successful
- [ ] GitHub repository name available
- [ ] Backup KAI monorepo (just in case)

### Migration Steps

1. **Repository Creation** (Phase 1)
   - Create directory, copy files, verify independence
   - ~30 minutes

2. **Community Files** (Phase 2)
   - Add LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, templates
   - ~2 hours

3. **Documentation Updates** (Phase 3)
   - Update README, package.json, CHANGELOG
   - ~1 hour

4. **Website Updates** (Phase 4)
   - Update store.invisible.ch
   - ~2 hours

5. **GitHub Setup** (Phase 5)
   - Create repo, push code, configure settings, create release
   - ~1 hour

6. **Security Audit** (Phase 6)
   - Search for secrets, verify clean, make public
   - ~1 hour

**Total estimated time:** ~8 hours

### Environment Variables

No new environment variables required. Existing config files (`~/.config/supertag/config.json`) work unchanged.

### Breaking Changes

**None for end users.** The CLI functionality is identical.

**For maintainer:**
- Symlink location changes (automated update)
- Repository location changes (~/work/supertag-cli)
- Two repositories to manage (KAI private + supertag-cli public)

## Estimated Complexity

- **New files:** ~10
  - LICENSE
  - CONTRIBUTING.md
  - CODE_OF_CONDUCT.md
  - SECURITY.md
  - .github/workflows/test.yml
  - .github/ISSUE_TEMPLATE/bug_report.md
  - .github/ISSUE_TEMPLATE/feature_request.md
  - .github/pull_request_template.md
  - .specify/specs/opensource-repository/plan.md (this file)
  - .specify/specs/opensource-repository/tasks.md (next phase)

- **Modified files:** ~6
  - README.md (add badges, sections)
  - package.json (metadata updates)
  - CHANGELOG.md (add entry)
  - .gitignore (ensure secrets covered)
  - Website: index.html, guide.html, CHANGELOG.md, *.js

- **Deleted files:** ~1
  - Website: pricing.html

- **Copied files:** ~200+ (entire existing codebase)

- **Test files:** 0 new tests (infrastructure-only changes)

- **Estimated tasks:** ~25-30 tasks
  - Migration: 5 tasks
  - Community files: 8 tasks
  - Documentation: 5 tasks
  - Website: 6 tasks
  - GitHub setup: 5 tasks
  - Security audit: 5 tasks

## Open Questions Resolved

All questions from spec.md have been answered by user:

- ✅ Migration strategy: Fresh start (Option B)
- ✅ Repository location: ~/work/supertag-cli
- ✅ Repository name: supertag-cli
- ✅ GitHub account: Personal account
- ✅ Website strategy: Keep as landing page, remove pricing (Option A)
- ✅ GitHub Discussions: Issues only (no Discussions initially)
- ✅ npm publishing: Wait until after open source release
- ✅ Git history: Should be clean (fresh start)
- ✅ GitHub Sponsors: No

## Success Criteria

This plan is successful when:

1. **Repository is standalone and public**
   - Lives at ~/work/supertag-cli
   - Pushed to github.com/<username>/supertag-cli
   - Visibility set to public
   - All tests pass in new location

2. **Community infrastructure complete**
   - LICENSE (MIT) present
   - CONTRIBUTING.md with clear instructions
   - CODE_OF_CONDUCT.md (Contributor Covenant)
   - SECURITY.md with reporting process
   - GitHub templates for issues and PRs
   - CI workflow running

3. **Documentation is public-ready**
   - README has badges and contributing sections
   - No private references or sensitive data
   - package.json metadata correct
   - CHANGELOG includes open source entry

4. **Website reflects open source status**
   - No pricing page
   - No purchase CTAs
   - Download links to GitHub
   - "Free & Open Source" messaging
   - User guide without activation instructions

5. **Security audit passed**
   - No hardcoded credentials
   - No sensitive data in git history
   - .gitignore covers secrets
   - Clean search results for "password", "secret", "api_key"

6. **Symlinks and workflows updated**
   - ~/.claude/skills/tana points to new location
   - CLI commands work from new location
   - Build process works independently

## Next Steps

1. **User approval** - Review this plan for accuracy and completeness
2. **Move to TASKS phase** - `/speckit.tasks` to create detailed task breakdown
3. **Execute implementation** - `/speckit.implement` with TDD workflow (though most tasks are file creation, not code)

---

**Plan Status:** ✅ Ready for Review
**Approver:** User
**Next Phase:** TASKS (after approval)
