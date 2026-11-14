# Attribution

Vendored from [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills), path `skills/react-best-practices`, at revision `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`.
The last upstream commit that changed the skill is `dc8367e`.
Vendored on 2026-11-14.

## License

The upstream `SKILL.md` frontmatter says `license: MIT`, and the upstream README says MIT.
The upstream repository has no `LICENSE` file at this revision, and it gives no copyright line. The standard MIT terms follow. The copyright holder is the author in the skill metadata (`author: vercel`).

```text
MIT License

Copyright (c) Vercel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Files

- Copied: `SKILL.md` and the 70 rule files in `rules/`.
- Not copied: `AGENTS.md` (a 108 KB compiled copy of the rules), `README.md`, `metadata.json`, `rules/_sections.md`, and `rules/_template.md`.

## Local changes

- `SKILL.md`: The name is `react` (upstream: `vercel-react-best-practices`). The description is new.
- `SKILL.md`: The "Full Compiled Document" section pointed to `AGENTS.md`. A React Compiler note and a pointer to this file replace it.
- `SKILL.md`: The Quick Reference lines for `async-dependencies`, `client-swr-dedup`, and `advanced-event-handler-refs` match the changed rules.
- `rules/advanced-event-handler-refs.md`: The rule leads with `useEffectEvent` (React 19.2). The ref pattern is the fallback for older React. The new text gives the call rules from react.dev. The upstream claim that `useEffectEvent` gives a "stable function reference" is removed, because `advanced-effect-event-deps` says that its identity changes on every render.
- `rules/client-swr-dedup.md`: The rule tells the agent to use the data library that the project already uses (SWR or TanStack Query). It does not push SWR. The title is "Use a Data Library for Automatic Deduplication". A TanStack Query reference link is added.
- `rules/async-dependencies.md`: The plain `Promise.all()` version is the main correct example. `better-all` is optional.
- `rules/rerender-memo.md`, `rules/rerender-memo-with-default-value.md`, `rules/rerender-simple-expression-in-memo.md`, `rules/rerender-split-combined-hooks.md`: The first line under the heading tells the agent to check for the React Compiler first. If the compiler is on, the agent does not add manual memoization for performance.
- All files: trailing whitespace is removed, so `git diff --check` passes.
