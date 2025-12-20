# Specification: Open Source the Supertag CLI Repository

**Status**: Draft
**Created**: 2025-12-20
**Phase**: SPECIFY
**Dependencies**: Requires `remove-licensing` spec to be completed first

## Executive Summary

Prepare and release the Supertag CLI repository as an open source project with proper licensing, contributor guidelines, documentation, and community infrastructure.

## Background

The Supertag CLI is currently a private tool with commercial licensing (being removed via separate spec). To maximize community adoption, enable contributions, and align with open source best practices, the repository needs proper open source preparation before public release.

## Problem Statement

**Current State:**
- **Repository**: Part of KAI monorepo at `/Users/fischer/work/DA/KAI/skills/tana` (not standalone)
- Repository is private (or not publicly accessible)
- No open source license file
- No contributor guidelines
- Documentation may contain private/commercial references
- No community infrastructure (issue templates, code of conduct, etc.)
- May contain sensitive data or credentials
- **Website**: store.invisible.ch has pricing, purchase CTAs, and LemonSqueezy integration

**Desired State:**
- **Repository**: Standalone public repository (extracted from KAI monorepo)
- Clear open source license (MIT recommended)
- CONTRIBUTING.md with contributor guidelines
- Clean documentation for public audience
- Community infrastructure (templates, code of conduct, security policy)
- No sensitive data in repository or git history
- Ready for community contributions
- **Website**: Updated to reflect open source status (no pricing, download links to GitHub releases)

## User Impact

### Before Open Sourcing

**Developers:**
- Cannot access source code
- Cannot contribute improvements
- Cannot report issues publicly
- Cannot fork for custom modifications
- Must trust binary releases

### After Open Sourcing

**Developers:**
- Can read full source code
- Can contribute via pull requests
- Can report issues/bugs publicly
- Can fork for custom needs
- Can audit security and build from source
- Can propose new features

## Goals

### Primary Goals

1. **Migrate to Standalone Repository**
   - Extract `/Users/fischer/work/DA/KAI/skills/tana` from KAI monorepo
   - Create new standalone GitHub repository
   - Preserve or filter git history (decide on approach)
   - Update all absolute paths and references
   - Ensure build and test processes work independently
   - Update symlinks and integrations that reference old path

2. **Update Website (store.invisible.ch)**
   - Remove pricing page and purchase CTAs
   - Remove LemonSqueezy integration
   - Replace purchase buttons with "Download" links to GitHub releases
   - Update documentation to reflect open source status
   - Add "Open Source" messaging and GitHub repository link
   - Keep user guide but remove commercial references

3. **Choose and Apply Open Source License**
   - Select appropriate license (MIT recommended for maximum permissiveness)
   - Add LICENSE file to repository root
   - Add license headers to source files (if required by license)
   - Update package.json license field

4. **Create Contributor Guidelines**
   - Write CONTRIBUTING.md with:
     - How to set up development environment
     - How to run tests
     - How to submit pull requests
     - Code style guidelines
     - Commit message conventions
     - Testing requirements (TDD enforced)

5. **Prepare Documentation for Public Release**
   - Review README.md for private references
   - Remove commercial/store URLs (or make them optional)
   - Add badges (build status, license, version)
   - Add clear installation instructions
   - Add "Building from Source" section
   - Clarify project purpose and features

6. **Add Community Infrastructure**
   - CODE_OF_CONDUCT.md (Contributor Covenant recommended)
   - SECURITY.md (security policy and vulnerability reporting)
   - GitHub issue templates (.github/ISSUE_TEMPLATE/)
   - GitHub PR template (.github/pull_request_template.md)
   - GitHub Actions for CI/CD (run tests on PRs)

7. **Security Audit**
   - Search for hardcoded credentials
   - Search for API keys or tokens
   - Review git history for sensitive data
   - Add .env.example if environment variables needed
   - Update .gitignore for common sensitive files

8. **Repository Configuration**
   - Set repository to public visibility
   - Configure GitHub repository settings:
     - Description
     - Topics/tags (tana, cli, knowledge-management, typescript)
     - Homepage URL
     - Enable issues
     - Enable discussions (optional)
   - Add repository badges to README

### Secondary Goals

1. **Package Registry Publishing**
   - Consider publishing to npm registry
   - Configure package.json for npm publish
   - Add npm publishing workflow

