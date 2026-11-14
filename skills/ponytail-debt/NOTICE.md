Source: DietrichGebert/ponytail, tag v5.3.3, revision 7801d061243d7b753bad0e0b3c057cd250b11755.
Only skill text and the upstream MIT license are included. No plugin hooks are installed.
Toolkit change: read each hit in context, and exclude string literals and documentation examples that describe the convention.
The scan reads the new `shortcut:` markers and the older `ponytail:` markers.
Toolkit change: the skill runs only on explicit request (`disable-model-invocation: true`), the same as `ponytail-review` and `ponytail-audit`.
