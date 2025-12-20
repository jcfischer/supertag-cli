# Technical Plan: Remove Time Bombing and Lemon Squeezy License Integration

**Status**: Draft
**Created**: 2025-12-20
**Phase**: PLAN
**Spec**: remove-licensing/spec.md

## Architecture Overview

This is a **code deletion** task with minimal refactoring. The licensing system is self-contained in dedicated modules with limited coupling to core functionality. Removal strategy:

1. **Delete** 7 files completely (no commenting, clean removal)
2. **Modify** 4 files to remove imports and function calls
3. **Verify** no broken imports or dead code remains
4. **Test** that all commands execute without license checks

### Architectural Decision: Clean Deletion vs Feature Flags

**Decision**: Clean deletion of all licensing code

**Rationale**:
- Licensing is being permanently removed (not temporarily disabled)
- No business requirement to re-enable licensing
- Git history preserves code if ever needed again
- Feature flags add complexity without value
- Simpler codebase is easier to maintain and contribute to

**Alternative considered**: Feature flags to toggle licensing
- ❌ Rejected: Adds conditional complexity throughout codebase
- ❌ Rejected: Makes testing more complex (test both paths)
- ❌ Rejected: No clear use case for re-enabling

## Files to Delete

Complete removal of these files (no git trace needed, just delete):

```
src/trial.ts                    # Trial period time bombing
src/license/index.ts            # Main license management
src/license/api.ts              # LemonSqueezy API integration
src/license/config.ts           # License configuration
src/license/storage.ts          # License file storage
src/license/types.ts            # License type definitions
src/commands/license.ts         # License CLI commands
```

**Total**: 7 files

**Verification**: After deletion, run `git status` to ensure all files marked as deleted.

## Files to Modify

### 1. `src/index.ts` - Main CLI Entry Point

**Current State**: Lines 24, 26, 29, 42, 146-168, 226-229, 341-367

**Changes Required**:

#### Remove Imports (Lines 24, 26, 29)
```typescript
// DELETE these lines:
import { createLicenseCommand, activateCommand, deactivateCommand } from './commands/license';
import { checkLicense, commandRequiresLicense } from './license';
import { enforceTrialExpiry, getTrialStatusMessage } from './trial';
```

#### Update Program Description (Line 42)
```typescript
// BEFORE:
.description(`Supertag CLI - read, write, sync, and serve Tana data\n\n  ${getTrialStatusMessage()}`)

// AFTER:
.description('Supertag CLI - read, write, sync, and serve Tana data')
```

#### Remove License Commands (Lines 146-168)
```typescript
// DELETE these command registrations:
program.addCommand(createLicenseCommand());   // tana license status

/**
 * Activate Command (top-level for convenience)
 */
program
  .command('activate <key>')
  .description('Activate license key')
  .option('-n, --name <name>', 'Custom name for this installation')
  .action(async (key, options) => {
    await activateCommand(key, options);
  });

/**
 * Deactivate Command (top-level for convenience)
 */
program
  .command('deactivate')
  .description('Deactivate license on this device')
  .action(async () => {
    await deactivateCommand();
  });
```

#### Remove License from Help Text (Lines 226-229)
```typescript
// DELETE this section from --help:
console.log('  LICENSE:');
console.log('    supertag activate <key>        Activate license key');
console.log('    supertag deactivate            Deactivate this device');
console.log('    supertag license status        Show license status');
```

#### Remove License Check from main() (Lines 341-367)
```typescript
// BEFORE:
async function main() {
  // Check trial expiry first (blocks all commands if expired)
  enforceTrialExpiry();

  const args = process.argv.slice(2);
  const firstArg = args[0] || '';

  // Check if this command requires a license
  if (commandRequiresLicense(firstArg)) {
    const result = await checkLicense();

    if (!result.valid) {
      console.error('');
      console.error(`❌ License Error: ${result.error}`);
      console.error('');

      if (result.needsActivation) {
        console.error('To activate your license:');
        console.error('  tana activate <your-license-key>');
        console.error('');
        console.error('Purchase a license at: https://YOUR_LEMONSQUEEZY_URL');
        console.error('');
      }

      process.exit(1);
    }
  }

  // Parse and execute commands
  program.parse();
}

// AFTER:
async function main() {
  // Parse and execute commands
  program.parse();
}
```