2. **Documentation Website** (Optional)
   - Consider GitHub Pages for docs
   - Add user guide separate from README
   - Add API documentation

## Success Criteria

### Functional Requirements

1. **Repository is public**
   - GitHub repository visibility set to public
   - Anyone can clone/fork repository
   - Source code browsable on github.com

2. **License clarity**
   - LICENSE file present in repository root
   - License type clearly stated in README
   - package.json license field matches LICENSE file

3. **Contribution pathway clear**
   - CONTRIBUTING.md exists with setup instructions
   - Issue templates guide bug reports and feature requests
   - PR template guides contributions
   - CI runs tests on all PRs

4. **Documentation complete**
   - README explains what the tool does
   - Installation instructions work for new users
   - Building from source documented
   - Configuration explained

5. **No sensitive data**
   - No API keys in repository or git history
   - No credentials in code
   - No private URLs or references
   - .gitignore covers common secret files

### Non-Functional Requirements

1. **Professional appearance**
   - Clean README with badges
   - Well-organized documentation
   - Welcoming contributor guidelines
   - Clear code of conduct

2. **Low maintenance burden**
   - Automated CI/CD for testing
   - Issue templates reduce back-and-forth
   - Contributing guide reduces common mistakes

3. **Community friendly**
   - Welcoming tone in all documentation
   - Clear expectations for contributions
   - Response time expectations set

## Scope

### In Scope

✅ **Repository Migration**
  - Extract tana directory from KAI monorepo
  - Create new standalone GitHub repository
  - Preserve or filter git history (decision required)
  - Update absolute paths (e.g., /Users/fischer references)
  - Update symlinks (~/.claude/skills/tana)
  - Verify independent build/test process

✅ **Website Updates (store.invisible.ch)**
  - Remove pricing page
  - Remove purchase CTAs and buttons
  - Remove LemonSqueezy integration code
  - Replace purchase flow with GitHub download links
  - Update hero/landing page messaging
  - Add "Open Source" badge/messaging
  - Keep user guide (remove commercial references)

✅ **Open Source Infrastructure**
  - Add LICENSE file (MIT recommended)
  - Create CONTRIBUTING.md
  - Create CODE_OF_CONDUCT.md
  - Create SECURITY.md
  - Add GitHub issue templates
  - Add GitHub PR template
  - Update README.md for public audience
  - Add repository badges (license, version)
  - Security audit (search for credentials)
  - Update .gitignore for secrets
  - Configure GitHub repository settings
  - Add GitHub Actions workflow for CI
  - Review and clean git history if needed

### Out of Scope

❌ Publishing to npm registry (can be done later)
❌ Creating documentation website (can be done later)
❌ Setting up GitHub Discussions (optional)
❌ Adding sponsors/funding (optional)
❌ Translating documentation to other languages
❌ Creating video tutorials or demos
❌ Major refactoring of codebase (do separately)

### Explicitly NOT Changing

- Core functionality of the CLI
- Test suite (except adding CI)
- Build process
- Directory structure
- Package dependencies

## Required Files

### Essential Files

| File | Purpose | Template Source |
|------|---------|-----------------|
| LICENSE | Legal terms for use/distribution | https://choosealicense.com/licenses/mit/ |
| CONTRIBUTING.md | Contributor guidelines | GitHub's guide or Anthropic's example |
| CODE_OF_CONDUCT.md | Community standards | Contributor Covenant v2.1 |
| SECURITY.md | Security policy | GitHub's template |
| .github/ISSUE_TEMPLATE/bug_report.md | Bug report template | GitHub's default |
| .github/ISSUE_TEMPLATE/feature_request.md | Feature request template | GitHub's default |
| .github/pull_request_template.md | PR template | Custom based on project needs |
| .github/workflows/test.yml | CI workflow for tests | Bun + TypeScript example |

### Documentation Updates

| File | Changes Needed |
|------|---------------|
| README.md | Add badges, license section, contributing link, remove commercial URLs |
| package.json | Update license field to "MIT", ensure public: true |
| CHANGELOG.md | Add entry for open source release |
| USER-GUIDE.md | Review for private references |

## Repository Migration Strategy

### Current Location
```
/Users/fischer/work/DA/KAI/skills/tana/
```

