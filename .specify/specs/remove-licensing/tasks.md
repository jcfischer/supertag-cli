# Tasks: Remove Time Bombing and Lemon Squeezy License Integration

**Status**: Draft
**Created**: 2025-12-20
**Phase**: TASKS
**Spec**: remove-licensing/spec.md
**Plan**: remove-licensing/plan.md

## Task Overview

**Total Tasks**: 14
**Estimated Time**: 30-45 minutes
**Parallelization**: Sequential only (imports must be removed before files deleted)

## Task Breakdown

### Phase 1: Pre-Deletion Preparation [T]

**T-1.1: Verify current test suite passes**
- **Description**: Run full test suite to establish baseline
- **Commands**:
  ```bash
  cd /Users/fischer/work/DA/KAI/skills/tana
  bun test
  ```
- **Success Criteria**: All tests pass ✅
- **Dependencies**: None
- **Type**: [T] Test
- **Estimated Time**: 2 minutes

**T-1.2: Document current CLI behavior**
- **Description**: Capture current license command behavior before removal
- **Commands**:
  ```bash
  ./supertag --help | grep -E "activate|license|trial" > /tmp/license-commands-before.txt
  ./supertag --version
  ```
- **Success Criteria**: Commands captured for comparison
- **Dependencies**: None
- **Type**: Documentation
- **Estimated Time**: 1 minute

---

### Phase 2: Remove Imports [T]

**T-2.1: Remove license/trial imports from src/index.ts**
- **Description**: Remove import statements for license and trial modules
- **File**: `src/index.ts`
- **Lines to remove**: 24, 26, 29
- **Before**:
  ```typescript
  import { createLicenseCommand, activateCommand, deactivateCommand } from './commands/license';
  import { checkLicense, commandRequiresLicense } from './license';
  import { enforceTrialExpiry, getTrialStatusMessage } from './trial';
  ```
- **After**: Lines deleted
- **Success Criteria**: No import errors when reading file
- **Dependencies**: None
- **Type**: [T] Code modification
- **Estimated Time**: 1 minute

**T-2.2: Remove trial import from export/index.ts**
- **Description**: Remove trial module import from export CLI
- **File**: `export/index.ts`
- **Line to remove**: 36
- **Before**:
  ```typescript
  import { enforceTrialExpiry, getTrialStatusMessage } from "../src/trial";
  ```
- **After**: Line deleted
- **Success Criteria**: No import statement for trial module
- **Dependencies**: None
- **Type**: [T] Code modification
- **Estimated Time**: 1 minute

---

### Phase 3: Delete License Files [T]

**T-3.1: Delete license module files**
- **Description**: Remove all files in src/license/ directory
- **Files to delete**:
  ```
  src/license/index.ts
  src/license/api.ts
  src/license/config.ts
  src/license/storage.ts
  src/license/types.ts
  ```
- **Commands**:
  ```bash
  rm -rf src/license/
  git status  # Verify deletion
  ```
- **Success Criteria**: Directory src/license/ no longer exists
- **Dependencies**: T-2.1 (imports removed first)
- **Type**: [T] File deletion
- **Estimated Time**: 1 minute

**T-3.2: Delete trial module file**
- **Description**: Remove trial period time bombing module
- **File to delete**: `src/trial.ts`
- **Commands**:
  ```bash
  rm src/trial.ts
  git status  # Verify deletion
  ```
- **Success Criteria**: File src/trial.ts no longer exists
- **Dependencies**: T-2.1, T-2.2 (imports removed first)
- **Type**: [T] File deletion
- **Estimated Time**: 1 minute

**T-3.3: Delete license command file**
- **Description**: Remove license CLI command module
- **File to delete**: `src/commands/license.ts`
- **Commands**:
  ```bash
  rm src/commands/license.ts
  git status  # Verify deletion
  ```
- **Success Criteria**: File src/commands/license.ts no longer exists
- **Dependencies**: T-2.1 (imports removed first)
- **Type**: [T] File deletion
- **Estimated Time**: 1 minute

---