**Line Count Impact**:
- Imports removed: 3 lines
- Description simplified: 1 line changed
- Commands removed: ~23 lines
- Help text removed: 4 lines
- main() simplified: ~26 lines removed

**Total reduction**: ~56 lines removed from `src/index.ts`

---

### 2. `export/index.ts` - Export CLI

**Current State**: Line 36

**Changes Required**:

#### Remove Imports (Line 36)
```typescript
// DELETE this line:
import { enforceTrialExpiry, getTrialStatusMessage } from "../src/trial";
```

#### Find and Remove Trial Check in main()

**Search pattern**: `enforceTrialExpiry()`

After removing import, search for usage and remove. Expected location: near program setup or main function.

**Action**: Read file to locate trial enforcement call, then remove it.

---

### 3. `CHANGELOG.md` - Release History

**Current State**: Line 545-548 (may be in different location depending on version)

**Changes Required**:

Search for license-related entries and update:

```markdown
// FIND sections mentioning:
- LemonSqueezy License System
- License key activation
- supertag activate
- supertag license status

// ADD new entry at top:
## [0.12.0] - 2025-12-XX

### Removed
- Time bombing trial system - CLI no longer expires
- LemonSqueezy license integration - all commands now free and unrestricted
- License activation/deactivation commands
- License validation on CLI startup

### Changed
- All commands now execute without license checks
- Simplified CLI startup (no network calls for validation)
- Removed trial status from help text
```

**Note**: Update the `[Unreleased]` section or create new version section as appropriate.

---

### 4. `release.sh` - Release Script

**Current State**: Line 266

**Changes Required**:

```bash
# FIND (around line 266):
echo "Remaining manual step:"
echo "  - Update LemonSqueezy product files if needed"

# REPLACE with:
echo "Remaining manual steps:"
echo "  - Tag release on GitHub: git tag v${VERSION} && git push --tags"
```

Also check for any other LemonSqueezy references:

```bash
# SEARCH for:
grep -n -i "lemon" release.sh

# If found in comments (line 18 "Copies to kDrive for LemonSqueezy delivery"):
# UPDATE line 18:
# 4. Copies to kDrive for distribution
```

---

### 5. `README.md` - Documentation

**Changes Required**: Remove license activation instructions

**Search for**:
- "activate"
- "license"
- "trial"
- LemonSqueezy URLs

**Expected sections to update**:

```markdown
// REMOVE section like:
## License Activation

To use Supertag CLI, activate your license key:

\`\`\`bash
supertag activate <your-license-key>
\`\`\`

Check license status:

\`\`\`bash
supertag license status
\`\`\`

// UPDATE any "Getting Started" sections that mention activation
// BEFORE:
1. Install the CLI
2. Activate your license: `supertag activate <key>`
3. Run commands

// AFTER:
1. Install the CLI
2. Run commands
```

**Action**: Will be determined after reading README.md during implementation

---

## Modified Files Summary

| File | Lines Changed | Type |
|------|--------------|------|
| `src/index.ts` | ~56 lines removed | Imports, commands, help text, license check |
| `export/index.ts` | ~5 lines removed | Imports, trial check call |
| `CHANGELOG.md` | ~10 lines added | Release notes for removal |
| `release.sh` | ~2 lines changed | Update manual steps |
| `README.md` | TBD (read during impl) | Remove activation instructions |

## Dependencies and Build System

### Package Dependencies

**Check `package.json` for license-related dependencies**:

```bash
# Search for LemonSqueezy or license validation libraries
grep -i "lemon\|license" package.json
```

**Expected**: No external dependencies for licensing (likely just internal modules)

**Action**: Verify during implementation, remove if any exist

### Build Scripts

**`package.json` scripts check**:

```json
// Check for license-related scripts:
"scripts": {
  // Unlikely to have license-specific scripts, but verify
}
```

**Expected**: No changes needed to build scripts

**Verify**: `bun run build` still works after file deletion

---

## Testing Strategy

### Constitutional Compliance: TDD

Since this is a **deletion** task (not adding features), TDD is adapted:

1. **Document current behavior** (tests would fail if licensing removed prematurely)
2. **Remove code** (delete files, remove imports)
3. **Verify tests still pass** (or update tests if they check for license commands)

