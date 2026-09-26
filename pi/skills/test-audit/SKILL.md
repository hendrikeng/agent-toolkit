---
name: test-audit
description: Use whenever writing, changing, reviewing, or auditing tests. Gate new tests and find low-value, implementation-coupled, or duplicate tests and the test-only production seams they require.
license: MIT
---

# Test Audit

Use the authoring gate for each new or changed test. Use the audit workflow only when the user asks to review or prune tests. Optimize for confidence, not deletion count.

This skill is first-model test guidance. It does not trigger AutoReview or another AI review. Follow the repository's review policy at commit, push, pull request, merge, or ship boundaries.

## Authoring gate

Before you add or change a test, answer these questions:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not catch that failure?
4. Does it need a production export, flag, wrapper, or injection hook that no production caller needs?

If an answer is missing, do not add the test. Give each contract one primary test owner at the strongest practical boundary. Add a test at another layer only for a distinct risk that the owner cannot reach, such as transport or lifecycle behavior.

Prefer an existing table, fixture, or owner-boundary test over a near duplicate. A test that breaks after a behavior-preserving refactor usually tests implementation instead of behavior.

A bug regression test must fail on the pre-fix code for the intended reason and pass after the owner-boundary fix. Do not repeat the same regression at each layer that it crosses.

## Low-value patterns

Reject or audit tests with these patterns unless they independently protect a retained contract:

- no assertions;
- self-comparisons or identity copies;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string searches;
- private predicate or call-shape tests that a real boundary test duplicates;
- duplicate invocations of the same contract;
- local replays of a shared helper;
- tests that exist only to preserve test-only exports, globals, wrappers, or flags;
- dead production code whose only callers are tests;
- expected values made by the helper or renderer under test;
- mocks that implement the asserted behavior;
- one identical mock that stands in for different APIs;
- fixtures that supply the receipt, admission, persistence, or callback order that the owner must produce;
- capability tests that repeat declared flags instead of exercising the promised behavior;
- negative controls that pass because of a different guard or an unreachable path;
- names or fixtures that promise more behavior than the input exercises.

## Retention bar

Keep a test when it independently enforces a public API, protocol, configuration, migration, storage, security, platform, default, package, release, or architecture contract. Also keep:

- observable call ordering;
- regressions with a credible failure mode;
- source inspection when it is the cheapest independent guard and survives identifier-only refactors;
- a failing retained test that reveals a product defect.

Static or slow tests are not automatically low value. Similarity to implementation is not sufficient evidence for deletion.

## Audit workflow

Keep discovery read-only until you have evidence. Read the complete test and its production owner. Also read the entry point, callers, sibling implementations, overlapping tests, CI routing, relevant history, and scoped agent instructions.

Record these facts for each deletion candidate:

- exact test name and location;
- the failure that it can detect;
- non-test callers of its production or support seam;
- the stronger owner-boundary proof that remains, or why no proof is necessary;
- relevant history and the reason that the test or seam exists;
- production or test-support code that deletion unlocks;
- risk and the focused validation command.

If a fact is missing, do not delete the candidate.

Choose one coherent owner-boundary batch. Remove obsolete test-only production seams instead of preserving aliases. Move retained regressions to their canonical owner. Consolidate repeated assertions into one owner-boundary contract.

Do not add replacement tests that restate the same implementation. Prefer net-negative production code when removing a test-only seam.

## Validation

1. Run the smallest owner and sibling tests.
2. For a removed source search or plan assertion, run the executable owner or its dry run.
3. Run targeted formatting and `git diff --check`.
4. Inspect the final diff. Report production code separately from tests and test support.

## Report

Report:

- the low-value categories removed;
- production owner simplifications;
- false positives retained and why they remain valuable;
- focused validation that ran;
- production code versus test and test-support changes;
- named follow-ups.
