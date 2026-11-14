# Upstream source

Source: [openclaw/openclaw](https://github.com/openclaw/openclaw/blob/b74bd07a2fb073d04b1f2de3687513d495d26f11/.agents/skills/test-audit/SKILL.md).

Pinned revision: `b74bd07a2fb073d04b1f2de3687513d495d26f11`.

This version keeps the authoring gate and focused audit workflow. It removes OpenClaw-specific commands, campaign orchestration, and mandatory AI review. The Toolkit review policy remains authoritative.

Reviewed against revision `3195fba90643c3897c538f2f6891c405331bee9c`. That revision compresses the same rules into a telegraphic style and moves the audit workflow to `references/audit.md`, with links to OpenClaw-only documents. The Toolkit keeps its plain-English version. It adds two generic rules from that revision: report a pre-fix failure that you cannot show, and run the dead-code check after you remove tests.