### Test Plan

**Phase 1: Pre-Deletion Verification**

```bash
# Verify current tests pass
bun test

# Document current command behavior
./supertag --help | grep -E "activate|license|trial"
./supertag-export --help | grep -E "trial"
```

**Phase 2: Post-Deletion Verification**

```bash
# 1. Verify no broken imports
bun run src/index.ts --help
# Should not crash with "Cannot find module" errors

# 2. Verify commands work
./supertag query search "test"
./supertag schema list
./supertag workspace list

# 3. Verify help text clean
./supertag --help | grep -E "activate|license|trial"
# Should return nothing (no license commands)

# 4. Verify build works
bun run build
./supertag --version

# 5. Run test suite
bun test
# All tests should pass (or update tests that check for license commands)
```

**Phase 3: Test Suite Updates**

Search for license-related tests:

```bash
# Find test files that might reference licensing
grep -r "license\|trial\|activate" tests/
grep -r "license\|trial\|activate" src/**/*.test.ts
```

**Expected**: No license tests found (verified in spec phase)

**If found**: Update tests to remove license assertions

---

## Constitutional Compliance Check

### PAI Constitution Alignment

**Test-Driven Development**:
- ✅ Deletion task - verify tests pass before and after
- ✅ Document expected behavior (no license checks)
- ✅ Verify implementation matches specification

**CLI-First Architecture**:
- ✅ No changes to core architecture
- ✅ CLI commands remain deterministic
- ✅ No new prompts or AI-driven code

**Simplicity Over Complexity**:
- ✅ Removing code reduces complexity
- ✅ No abstractions added
- ✅ Clean deletion without feature flags

