# Specification: Remove Time Bombing and Lemon Squeezy License Integration

**Status**: Completed
**Created**: 2025-12-20
**Completed**: 2025-12-20
**Phase**: COMPLETED

## Executive Summary

Remove all trial period time bombing and Lemon Squeezy licensing integration from Supertag CLI, converting it to a fully open tool without usage restrictions or license checks.

## Background

The Supertag CLI currently includes:

1. **Time Bombing** (`src/trial.ts`): Hardcoded trial expiry date (2026-01-01) that blocks all CLI usage after expiration
2. **Lemon Squeezy Integration** (`src/license/`): Complete licensing system with activation, deactivation, validation, and enforcement

These systems were implemented for commercial distribution but are no longer needed.

## Problem Statement

**Current State:**
- Users face trial expiration blocking all CLI functionality
- License activation required for most commands (except `activate`, `deactivate`, `license`, `help`, `version`)
- License validation checks run on every CLI invocation
- Help text displays trial status messages
- Code complexity from dual licensing/trial enforcement systems

**Desired State:**
- Zero usage restrictions - all commands available to all users
- No trial expiry checks or license validation
- Simplified codebase without licensing infrastructure
- Clean help text without trial/license messaging
- No network calls to Lemon Squeezy API

## User Impact

### Before Removal

**Trial Users:**
```bash
$ supertag query search "meeting"
⛔ TRIAL EXPIRED
This trial version expired on January 1, 2026.
To continue using Supertag CLI, please purchase a license at:
https://store.invisible.ch/tana
```

**Licensed Users:**
```bash
$ supertag query search "meeting"
# Performs license check (network call every N days)
# Then executes query
```

### After Removal

**All Users:**
```bash
$ supertag query search "meeting"
# Executes immediately, no checks
```

## Goals

### Primary Goals

1. **Remove Trial Time Bombing**
   - Delete all trial expiry enforcement code
   - Remove trial status from help text
   - Eliminate hardcoded expiry dates

2. **Remove Lemon Squeezy Integration**
   - Delete all license management code
   - Remove license activation/deactivation commands
   - Eliminate license validation logic
   - Remove license status from CLI

3. **Simplify CLI Startup**
   - No license checks on command execution
   - No trial expiry enforcement
   - Direct command execution

### Secondary Goals

1. **Clean Up Dependencies**
   - Remove any Lemon Squeezy API dependencies
   - Eliminate license storage/config files

2. **Update Documentation**
   - Remove license-related help text
   - Remove activation instructions
   - Update README to reflect open tool status

## Success Criteria

### Functional Requirements

1. **All commands work without restrictions**
   - Every CLI command executes without license checks
   - No trial expiry blocking
   - No activation required

2. **Removed commands**
   - `supertag activate <key>` - removed (command no longer exists)
   - `supertag deactivate` - removed (command no longer exists)
   - `supertag license status` - removed (command no longer exists)

3. **Clean startup**
   - CLI starts instantly without validation
   - No network calls to licensing API
   - No trial status messages

### Non-Functional Requirements

1. **Code Cleanliness**
   - All trial/license code removed (not commented out)
   - No dead code or unused imports
   - Test suite updated and passing

2. **User Experience**
   - Help text clean without trial/license messaging
   - Version command works (shows version only)
   - No confusing error messages about licenses

## Scope

### In Scope

✅ Remove `src/trial.ts` completely
✅ Remove `src/license/` directory completely
✅ Remove `src/commands/license.ts` completely
✅ Remove trial/license checks from `src/index.ts`
✅ Remove trial/license imports from `src/index.ts`
✅ Remove license commands from CLI help
✅ Update help text to remove trial status
✅ Remove license-related tests
✅ Update build scripts if needed

### Out of Scope

❌ Changing core CLI functionality (query, sync, create, etc.)
❌ Modifying data models or database schemas
❌ Changing configuration file format (except license storage)
❌ Updating MCP server (unless it has license checks)
❌ Modifying export functionality

### Explicitly NOT Changing

- All query commands work unchanged
- All sync commands work unchanged
- All create commands work unchanged
- All server commands work unchanged
- All workspace commands work unchanged
- All embed commands work unchanged
- Configuration system (except license storage)
- Database structure
- API endpoints (Tana Input API)

## User Journeys

### Journey 1: New User Installation

