# Backend verification

## Executed outcome

`npm test`: **26 tests, 26 passed, 0 failed, 0 skipped** (exit 0).

`npm run verify -- --output scripts/verify-evidence.json`: exit 0, actual `LOCAL_VERIFIED` result. The artifact was read back after execution and its command exit codes, hashes, and invariants were checked.

| Actual phase | Installed package | Requirement matches |
| --- | --- | --- |
| baseline | Zod 3.25.76 | 10/10 |
| upgraded, unchanged schema | Zod 4.1.12 | 6/10 |
| patched, partialRecord schema | Zod 4.1.12 | 10/10 |

Totals are computed from the authenticated oracle cases, not hardcoded. Regression IDs: `email-only`, `push-only`, `empty`, `false-preserved`. Invalid inputs remain rejected, including unknown keys, strings, numbers, null, and arrays. Accepted output is compared by deep structural equality, preserving `false`.

- Node: `v25.8.1`; npm: `11.11.0`.
- Three actual Node subprocesses: PIDs `23223`, `23225`, `23226`, each exit 0 in the retained verification artifact.
- Authenticated canonical oracle SHA-256: `2411601721e5b0f1829a77a1405efa625df899945d22980389b88a2ee5a25a00`.
- Package-lock SHA-256: `d9a5bad3760a79e836992cfa72313b28e2c76201263e7e89345b15008ded4592`.
- Baseline/upgraded application SHA-256: `a492333db6815a62887d8cbf599cfcd7c7b5ff8697f674e73392fc944abad5b1`.
- Patched application SHA-256: `0a5db9c4969d46817dd36858ce5b83194f190d4ee1e711b9446f30de82472094`.
- Artifact SHA-256: `5cdd3b93aae9e56e84d26d129532a5cb6ed9dc0f885302c5a575a028f1a270c9`.

The JSON evidence includes actual per-case issues, inputs, expected application outputs, actual outputs, commands, stdout/stderr, exit codes, measured durations, runtime/package versions, source hashes, lock hash, and before/after immutable-file hashes. Duration measurements are execution evidence, not performance benchmark claims.

## Observed TDD RED → GREEN

1. Wrote 10 runner tests against temporary nonfunctional exports. Executed `node --test test/runner.test.mjs`: **0 pass / 10 fail**, exit 1. Failures were assertions such as missing oracle hash, missing rejection, absent patch, absent comparison result, and missing local verdict—not import failures. Implemented runner/worker/fixture: **10 pass / 0 fail**, exit 0.
2. Wrote 14 HTTP tests against a temporary 404 handler with functioning ephemeral-server plumbing. Executed `node --test test/server.test.mjs`: **0 pass / 14 fail**, exit 1, on actual HTTP status assertions. Implemented API/static routing. One later assertion incorrectly assumed a missing executable reports null; this Node version reports actual exit `-2`. Corrected the test to require nonzero exit and ENOENT without rewriting real evidence. Final API tests pass.
3. Wrote 2 verifier tests against a temporary helper and CLI that returned no verification. Executed `node --test test/verify.test.mjs`: **0 pass / 2 fail**, exit 1 (CLI exit assertion and missing rejection). Implemented real execution and atomic evidence persistence. Final verifier tests pass.
4. UI integration required a `matches` row field. Added its assertion before implementation and executed the focused evaluator test: **0 pass / 1 fail**, exit 1 (`undefined` instead of `false`). Added `matches` as an exact alias of `matched`; full suite subsequently passed.

All temporary placeholders have been replaced. Tests execute real installed Zod packages and real HTTP servers; no successful runner responses are fabricated. Missing-executable failure tests also run a real subprocess launch attempt.

## API

- `GET /health` → 200 `{ "ok": true }`.
- `GET /api/config` → 200 `{ "fixtureId":"zod-settings", "baselineVersion":"3.25.76", "targetVersion":"4.1.12", "provider":"local-rule", "environment":"local" }`.
- `POST /api/runs`, JSON `{ "fixtureId":"zod-settings" }` → 202 `{ "id":"<UUID v4>" }`.
- `GET /api/runs/:id` → actual asynchronous status with `id`, `status`, `stage`, `events`, `result`, and `error`. Ordered progress stages: baseline, upgraded, patch, patched, completed. Failed execution keeps `result:null` and publishes an explicit error.
- `GET /api/runs/:id/patch` → verified source-only unified diff, `text/plain`, attachment. Running/failed runs do not receive a success patch (409).
- `GET /api/runs/:id/evidence` → actual successful or failed evidence JSON attachment; pending runs return 409.
- Phase rows include `id`, `input`, `control`, `expected`, `actual:{id,accept,data,issues}`, and equivalent boolean fields `matched`/`matches`.

`startServer({port:0, staticDir, ...options})` exports ephemeral server support; `createApp(options)` exports the HTTP request listener. CLI default binds only `127.0.0.1`, port `4318` (or validated PORT). No persistent server was started by this task.

## Bounds and guardrails

- Only one fixed synthetic fixture and exact version pair; no arbitrary URL, source, command, or secret input.
- Exact-source patch allowlist: `z.record` → `z.partialRecord` only. Baseline fixture bytes are checked. Boolean and enum validators cannot be bypassed.
- Oracle normalized hash is checked against both the contract and a fixed approved anchor before execution.
- Same immutable inputs are run in separate baseline/upgraded/patched processes. Oracle, contract, application fixture, evaluator, worker, package metadata/lock, and test files are hashed before/after execution.
- 1024-byte request body limit; JSON-only requests; unknown fields/fixtures, malformed IDs, mismatched Origins, cross-site mutations, and spoofed Hosts rejected.
- Loopback-only listening; 2 concurrent runs, 64 stored runs, 30-minute completed-run retention by default. Completed entries are pruned on requests, with oldest completed entries evicted at capacity.
- Subprocess timeout 10 seconds and combined output limit 1 MiB; HTTP body deadline 5 seconds; HTTP header/request limits; static asset maximum 4 MiB.
- Public-root-only static serving with decoded traversal rejection and realpath symlink containment; hidden files and unsupported file types blocked. Self-origin CSP forbids inline/eval scripts and inline styles.

## Scope and limitations

Provider is **local-rule**, environment **local**, `sponsorUsed:false`. The patch is a deterministic transformation based on the official Zod migration reference preserved in the approved contract; it is not LLM-generated, manual editing presented as AI, or sponsor execution. Verdict is **LOCAL_VERIFIED**, never product/sponsor PASS. No git operations or external network calls were made by this backend task; dependencies installed by the parent were consumed.

The verification script's default output remains `.runs/verify-evidence.json` as requested by the parent. This delegated task's exclusive write allowlist excludes `.runs`, so executed verification used the explicit allowed output `scripts/verify-evidence.json`. The parent can run unqualified `npm run verify` under its own authorization to create the default artifact. Existing contracts, package.json, README, and public files were not modified here.
