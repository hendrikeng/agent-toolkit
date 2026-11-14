# Attribution

Vendored from [`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill),
skill `security-audit`, at revision `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`
on 2026-11-14.

The upstream skill is MIT licensed. See `LICENSE` in this directory.

The local changes are `disable-model-invocation: true` and the description prefix "Invoke only when the user explicitly requests it." in the `SKILL.md`
frontmatter. As a result, the skill loads only on an explicit request
(`/security-audit`). The upstream README, CI files, and validator tests are not
copied. The two validators use only the Node.js `fs`, `path`, and `util`
modules. They do not use the network or start processes.

In full audit mode, the skill writes its output outside the repository, to
`~/security-audit-skill/<repo>/run-<N>` by default. It runs target code only in
an OS sandbox without network access. If no such sandbox is available, it marks
the lead `needs_validation`.