**Current (With Licensing):**
1. User downloads CLI
2. Runs `supertag query search "test"`
3. Sees trial expiry warning or license requirement
4. Must activate license or wait for trial expiry
5. Can use CLI within trial period

**Future (Without Licensing):**
1. User downloads CLI
2. Runs `supertag query search "test"`
3. Query executes immediately
4. Full access to all features

### Journey 2: Existing User After Trial Expiry

**Current (With Time Bombing):**
1. User's trial expires (2026-01-01)
2. Runs any command
3. Gets blocked with expiry message
4. Must purchase license to continue
5. Must run `supertag activate <key>`
6. Can use CLI again

**Future (Without Time Bombing):**
1. User continues using CLI
2. Runs any command
3. Command executes normally
4. No interruption ever

### Journey 3: Developer Contributing to Project

**Current (With Licensing):**
1. Clone repository
2. Build from source: `bun run build`
3. Binary includes trial expiry check
4. Must understand/modify `src/trial.ts` to extend expiry for development
5. Can test changes

**Future (Without Licensing):**
1. Clone repository
2. Build from source: `bun run build`
3. Binary works immediately
4. Test changes without workarounds

## Assumptions

1. **No refunds needed** - Existing license holders understand the tool is becoming free/open
2. **No migration path needed** - Existing users just get unrestricted access
3. **License files can be ignored** - Existing `~/.local/share/supertag/license.json` files harmless if left in place
4. **Build system unchanged** - Compilation process doesn't depend on trial/license code
5. **MCP server clean** - No license checks in `src/mcp/` (needs verification)

## Dependencies

### Code Dependencies

- `src/trial.ts` imported by `src/index.ts`
- `src/license/index.ts` imported by `src/index.ts`
- `src/commands/license.ts` imported by `src/index.ts`

### External Dependencies

- Lemon Squeezy API (network calls) - can be removed
- License storage files (`~/.local/share/supertag/license.json`) - can be left orphaned

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing users | High | Existing users benefit - unrestricted access |
| Orphaned license files | Low | Files ignored if present, no cleanup needed |
| Tests failing after removal | Medium | Update tests to remove license/trial assertions |
| Documentation outdated | Medium | Update README, CHANGELOG, USER-GUIDE |
| Build scripts broken | Low | Verify build still works after file removal |

## Open Questions

1. ❓ Should we remove orphaned license files during migration, or leave them?
   - **Recommendation**: Leave them - harmless and avoids user data deletion
   - **Decision**: LEAVE ORPHANED FILES

2. ❓ Should we keep license configuration for future potential use?
   - **Recommendation**: No - clean removal, can restore from git if needed
   - **Decision**: COMPLETE REMOVAL

3. ✅ Does the MCP server (`supertag-mcp`) have any license checks?
   - **Answer**: NO - MCP server is clean, no license/trial references

4. ✅ Are there any license checks in test files?
   - **Answer**: NO - Test files are clean, no license/trial assertions

5. ❓ Should version number change significantly (e.g., 1.0.0) to signal "no longer trial"?
   - **Recommendation**: Minor bump (0.11.5 → 0.12.0) with "Remove licensing" in CHANGELOG
   - **Decision**: User to decide

## Out of Scope for This Spec

- Changing version number (handled in release process)
- Updating marketing website at `~/work/web/invisible-store/tana/`
- Notifying existing license holders
- Removing distribution from Lemon Squeezy store

## Validation Criteria

This specification is complete when:

- [ ] All stakeholders understand what will be removed
- [ ] Scope is clear (what changes, what doesn't)
- [ ] User journeys document before/after experience
- [ ] Risks identified and mitigation planned
- [ ] Open questions answered or escalated
- [ ] Ready to move to PLAN phase

## Next Steps

1. **Resolve Open Questions**
   - Search MCP server for license checks
   - Search tests for license assertions
   - Decide on version numbering

2. **Move to PLAN Phase** (`/speckit.plan`)
   - Create technical implementation plan
   - Identify all files to delete
   - Identify all imports to remove
   - Plan test updates

3. **Move to TASKS Phase** (`/speckit.tasks`)
   - Break plan into reviewable units
   - Identify parallel vs sequential tasks
   - Mark test requirements

4. **Move to IMPLEMENT Phase** (`/speckit.implement`)
   - Execute with TDD workflow
   - Run full test suite after each change
   - Update documentation

---

**Specification Status**: ✅ Ready for Review
**Approver**: User
**Next Phase**: PLAN (after approval)