**Status**: Subdirectory within KAI private monorepo

**Dependencies**:
- Symlinked to `~/.claude/skills/tana`
- May have imports from parent KAI directories
- Build/test process may depend on monorepo structure
- Git history intertwined with KAI monorepo

### Target Location
```
New standalone repository: github.com/<username>/supertag-cli
```

**Requirements**:
- Completely independent repository
- No dependencies on KAI monorepo
- Own git history (filtered or fresh)
- Standalone build/test process

### Migration Options

#### Option 1: Git Subtree Split (Preserve History)

**Approach**: Use `git subtree` or `git filter-repo` to extract tana directory with history

**Pros**:
- ✅ Preserves commit history
- ✅ Attribution maintained
- ✅ Shows evolution of project

**Cons**:
- ❌ May expose KAI monorepo paths in history
- ❌ Commit messages may reference private issues
- ❌ More complex migration process
- ❌ Larger repository size

**Commands**:
```bash
# Clone KAI repo
git clone /path/to/KAI /tmp/kai-tana-extract

# Filter to only tana directory
cd /tmp/kai-tana-extract
git filter-repo --path skills/tana/ --path-rename skills/tana/:

# Create new remote and push
git remote add origin git@github.com:USERNAME/supertag-cli.git
git push -u origin main
```

#### Option 2: Fresh Repository (Clean Start)

**Approach**: Copy current code to new repository, start fresh git history

**Pros**:
- ✅ Clean history (no KAI references)
- ✅ Simple migration process
- ✅ Smaller repository
- ✅ No risk of exposing private info

**Cons**:
- ❌ Loses commit history
- ❌ No attribution for past work
- ❌ Can't trace evolution of features

**Commands**:
```bash
# Create new repo
mkdir supertag-cli
cd supertag-cli
git init

# Copy files (exclude git history)
rsync -av --exclude='.git' /Users/fischer/work/DA/KAI/skills/tana/ .

# Initial commit
git add .
git commit -m "Initial commit - Supertag CLI v0.12.0"

# Add remote and push
git remote add origin git@github.com:USERNAME/supertag-cli.git
git push -u origin main
```

#### Recommendation: Option 2 (Fresh Start)

**Rationale**:
- No risk of exposing private KAI paths or references
- Simpler migration process
- Clean professional appearance
- History not critical for open source (v0.12.0 is the "public v1.0")

**Decision**: User to confirm preference

### Post-Migration Updates

After extracting/creating repository, update:

1. **Symlinks**
   ```bash
   # Update symlink to point to new location
   rm ~/.claude/skills/tana
   ln -s /path/to/new/supertag-cli ~/.claude/skills/tana
   ```

2. **Absolute paths in code**
   - Search for `/Users/fischer` references
   - Replace with relative paths or environment variables
   - Update any hardcoded paths

3. **Build/test independence**
   - Verify `bun install` works from new location
   - Verify `bun test` passes
   - Verify `bun run build` succeeds
   - No imports from parent directories

4. **Documentation references**
   - Update CLAUDE.md paths
   - Update README installation paths
   - Update any tutorials/guides

## Website Updates (store.invisible.ch)

### Current State

**Location**: `~/work/web/invisible-store/tana/`

**Current Features**:
- Pricing page with tiers/plans
- "Purchase" CTA buttons
- LemonSqueezy checkout integration
- Commercial messaging ("Buy now", "Start trial", etc.)
- License activation instructions

### Required Changes

#### 1. Landing Page (index.html)

**Remove**:
- Pricing section
- "Purchase" buttons
- "Start free trial" CTAs
- LemonSqueezy integration scripts

**Add**:
- "Download" button → links to GitHub releases
- "Open Source" badge/banner
- GitHub repository link
- "Free and Open Source" messaging

**Update**:
- Hero text: "Free and open source CLI for Tana integration"
- Feature descriptions (remove "premium", "pro" tier mentions)

#### 2. Pricing Page (pricing.html or similar)

**Action**: Delete entirely or convert to "Download" page

**If converting**:
- Show installation options (macOS, Linux, Windows)
- Link to GitHub releases page
- Show "Building from source" instructions
- No pricing information

#### 3. User Guide (guide.html / USER-GUIDE.md)

**Remove**:
- License activation steps
- "Activate your license" instructions
- Trial period warnings
- Purchase links

