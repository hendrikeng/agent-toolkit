---
name: python
description: "Python project rules: detect the repository's Python version and tools (uv, Poetry, pip, Ruff, mypy, Pyright, ty, pytest) before you write or run code. Use automatically when a task edits Python files, the repository is primarily Python, or the task mentions Python, pytest, pyproject.toml, uv, Poetry, Ruff, mypy, Pyright, or ty."
metadata:
  tags: python, pytest, typing, pyproject, uv, poetry, ruff
---

# Python

Before you write or run Python, read `pyproject.toml`, the lock file, and the tool configuration.
These files set the rules below.

## Version

- Find the minimum version in `requires-python`, `.python-version`, or the CI matrix.
- Use only syntax and stdlib features that this version supports.
  For example, `X | Y` unions need 3.10, `match` needs 3.10, `TaskGroup` needs 3.11, and PEP 695 generics need 3.12.

## Tools

- Use the tool that owns the lock file: `uv.lock` means `uv run` and `uv add`, `poetry.lock` means `poetry run` and `poetry add`.
  Otherwise, use the documented virtual environment and pip workflow.
- Do not run bare `python` or `pip` in a managed project. They can use the wrong interpreter.
- Update lock files only through their owning tool. Do not edit them by hand.
- Run only the formatter, linter, type checker, and test runner that the project configures.
  Do not add or migrate tool configuration unless the user asks.
- Run the narrowest check first, for example `uv run pytest path/test_x.py::test_name` or `uv run ruff check path`.

## Types

- Annotate new and changed public functions when the project uses a type checker.
- Do not add `cast`, `Any`, or `# type: ignore` only to silence the checker.
- Do not add annotations to code that the task does not change.

If a framework skill applies, load it too. Its rules take precedence for its APIs.