### Phase 4: Clean Up Function Calls and UI [T]

**T-4.1: Remove license command registrations from src/index.ts**
- **Description**: Delete activate, deactivate, and license command definitions
- **File**: `src/index.ts`
- **Lines to remove**: 146-168
- **Code to delete**:
  ```typescript
  program.addCommand(createLicenseCommand());

  program
    .command('activate <key>')
    .description('Activate license key')
    .option('-n, --name <name>', 'Custom name for this installation')
    .action(async (key, options) => {
      await activateCommand(key, options);
    });

  program
    .command('deactivate')
    .description('Deactivate license on this device')
    .action(async () => {
      await deactivateCommand();
    });
  ```
- **Success Criteria**: No license command registrations in file
- **Dependencies**: T-2.1, T-3.1, T-3.3 (files deleted, imports removed)
- **Type**: [T] Code modification
- **Estimated Time**: 2 minutes

**T-4.2: Remove license check from main() function**
- **Description**: Simplify main() to remove trial expiry and license validation
- **File**: `src/index.ts`
- **Lines to modify**: 341-367
- **Before**:
  ```typescript
  async function main() {
    enforceTrialExpiry();

    const args = process.argv.slice(2);
    const firstArg = args[0] || '';

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

    program.parse();
  }
  ```
- **After**:
  ```typescript
  async function main() {
    program.parse();
  }
  ```
- **Success Criteria**: main() only calls program.parse()
- **Dependencies**: T-2.1, T-3.1, T-3.2 (files deleted, imports removed)
- **Type**: [T] Code modification
- **Estimated Time**: 2 minutes

**T-4.3: Find and remove trial check from export CLI**
- **Description**: Locate and remove enforceTrialExpiry() call in export/index.ts
- **File**: `export/index.ts`
- **Action**:
  1. Search for `enforceTrialExpiry()` call
  2. Remove the function call
  3. May also need to remove `getTrialStatusMessage()` from program description
- **Success Criteria**: No trial enforcement in export CLI
- **Dependencies**: T-2.2, T-3.2 (trial module deleted, import removed)
- **Type**: [T] Code modification
- **Estimated Time**: 3 minutes

**T-4.4: Update program description in src/index.ts**
- **Description**: Remove trial status from CLI description
- **File**: `src/index.ts`
- **Line to modify**: 42
- **Before**:
  ```typescript
  .description(`Supertag CLI - read, write, sync, and serve Tana data\n\n  ${getTrialStatusMessage()}`)
  ```
- **After**:
  ```typescript
  .description('Supertag CLI - read, write, sync, and serve Tana data')
  ```
- **Success Criteria**: Description is simple string, no function call
- **Dependencies**: T-2.1, T-3.2 (trial module deleted, import removed)
- **Type**: [T] Code modification
- **Estimated Time**: 1 minute

**T-4.5: Remove license help text from src/index.ts**
- **Description**: Delete LICENSE section from help output
- **File**: `src/index.ts`
- **Lines to remove**: 226-229
- **Code to delete**:
  ```typescript
  console.log('  LICENSE:');
  console.log('    supertag activate <key>        Activate license key');
  console.log('    supertag deactivate            Deactivate this device');
  console.log('    supertag license status        Show license status');
  ```
- **Success Criteria**: No LICENSE section in help text
- **Dependencies**: T-4.1 (commands already removed)
- **Type**: [T] Code modification
- **Estimated Time**: 1 minute

---

### Phase 5: Update Documentation [T]

**T-5.1: Update CHANGELOG.md**
- **Description**: Add v0.12.0 entry documenting licensing removal
- **File**: `CHANGELOG.md`
- **Action**: Add at top of file (or update [Unreleased])
- **Content**:
  ```markdown
  ## [0.12.0] - 2025-12-XX

  ### Removed
  - Time bombing trial system - CLI no longer expires
  - LemonSqueezy license integration - all commands now free and unrestricted
  - License activation/deactivation commands (`supertag activate`, `supertag deactivate`)
  - License status command (`supertag license status`)
  - License validation on CLI startup

  ### Changed
  - All commands now execute without license checks or trial expiry
  - Simplified CLI startup (no network calls for validation)
  - Removed trial status from help text
  - CLI is now fully open and unrestricted

  ### Notes
  - Existing license files (`~/.local/share/supertag/license.json`) are no longer used but harmless if present
  - No action required for existing users - all features now available without activation
  ```