**Keep**:
- Installation instructions (update download links to GitHub)
- Usage examples
- Command reference
- Configuration guide

#### 4. CHANGELOG Page

**Update**:
- Sync with repository CHANGELOG.md
- Add entry for v0.12.0 (licensing removal + open source)
- Remove references to "premium features" if any

#### 5. JavaScript/Integration Code

**Remove**:
- LemonSqueezy checkout scripts
- License validation code
- Purchase flow logic
- Analytics tracking for purchases (keep usage analytics if desired)

**Update**:
- Download button handlers → link to GitHub releases
- Remove any API calls to LemonSqueezy

### Website File Changes Summary

| File | Action | Changes |
|------|--------|---------|
| index.html | Modify | Remove pricing, add download links, add open source messaging |
| pricing.html | Delete or convert | Remove entirely or convert to "Download" page |
| guide.html | Modify | Remove activation instructions, update download links |
| CHANGELOG.md | Modify | Sync with repo, add v0.12.0 entry |
| *.js files | Modify | Remove LemonSqueezy integration, update download handlers |
| style.css | Modify | Remove pricing-related styles (optional cleanup) |

### Post-Website-Update Verification

- [ ] No broken links (all URLs point to valid pages)
- [ ] Download buttons link to GitHub releases
- [ ] No pricing information visible
- [ ] No purchase/checkout flows
- [ ] No LemonSqueezy scripts or integration code
- [ ] User guide has no activation instructions
- [ ] "Open Source" clearly communicated
- [ ] GitHub repository linked prominently

## User Journeys

### Journey 1: Developer Discovers Project

**Current (Private):**
1. Developer hears about Supertag CLI
2. Searches GitHub - repository not found or not accessible
3. Must trust binary downloads or skip tool

**Future (Open Source):**
1. Developer hears about Supertag CLI
2. Searches GitHub - finds public repository
3. Reads README - understands purpose, sees MIT license
4. Reads code - audits security, understands implementation
5. Clones and builds from source
6. Trusts tool because code is auditable

### Journey 2: Developer Finds a Bug

**Current (Private):**
1. Developer finds a bug
2. No way to report it publicly
3. May report via email or support (if available)
4. Cannot see if bug is fixed or when

**Future (Open Source):**
1. Developer finds a bug
2. Opens GitHub Issues
3. Uses bug report template to provide details
4. Community/maintainer responds
5. Can track fix progress in pull request
6. Can verify fix in next release

### Journey 3: Developer Wants to Contribute

**Current (Private):**
1. Developer wants to add a feature
2. No access to source code
3. Cannot contribute

**Future (Open Source):**
1. Developer wants to add a feature
2. Reads CONTRIBUTING.md - learns how to set up dev environment
3. Forks repository
4. Implements feature with tests (TDD required)
5. Opens pull request using PR template
6. CI runs tests automatically
7. Maintainer reviews and merges
8. Feature available to all users

### Journey 4: Organization Evaluates Tool for Use

**Current (Private):**
1. Organization considers Supertag CLI
2. Cannot audit source code
3. Security team blocks usage (no code review possible)
4. Cannot verify license terms clearly

**Future (Open Source):**
1. Organization considers Supertag CLI
2. Audits source code for security
3. Reviews MIT license - compatible with company policy
4. Security team approves (auditable code)
5. Organization adopts tool

## License Selection

### Recommended: MIT License

**Rationale:**
- **Maximum permissiveness**: Allows commercial and private use
- **Simple and short**: Easy to understand
- **Compatible with everything**: No viral/copyleft restrictions
- **Industry standard**: Well-known and accepted
- **Minimal attribution**: Just preserve copyright notice

**MIT License allows users to:**
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Use privately
- ✅ Sublicense
- ✅ No patent grant concerns

**Alternatives considered:**
- Apache 2.0: More explicit patent grant, longer license text
- GPL: Copyleft requirement may limit adoption
- BSD: Similar to MIT, slightly different wording

**Decision**: MIT (unless user prefers alternative)

## Contributor Guidelines Structure

### CONTRIBUTING.md Sections

1. **Welcome & Thank You**
   - Welcoming message for contributors
   - Types of contributions accepted

2. **Development Setup**
   - Prerequisites (Bun, Node.js version)
   - Clone and install instructions
   - Environment setup

