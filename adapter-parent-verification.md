# Parent verification — AI / Daytona adapters

This receipt supersedes timing-sensitive current-state claims in older recovery notes; those notes remain historical.

## Completed and freshly exercised

- Backend 70/70 tests; UI state 11/11 tests; total 81, fail/skip 0.
- Local verifier genuinely executed 10/10 → 6/10 → 10/10 and reported LOCAL_VERIFIED, local-rule/local, sponsorUsed:false.
- Actual Chrome start/result/download/reset/new-run workflow rechecked; 390px no horizontal overflow and no pageerror.
- A real loopback server with non-ready external configuration displayed CONFIG_ERROR, disabled start, and invoked runner zero times. It did not call external services.
- @daytona/sdk 0.224.0 actual module import succeeded. SDK method signatures and options were TypeScript noEmit checked against installed declarations. This is not live Daytona authentication or product TypeScript compilation.
- Minimal remote worker bundle executed actual fixed inputs locally using npm ci --offline, exact package integrity/versions and untouched generated lock. This is not a Daytona service run.

## Parent repairs (observed RED then GREEN)

Added application requirement to AI request, selected model to evidence, adapter source to immutable hash snapshot, SDK-derived sandbox home with restricted paths, and separate primary/cleanup error records. Each missing behavior was observed failing before the repair. UI tests separately prevent test-double evidence from being shown as genuine provider success.

## Guardrails and remaining limitations

OpenAI-compatible requests have bounded JSON/output and timeout/abort, no redirects or silent local fallback. Responses must satisfy the single supported source transformation. Equivalent formatting may be refused; the exact allowlist is not a general migration engine.

Daytona uses a fresh sandbox per phase, fixed commands, host-owned input files without expected answers, pinned minimal lock, disabled lifecycle scripts, explicit cleanup and exact-id readback. Cleanup failure remains pending and is separate from execution failure. Actual auth/quota/runtime/egress/deletion behavior still requires a live smoke test. A create failure without an id cannot prove resource absence; TTL is only a requested mitigation.

Tests use injected HTTP/SDK doubles and mark them TEST_DOUBLE_VERIFIED, never genuine model/sponsor PASS. No live model/Daytona calls were made. Default execution is local, and external mode needs explicit opt-in plus complete operator configuration.

## Current artifacts and operation

- Product: /Users/oc_currenjin/work/package-upgrade-lab.
- Active kit workspace: /Users/oc_currenjin/work/hackathon-kit/workspace/2026-daytona-hacksprint-seoul-oct18.
- Authoritative fresh receipt: evidence/adapters-verification-receipt.json.
- Raw logs: evidence/adapters-backend.log, adapters-ui.log, adapters-verify.log.
- Actual local result: evidence/adapters-local-actual.json.
- .env.example contains no secrets; use explicit node --env-file=.env server.mjs only after authorized configuration. npm run verify remains local by default.
- This parent started loopback server proc_472d64d0177e with PATCH_PROVIDER=local-rule EXECUTION_PROVIDER=local ALLOW_EXTERNAL_CALLS=0. Earlier records about a different recovery server being stopped do not describe this server.

Immutable oracle preserved. No Git init/commit/push/public deployment. Current stage: adapter implementation and local readiness verified; genuine model quality and Daytona execution remain unverified pending credentials and bounded-call approval.