- **Success Criteria**: CHANGELOG has entry for v0.12.0
- **Dependencies**: None (documentation task)
- **Type**: Documentation
- **Estimated Time**: 3 minutes

**T-5.2: Update release.sh**
- **Description**: Remove LemonSqueezy references from release script
- **File**: `release.sh`
- **Changes**:
  - Line 18: Update comment "Copies to kDrive for distribution" (not "for LemonSqueezy delivery")
  - Line 266: Change manual step to "Tag release on GitHub" instead of "Update LemonSqueezy product files"
- **Before** (line 266):
  ```bash
  echo "Remaining manual step:"
  echo "  - Update LemonSqueezy product files if needed"
  ```
- **After**:
  ```bash
  echo "Remaining manual steps:"
  echo "  - Tag release on GitHub: git tag v${VERSION} && git push --tags"
  ```
- **Success Criteria**: No LemonSqueezy references in script
- **Dependencies**: None (documentation task)
- **Type**: Documentation
- **Estimated Time**: 2 minutes

**T-5.3: Update README.md**
- **Description**: Remove license activation instructions
- **File**: `README.md`
- **Action**:
  1. Read README.md to find license activation sections
  2. Remove any "License Activation" or "Getting Started with License" sections
  3. Remove `supertag activate <key>` from installation instructions
  4. Ensure "Getting Started" goes directly from install to usage
- **Success Criteria**: No activation instructions in README
- **Dependencies**: None (documentation task)
- **Type**: [T] Documentation
- **Estimated Time**: 5 minutes
- **Note**: Will determine exact changes during implementation

---

### Phase 6: Verification [T]

**T-6.1: Verify no broken imports**
- **Description**: Check that all TypeScript files compile without import errors
- **Commands**:
  ```bash
  # Search for any remaining license/trial imports
  grep -r "from.*license\|from.*trial" src/ export/
  # Should return nothing

  # Test CLI can load
  bun run src/index.ts --help
  ```
- **Success Criteria**:
  - No import statements for license/trial
  - CLI --help executes without errors
- **Dependencies**: All Phase 2-5 tasks complete
- **Type**: [T] Verification
- **Estimated Time**: 2 minutes

**T-6.2: Test core CLI functionality**
- **Description**: Verify that commands execute without license checks
- **Commands**:
  ```bash
  # Test query command
  bun run src/index.ts query search "test" || echo "OK if no data"

  # Test schema command
  bun run src/index.ts schema list || echo "OK if no config"

  # Test workspace command
  bun run src/index.ts workspace list || echo "OK if no workspaces"

  # Verify help text has no license commands
  bun run src/index.ts --help | grep -E "activate|deactivate|license"
  # Should return nothing
  ```
- **Success Criteria**:
  - Commands execute immediately (no license check delay)
  - Help text clean (no license commands)
- **Dependencies**: T-6.1
- **Type**: [T] Functional test
- **Estimated Time**: 3 minutes

**T-6.3: Run full test suite**
- **Description**: Verify all tests still pass after licensing removal
- **Commands**:
  ```bash
  bun test
  ```
- **Success Criteria**: All tests pass ✅ (same as T-1.1 baseline)
- **Dependencies**: T-6.1, T-6.2
- **Type**: [T] Test
- **Estimated Time**: 2 minutes

**T-6.4: Test build process**
- **Description**: Verify CLI can be compiled to binary
- **Commands**:
  ```bash
  # Build main CLI
  bun run build

  # Test binary
  ./supertag --version
  ./supertag --help | grep -E "activate|license"
  # Should return nothing (no license commands)
  ```
- **Success Criteria**:
  - Build succeeds
  - Binary executes
  - No license commands in help
