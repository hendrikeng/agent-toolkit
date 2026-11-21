# CI speed brief

Use this brief for a Worker that makes the CI of one repository fast. The CI must stay honest.
Target: a pull request gets its result in less than 2 minutes at the median and less than 3 minutes at p95.

## Rules that are more important than speed

- The full suite runs before a change gets to the integration branch. Selection makes only the pull request feedback smaller.
- Do not make CI faster by hiding failures. Do not add retries, longer timeouts, or skipped tests.
- If a check needs a retry, the check has a bug. Find the bug.
- If hosted CI cannot run, the local full gate on the exact head commit replaces it. The Toolkit release rules apply.

## 1. Audit

1. Pull the last 150 runs with `gh run list` and `gh run view --json jobs`.
2. Split each job into wait time, setup time, and run time. Calculate p50 and p95 for each part.
3. Fix the largest part first. Usually the tests are not the largest part, so do not delete tests.

## 2. Budgets

- **Wait, less than 10 seconds.** Use Ubicloud runners for all jobs, also for short jobs. Do not use Blacksmith. Cancel the run in progress on a branch when a new commit arrives (`concurrency` with `cancel-in-progress`).
- **Setup, less than 30 seconds.** Seed the caches from the integration branch, so that more than 95% of pull request runs get a cache hit. Cache `node_modules`, not only the package store. Use a blobless clone (`filter: blob:none`) for lint, typecheck, and build. Jobs that read history or file content outside the checkout need a full clone, because a private repository with `persist-credentials: false` cannot fetch missing blobs later.
- **Lint, less than 5 seconds.** Use oxlint and turn on all rules that you can. Keep ESLint only for rules that oxlint does not have, for example Vue template rules, and turn off the overlap with `eslint-plugin-oxlint`.
- **Typecheck, less than 5 seconds.** Use TypeScript 7 (`tsgo`). If `vue-tsc` or a framework cannot use TypeScript 7 yet, keep the old checker and record the measured reason.
- **Format.** Use oxfmt. Remove Prettier.
- **Install and scripts.** Measure Bun against the current package manager. Switch only if Bun is faster and loses no protection that the repository uses. Bun 1.4 does not fail on conflicting peer dependencies, does not check `engines`, and does not document a strict mode for `minimumReleaseAge`. If a deploy reads the lockfile, update the deploy configuration in the same change. Node stays the runtime unless measurements show that Bun is safe and faster.
- **Script runner.** Use `node --run` in shared scripts. It needs no package manager setup and is faster than `npm run` and `pnpm run`.
- **Tests, less than 60 seconds for each shard.** Do not reload the application for each test file (Vitest `isolate: false`). Reset the state after each file, and write the cleanup rules into `AGENTS.md`. Run tests in random order to find leaks. Split the shards by measured duration onto 8-core machines. Give each shard its own database. Buy cores before you add shards, and set the concurrency to the number of cores.
- **Job shape.** Run lint, typecheck, build, and tests in parallel. Move migration checks and the tests of other applications out of the slowest job into their own jobs.
- **Selection.** On pull requests, run only what the diff can reach (`vitest --changed`, `turbo --affected`, or `nx affected`). Then hide a real change from the selection on purpose, and make sure that CI fails.
- **Local, less than 9 seconds.** Add a pre-push hook that runs format, lint, and typecheck on the changed files. Use a hook, not a line in `AGENTS.md`, because agents skip steps. The hook must not run AI reviews.
- **Keep it fast.** Make a job fail when it is longer than its budget.

The tools above are the defaults. You need a measured reason to keep an old tool. Use a newer tool if it is faster on this repository.
Before each switch, run the old tool and the new tool side by side. List each finding that the new tool does not find.

## 3. Delivery

- Group the changes into a small number of pull requests, for example tooling, tests, and CI shape. Each pull request and each push costs a full CI run.
- Put before and after numbers from real runs in each pull request.
- Do all work that needs no human first.
- Give the work that needs an account, a secret, or a larger bill as one list, with the expected monthly cost.
- At the end, report the total CI time and cost before and after.
