---
name: python
description: "Pragmatic Python guidance for implementation, refactoring, testing, typing, async code, packaging, and tooling. Use automatically when a task edits Python files, the repository is primarily Python, or the task mentions Python, pytest, pyproject.toml, uv, Poetry, Ruff, mypy, Pyright, or ty. Follow the repository's supported Python version and existing tools."
metadata:
  tags: python, pytest, typing, async, packaging, pyproject, uv, ruff
---

# Python

Write the smallest clear Python that fits the existing project.

## Inspect First

- Read `pyproject.toml` and relevant lock/config files before choosing syntax, dependencies, or commands.
- Follow the project's minimum Python version, formatter, linter, type checker, package manager, and test runner.
- Trace callers before changing shared functions; fix root causes at the narrowest shared point.
- Prefer nearby project conventions over introducing a new “best practice.”
- Load a framework-specific skill too when applicable; framework rules take precedence for framework APIs.

## Coding Defaults

- Prefer the standard library and existing dependencies. Add a dependency only when the task justifies it.
- Prefer functions and modules over classes until state or a real domain concept requires a class.
- Use direct control flow, early returns, and descriptive names. Avoid speculative abstractions and clever expressions.
- Use comprehensions only when they remain easier to read than a loop.
- Use context managers for files, locks, transactions, and other resources.
- Use `pathlib.Path` for new path-heavy code when supported, but do not rewrite stable `os.path` code without a reason.
- Use dataclasses for genuine data records, not as a default replacement for every class or dictionary.
- Avoid mutable default arguments; use `None` or `default_factory` as appropriate.
- Use `is None`, `enumerate`, `zip`, `any`, `all`, `min`, `max`, and `sum` instead of hand-written equivalents.
- Do not optimize without evidence. Measure before adding caching, concurrency, slots, vectorization, or native extensions.

## Types

- Type new and changed public boundaries where it improves correctness and editor support.
- Match syntax to the project's minimum Python version; do not introduce newer union, generic, or typing syntax into older projects.
- Prefer precise built-in and `collections.abc` types over `Any`; do not add casts or ignores merely to silence a checker.
- Use `Protocol` only when structural polymorphism is actually needed, not for a single implementation.
- Do not impose strict typing or annotate untouched code unless the task asks for a migration.

## Errors and Boundaries

- Validate untrusted input at the boundary and keep internal code simple after validation.
- Catch the narrowest useful exception. Never silently swallow failures or use a bare `except`.
- Preserve context with `raise ... from exc` when translating exceptions; use `from None` only when hiding context is intentional.
- Let unexpected errors propagate unless the current layer can recover, add useful context, or map them to a public error.
- Use `assert` for programmer invariants and tests, not runtime validation of external input.

## Async and Concurrency

- Keep synchronous code synchronous unless the surrounding call path and libraries are async.
- Never call blocking I/O or CPU-heavy work directly from an async event loop.
- Reuse the project's concurrency library and cancellation/error-handling patterns.
- Prefer structured concurrency (`TaskGroup` when the supported Python version allows it) over detached background tasks.
- Protect shared mutable state; avoid adding concurrency until it provides a measured benefit.

## Packaging and Tooling

- Keep existing package management: use `uv` in uv projects, Poetry in Poetry projects, and the configured pip workflow elsewhere.
- Do not migrate tools, rewrite lock files manually, or add formatter/linter/type-checker configuration unless requested.
- For a new project, prefer `pyproject.toml`; choose the smallest toolchain that meets the task.
- Run tools through the project environment, for example `uv run`, `poetry run`, or the documented virtual environment.
- Respect generated files and lock files; update them only through their owning tool.

## Testing

- Use the existing test runner and test layout.
- Leave one focused regression test for non-trivial changed behavior; avoid broad fixture or mocking scaffolds.
- Test observable behavior. Mock network, clock, randomness, or process boundaries rather than internal implementation details.
- Use `tmp_path`/temporary directories for filesystem tests and parametrization only when it makes cases clearer.
- Run the smallest relevant test, lint, and type-check commands already configured by the project.