3. **Running Tests**
   - How to run test suite: `bun test`
   - How to run specific tests
   - Coverage requirements

4. **Making Changes**
   - TDD workflow requirement (constitutional)
   - Code style (TypeScript, Bun conventions)
   - Commit message format
   - Branch naming

5. **Submitting Pull Requests**
   - PR checklist (tests pass, docs updated)
   - PR description requirements
   - Review process expectations

6. **Reporting Bugs**
   - Link to issue template
   - Information to include

7. **Requesting Features**
   - Link to feature request template
   - Feature proposal process

8. **Code of Conduct**
   - Link to CODE_OF_CONDUCT.md
   - Expected behavior

## Security Audit Checklist

### Pre-Release Security Review

- [ ] Search codebase for "api_key", "secret", "password", "token" hardcoded values
- [ ] Review .env.example vs .env (ensure .env is gitignored)
- [ ] Check git history for accidentally committed credentials: `git log -p | grep -i "password\|secret\|api_key"`
- [ ] Verify no Tana API tokens in code (should be config-only)
- [ ] Verify no LemonSqueezy API keys (removed with licensing spec)
- [ ] Check for TODO/FIXME comments with sensitive info
- [ ] Review package.json scripts for hardcoded URLs with credentials
- [ ] Verify no absolute paths to user directories (e.g., /Users/fischer)
- [ ] Check release.sh for credentials or private URLs
- [ ] Review CHANGELOG.md for mentions of private systems

### .gitignore Additions

Ensure .gitignore includes:
```
# Secrets
.env
.env.local
*.key
*.pem
credentials.json
secrets.json

# Local config
config.local.json
.config/

# Database
*.db
*.sqlite
*.sqlite3

# Logs
*.log
logs/

# Build artifacts
dist/
build/
*.tgz

# Dependencies
node_modules/

# OS files
.DS_Store
Thumbs.db
```

## GitHub Repository Configuration

### Repository Settings

| Setting | Value |
|---------|-------|
| Visibility | Public |
| Description | "CLI tool for Tana integration - query, create, sync, and manage Tana workspaces with semantic search" |
| Website | (Optional) Link to docs or invisible.ch |
| Topics | tana, cli, knowledge-management, typescript, bun, sqlite, mcp, semantic-search |
| Features | Issues: ✅, Wiki: ❌, Discussions: Optional |
| Branch Protection | main: require PR reviews, require status checks |

### GitHub Actions Workflow

**File**: `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: bun test
```

## README.md Updates

### Add Badges Section (Top of README)

```markdown
# Supertag CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/USERNAME/REPO/actions/workflows/test.yml/badge.svg)](https://github.com/USERNAME/REPO/actions/workflows/test.yml)
[![Version](https://img.shields.io/github/v/release/USERNAME/REPO)](https://github.com/USERNAME/REPO/releases)
```

### Add License Section (Bottom of README)

```markdown
## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Security

For security issues, please see [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.
```

## Assumptions

1. **Single maintainer initially** - User (Jens-Christian Fischer) is primary maintainer
2. **Low contribution volume at start** - Can adjust processes as community grows
3. **English only** - Documentation in English, translations can come later
4. **GitHub platform** - Repository hosted on GitHub (not GitLab, Bitbucket, etc.)
5. **No paid features** - Fully open source, no premium tiers
6. **No CLA required** - Simple contribution workflow without Contributor License Agreement
7. **Bun ecosystem** - Contributors expected to use Bun (not npm/yarn/pnpm)

## Dependencies

### Prerequisite Specs

- `remove-licensing` spec MUST be completed first
  - No point in open sourcing with licensing code still present
  - Avoids confusion about commercial vs open source

### External Dependencies

- GitHub repository (existing or new)
- GitHub account with repository admin access
- No domain name required (can use github.io if needed)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Low-quality contributions | Medium | Clear CONTRIBUTING.md, require tests, use PR reviews |
| Security vulnerabilities reported publicly | High | SECURITY.md with private reporting instructions |
| Spam/abuse in issues | Medium | GitHub's moderation tools, CODE_OF_CONDUCT.md |
| Maintenance burden increases | Medium | Set response time expectations, label system for prioritization |
| Sensitive data in git history | Critical | Audit before release, rewrite history if needed (destructive) |
| License confusion | Low | Clear LICENSE file, badge in README |
| Fork ecosystem fragmentation | Low | Encourage PRs back to main repo in CONTRIBUTING.md |

