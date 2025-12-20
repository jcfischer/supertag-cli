---
feature: "LanceDB Batch Optimization - Tana Integration"
plan: "./plan.md"
status: "completed"
total_tasks: 4
completed: 4
---

# Tasks: LanceDB Batch Optimization - Tana Integration

## Legend

- `[T]` - Test required (TDD mandatory - write test FIRST)
- `[P]` - Can run in parallel with other [P] tasks in same group
- `depends: T-X.Y` - Must complete after specified task(s)

## Task Groups

### Group 1: Dependencies

- [x] **T-1.1** Update resona dependency to ^0.2.0
  - File: `package.json`
  - Description: Update resona from ^0.1.0 to ^0.2.0 to get new storeBatchSize option
  - Verification: `bun install` succeeds, types compile

### Group 2: CLI Integration

- [x] **T-2.1** Add --lance-batch-size CLI option [T] (depends: T-1.1)
  - File: `src/commands/embed.ts`
  - Test: Manual verification (CLI option parsing)
  - Description: Add `--lance-batch-size <n>` option to `embed generate` command
  - Details:
    - Add option: `.option("--lance-batch-size <n>", "LanceDB write batch size (default: 5000)")`
    - Parse value: `parseInt(options.lanceBatchSize)`
    - Pass to embedNodes: `storeBatchSize: options.lanceBatchSize ? parseInt(options.lanceBatchSize) : undefined`

- [x] **T-2.2** Update progress display for dual counters [T] (depends: T-1.1)
  - File: `src/commands/embed.ts`
  - Test: Manual verification (progress output)
  - Description: Show Ollama generated vs LanceDB persisted counts
  - Current display:
    ```
    ⏳ 45.2% | 45200 done | 0 errors | 125.3/s | ETA: 2m15s
    ```
  - New display:
    ```
    ⏳ 45.2% | Ollama: 45200 | LanceDB: 40000 | Buffer: 200 | 125.3/s | ETA: 2m15s
    ```

### Group 3: Verification

- [x] **T-3.1** Run tests and verify backward compatibility [T] (depends: T-2.1, T-2.2)
  - Test: `bun test`
  - Description: Ensure all existing tests pass, no regressions
  - Verification:
    - All tests pass
    - `supertag embed generate` works without --lance-batch-size (uses default)
    - `supertag embed generate --lance-batch-size 1000` works with custom value

## Dependency Graph

```
T-1.1 ──> T-2.1 ──┬──> T-3.1
     └──> T-2.2 ──┘
```

## Execution Order

1. **T-1.1** Update resona dependency
2. **Parallel:** T-2.1, T-2.2 (CLI option and progress display)
3. **T-3.1** Final verification

## Progress Tracking

| Task | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| T-1.1 | ✅ done | 2025-12-19 | 2025-12-19 | Using local path (npm not published) |
| T-2.1 | ✅ done | 2025-12-19 | 2025-12-19 | CLI option added |
| T-2.2 | ✅ done | 2025-12-19 | 2025-12-19 | Dual progress counters |
| T-3.1 | ✅ done | 2025-12-19 | 2025-12-19 | 379 tests pass |

## TDD Reminder

For each task marked [T]:

1. **RED:** Write failing test first (or manual verification for CLI)
2. **GREEN:** Write minimal implementation to pass
3. **BLUE:** Refactor while keeping tests green
4. **VERIFY:** Run full test suite (`bun test`)

**DO NOT proceed to next task until:**
- Current task's tests pass
- Full test suite passes (no regressions)

## Implementation Details

### T-1.1: package.json change

```diff
- "resona": "^0.1.0",
+ "resona": "file:///Users/fischer/work/resona",
```
Note: Using local path since resona 0.2.0 not published to npm (OTP required).

### T-2.1: CLI option addition

```typescript
// Add to embed generate command options
.option("--lance-batch-size <n>", "LanceDB write batch size (default: 5000)")

// Add to embedNodes call
const result = await embeddingService.embedNodes(contextualizedNodes, {
  forceAll: options.all,
  storeBatchSize: options.lanceBatchSize ? parseInt(options.lanceBatchSize) : undefined,
  onProgress: (progress) => { /* ... */ },
});
```

### T-2.2: Progress display update

```typescript
// New line with dual counters:
const storedStr = progress.stored !== undefined ? progress.stored.toLocaleString() : '0';
const bufferStr = progress.bufferSize !== undefined ? progress.bufferSize : 0;
const line = `   ⏳ ${pct}% | Ollama: ${progress.processed.toLocaleString()} | LanceDB: ${storedStr} | Buffer: ${bufferStr} | ${rateStr} | ${etaStr}`;
```

## Blockers & Issues

| Task | Issue | Resolution |
|------|-------|------------|
| T-1.1 | resona 0.2.0 not on npm | Using local file path |