**Security**:
- ✅ No credentials in code (license system removal doesn't expose secrets)
- ✅ No network calls to LemonSqueezy API after removal
- ✅ License files orphaned but harmless (`~/.local/share/supertag/license.json`)

---

## Migration and Backwards Compatibility

### User Impact

**No migration needed**: Users benefit immediately
- Trial users: No more expiry blocking
- Licensed users: No change in functionality (still works, just no validation)
- New users: Download and use immediately

### Orphaned Files

**License storage files** may exist on user systems:

```
~/.local/share/supertag/license.json
~/.local/share/supertag/license-validation-cache.json
```

**Decision**: Leave these files in place
- Harmless (no longer read by code)
- Avoids user data deletion concerns
- Users can manually delete if desired

**Documentation**: Add note in CHANGELOG that license files are no longer used

---

## Risk Mitigation

### Risk 1: Broken Imports After Deletion

**Risk**: Deleting `src/license/` and `src/trial.ts` breaks import statements

**Mitigation**:
1. Search entire codebase for imports before deletion
2. Remove all imports in same commit as file deletion
3. Verify with TypeScript compiler (`bun run src/index.ts --help`)

**Verification**:
```bash
# After deletion, search for broken imports
grep -r "from.*license" src/
grep -r "from.*trial" src/
grep -r "from.*license" export/

# Should return nothing
```

### Risk 2: Tests Fail After Removal

**Risk**: Test suite expects license commands to exist

**Mitigation**:
1. Pre-verified: no license tests exist (grep search in spec phase)
2. Run full test suite after changes: `bun test`
3. Update any failing tests

**Verification**:
```bash
bun test --verbose
# All tests should pass
```

### Risk 3: Build Process Breaks

**Risk**: Build scripts depend on license files

**Mitigation**:
1. Test build after deletion: `bun run build`
2. Test all platform builds: `./release.sh --dry-run` (if such flag exists)
3. Verify compiled binaries work: `./supertag --version`

**Verification**:
```bash
bun run build
./supertag --help
./supertag query search "test"
```

### Risk 4: Export CLI Breaks

**Risk**: `export/index.ts` has trial check that crashes when removed

**Mitigation**:
1. Read full `export/index.ts` to find trial enforcement location
2. Remove trial check call along with import
3. Test export CLI: `./export/supertag-export status`

**Verification**:
```bash
bun run export/index.ts --help
# Should not crash, should show help
```

---

## Implementation Order

### Sequential Tasks (cannot parallelize)

**Order matters** because imports must be removed before files are deleted:

1. **Remove imports from `src/index.ts`** (lines 24, 26, 29)
2. **Remove imports from `export/index.ts`** (line 36)
3. **Delete license files** (7 files in `src/license/` and `src/trial.ts`)
4. **Remove license command registrations** from `src/index.ts` (lines 146-168)
5. **Remove license check from `main()`** in `src/index.ts` (lines 341-367)
6. **Remove trial check from export CLI** `export/index.ts` (find and remove call)
7. **Update program description** in `src/index.ts` (line 42)
8. **Remove license help text** from `src/index.ts` (lines 226-229)
9. **Update CHANGELOG.md** (add removal entry)
10. **Update release.sh** (remove LemonSqueezy references)
11. **Update README.md** (remove activation instructions)
12. **Run full test suite** (`bun test`)
13. **Test build process** (`bun run build`)
14. **Test CLI functionality** (query, sync, create commands)

**Rationale for order**:
- Steps 1-2: Remove imports first (prevents "unused import" errors)
- Step 3: Delete files after imports removed
- Steps 4-8: Clean up function calls and UI references
- Steps 9-11: Documentation updates
- Steps 12-14: Verification

**Estimated time**: 30-45 minutes of careful editing and testing

---

## Verification Checklist

After implementation, verify:

- [ ] No files in `src/license/` directory exist
- [ ] No `src/trial.ts` file exists
- [ ] No `src/commands/license.ts` file exists
- [ ] No imports of `license` or `trial` in codebase: `grep -r "from.*license\|from.*trial" src/ export/`
- [ ] `bun run src/index.ts --help` executes without errors
- [ ] Help text has no "activate", "deactivate", or "license" commands
- [ ] `./supertag query search "test"` works without license check
- [ ] `bun test` passes all tests
- [ ] `bun run build` succeeds
- [ ] `./supertag --version` displays version
- [ ] `./export/supertag-export --help` works without trial check
- [ ] CHANGELOG.md has entry documenting removal
- [ ] README.md has no activation instructions
- [ ] release.sh has no LemonSqueezy references

---

## Rollback Plan

**If implementation fails**, rollback strategy:

```bash
# Restore from git
git checkout src/trial.ts
git checkout src/license/
git checkout src/commands/license.ts
git checkout src/index.ts
git checkout export/index.ts

# Verify restoration
bun test
```

**Prevention**: Work on a branch, not main

```bash
git checkout -b remove-licensing
# Make all changes
# Test thoroughly
# Only merge to main when verified
```

---

## Documentation Updates Required

### Internal Documentation (This Repo)

| File | Update Required |
|------|----------------|
| CHANGELOG.md | Add removal entry |
| README.md | Remove activation instructions |
| CLAUDE.md | Update if it mentions licensing (check during impl) |
| SKILL.md | Update if it mentions licensing (check during impl) |

### External Documentation (Out of Scope)

These are **out of scope** for this spec (covered in `opensource-repository` spec):

- `~/work/web/invisible-store/tana/` - Marketing website
- `~/work/web/invisible-store/tana/CHANGELOG.md` - Public changelog
- `~/work/web/invisible-store/tana/USER-GUIDE.md` - User guide
- LemonSqueezy product pages - Store listings

---

## Success Criteria (Technical)

Implementation is complete when:

1. **All 7 files deleted** from repository
2. **No broken imports** in any TypeScript file
3. **Test suite passes** (`bun test` all green)
4. **Build succeeds** (`bun run build` no errors)
5. **CLI works** (can run query, sync, create commands)
6. **Help text clean** (no license commands visible)
7. **No license checks** (commands execute immediately)
8. **CHANGELOG updated** with removal notes
9. **README updated** (no activation instructions)
10. **release.sh updated** (no LemonSqueezy refs)

---

## Next Phase

After this plan is approved, move to **TASKS phase**:

```bash
/speckit.tasks
```

This will break the plan into reviewable task units (T-1.1, T-1.2, etc.) with:
- Dependencies marked
- Parallel tasks marked `[P]`
- Test requirements marked `[T]`

**Then proceed to IMPLEMENT phase** with TDD workflow.

---

**Plan Status**: ✅ Ready for Review
**Approver**: User
**Next Phase**: TASKS (after approval)