- **Dependencies**: T-6.3
- **Type**: [T] Build verification
- **Estimated Time**: 3 minutes

**T-6.5: Document verification results**
- **Description**: Compare before/after behavior and confirm success
- **Commands**:
  ```bash
  # Compare help output
  ./supertag --help | grep -E "activate|license|trial" > /tmp/license-commands-after.txt
  diff /tmp/license-commands-before.txt /tmp/license-commands-after.txt

  # Should show removal of license commands
  ```
- **Success Criteria**: Confirmation that license commands removed
- **Dependencies**: T-6.4
- **Type**: Documentation
- **Estimated Time**: 2 minutes

---

## Task Summary by Phase

| Phase | Tasks | Estimated Time | Can Parallelize? |
|-------|-------|----------------|------------------|
| Phase 1: Pre-Deletion | T-1.1, T-1.2 | 3 min | ✅ Yes (independent) |
| Phase 2: Remove Imports | T-2.1, T-2.2 | 2 min | ✅ Yes (different files) |
| Phase 3: Delete Files | T-3.1, T-3.2, T-3.3 | 3 min | ✅ Yes (after Phase 2) |
| Phase 4: Clean Up | T-4.1 - T-4.5 | 9 min | ❌ No (same file, sequential edits) |
| Phase 5: Documentation | T-5.1, T-5.2, T-5.3 | 10 min | ✅ Yes (different files) |
| Phase 6: Verification | T-6.1 - T-6.5 | 12 min | ❌ No (sequential verification) |

**Total**: 39 minutes (conservative estimate)

---

## Dependency Graph

```
T-1.1 ─────────────────────────────────────────────┐
                                                   │
T-1.2 ─────────────────────────────────────────┐  │
                                               │  │
         ┌─────────────┬───────────────┐      │  │
         ▼             ▼               ▼      │  │
       T-2.1         T-2.2           T-5.1    │  │
         │             │               │      │  │
    ┌────┴────┐        │           ┌───┴───┐  │  │
    ▼         ▼        │           ▼       ▼  │  │
  T-3.1     T-3.3      ▼         T-5.2   T-5.3 │  │
    │         │      T-3.2                │    │  │
    │         │        │                  │    │  │
    └────┬────┴────────┴─────┐            │    │  │
         ▼                   ▼            │    │  │
       T-4.1               T-4.2          │    │  │
         │                   │            │    │  │
         └────┬──────────────┴──┬─────────┴────┘  │
              ▼                 ▼                  │
            T-4.4             T-4.3                │
              │                 │                  │
              └────────┬────────┘                  │
                       ▼                           │
                     T-4.5                         │
                       │                           │
                       └──────────┬────────────────┘
                                  ▼
                                T-6.1
                                  │
                                  ▼
                                T-6.2
                                  │
                                  ▼
                                T-6.3
                                  │
                                  ▼
                                T-6.4
                                  │
                                  ▼
                                T-6.5
```

---

## Rollback Plan

If any task fails critically:

1. **Stop immediately** - Don't proceed to next task
2. **Identify failure point** - Which task failed?
3. **Restore from git**:
   ```bash
   git checkout src/trial.ts
   git checkout src/license/
   git checkout src/commands/license.ts
   git checkout src/index.ts
   git checkout export/index.ts
   ```
4. **Verify restoration**: `bun test`
5. **Debug issue** before retrying

---

## Success Criteria (Overall)

All tasks complete when:

- ✅ All 14 tasks marked complete
- ✅ All 7 files deleted (verified with `ls`)
- ✅ No broken imports (verified with grep)
- ✅ Test suite passes (bun test)
- ✅ Build succeeds (bun run build)
- ✅ CLI works (no license checks)
- ✅ Help text clean (no license commands)
- ✅ CHANGELOG updated
- ✅ README updated
- ✅ release.sh updated

---

**Tasks Status**: ✅ Ready for Implementation
**Next Phase**: IMPLEMENT (execute tasks with TDD workflow)
**Estimated Total Time**: 30-45 minutes