## Open Questions

1. ❓ **Repository migration strategy** - Preserve history or fresh start?
   - **Option A**: Git subtree split (preserves history, may expose KAI paths)
   - **Option B**: Fresh repository (clean start, loses history)
   - **Recommendation**: Option B (fresh start) - cleaner, no risk of exposing private info
   - **Decision**: OptionB

2. ❓ **New repository location** - Where to create the standalone repository?
   - **Options**:
     - `~/Projects/supertag-cli` (alongside other projects)
     - `~/work/supertag-cli` (in work directory)
     - Completely different location
   - **Decision**: ~/work/supertag-cli

3. ❓ **Repository name** - What should the GitHub repository be called?
   - **Options**:
     - `supertag-cli` (matches binary name)
     - `tana-cli` (matches current directory)
     - `supertag` (shorter, cleaner)
   - **Recommendation**: `supertag-cli` (clear and descriptive)
   - **Decision**: supertag-cli

4. ❓ Which GitHub organization/user should host the repository?
   - **Options**: Personal account, dedicated organization, PAI organization
   - **Decision**: Personal Accocunt

5. ❓ **Website strategy** - What to do with store.invisible.ch?
   - **Option A**: Remove pricing, keep as landing page with download links
   - **Option B**: Redirect to GitHub repository entirely
   - **Option C**: Convert to documentation site
   - **Recommendation**: Option A (keep as landing page, remove pricing)
   - **Decision**: Option A

6. ❓ Should we enable GitHub Discussions for community Q&A?
   - **Recommendation**: Start with Issues only, add Discussions if community grows
   - **Decision**: Issues only for now

7. ❓ Should we publish to npm registry immediately?
   - **Recommendation**: Wait until after open source release, validate with community first
   - **Decision**: wait

8. ❓ Should we rewrite git history to remove any sensitive data, or is current history clean?
   - **Action**: Audit during planning phase (likely moot if choosing fresh start)
   - **Decision**: should be clean

9. ❓ Should we set up GitHub Sponsors or similar funding mechanism?
   - **Recommendation**: Not initially - focus on community building first
   - **Decision**: no

10. ❓ Should we create a separate documentation website (GitHub Pages)?
    - **Recommendation**: Start with README only, add docs site if community requests
    - **Decision**: Out of scope for this spec

## Out of Scope for This Spec

- npm publishing workflow (separate effort)
- Documentation website (can be added later)
- Video tutorials or demos (can be added later)
- Community growth strategies (marketing, promotion)
- Governance model for large contributor base (premature)
- Translation to other languages (can be added later)
- Sponsorship or funding setup (separate decision)

## Validation Criteria

This specification is complete when:

- [ ] License type chosen and approved
- [ ] All required files identified
- [ ] Security audit checklist defined
- [ ] Documentation updates scoped
- [ ] GitHub configuration planned
- [ ] Risks identified and mitigation planned
- [ ] User journeys demonstrate value of open sourcing
- [ ] Dependency on `remove-licensing` spec acknowledged
- [ ] Ready to move to PLAN phase

## Next Steps

1. **User Approval**
   - Review this specification
   - Choose license type (MIT recommended)
   - Decide on repository location (organization/user)
   - Answer open questions

2. **Complete Prerequisites**
   - Finish `remove-licensing` spec first
   - Ensure no commercial/licensing code in repository

3. **Move to PLAN Phase** (`/speckit.plan`)
   - Create technical plan for each file to add/modify
   - Plan security audit execution
   - Plan git history review (if needed)
   - Plan GitHub configuration steps

4. **Move to TASKS Phase** (`/speckit.tasks`)
   - Break plan into reviewable units
   - Identify parallel tasks (docs vs templates vs CI)
   - Mark testing requirements

5. **Move to IMPLEMENT Phase** (`/speckit.implement`)
   - Execute with file creation workflow
   - Validate each template/document
   - Test CI workflow
   - Perform final security audit before making public

---

**Specification Status**: ✅ Ready for Review
**Approver**: User
**Next Phase**: PLAN (after approval and `remove-licensing` completion)
