---
name: simple-english
version: 1.2.0
description: |
  Check, write, or rewrite technical text with ASD-STE100 Simplified Technical
  English. Use automatically when creating, editing, reviewing, or auditing
  Markdown documentation, including READMEs, AGENTS.md, CLAUDE.md, SKILL.md,
  and Markdown prompt files. Also use when the user invokes Simple English or
  asks to check or rewrite runbooks, procedures, error messages, release notes,
  incident reports, or API guides. Also use for requests that say
  "STE", "Simplified Technical English", "ASD-STE100", "de-slop", "make this
  readable", or "write for non-native readers". Applies short sentences,
  consistent terms, simple tenses, active voice, and condition-first commands.
license: MIT
compatibility: claude-code cursor codex gemini-cli opencode
metadata:
  standard: ASD-STE100 Issue 9 (2025-01-15)
---

# Simple English: Write Like an Aerospace Manual

Write technical text with the rules of ASD-STE100 Simplified Technical English. STE is the controlled language of aerospace maintenance manuals. Its rules prevent misreading by a tired reader who is not a native English speaker. They also remove the usual signs of AI-generated text: long sentences, synonym rotation, hedges, and filler.

Each sentence must survive one read.

## Your Task

For Markdown documentation work, load this full skill even without an explicit Simple English request.
Apply it to prose in documentation and agent instructions. Preserve the items under Untouchables.

1. **Select the mode.** Pragmatic is the default: it applies the structural rules below, and domain words ("idempotent", "webhook") stay. Use strict mode when the user names STE, ASD-STE100, or compliance.
2. **Classify each passage** as procedural or descriptive (table below).
3. **Pick one term per concept before you draft.** Pick one verb for check/verify/confirm/ensure. Pick one noun for config/configuration/settings/options. Use no other word for these concepts in the document.
4. **Apply the rules below.**
5. **Do the self-check** before you deliver. This step is not optional.

For strict mode, check mode, or a full audit, read `references/rules.md` first. It has the 53-rule catalog, the vocabulary rulings, and the slop table.
In strict mode, write `make sure that` for the check/verify/confirm/ensure concept. Tell the user that full compliance needs the official dictionary (free at asd-ste100.org).

When asked to CHECK text, report each violation as: rule number, the offending text, a compliant rewrite. Cite only rule numbers from `references/rules.md`. Models invent rule numbers from memory.

## Classify the Text

| | Procedural (instructions) | Descriptive (explanations) |
|---|---|---|
| Verb form | Imperative: "Install the pump." | Simple present, past, or future |
| Sentence limit | **20 words** | **25 words** |
| Unit | One instruction per sentence | One topic per paragraph, max six sentences |

Do not mix the two in one passage. A note inside a procedure is descriptive: 25 words, no instruction.

## Core Rules

- **Condition first.** Put a required condition before the command, with a comma: "If the build fails, read the log."
- **Active voice.** Use passive only when the agent is unknown.
- **Simple tenses only.** No present perfect ("has been"), no progressive ("is being rebuilt"). Use an "-ing" form only as a noun ("logging"), never as a verb.
- **Verbs for actions.** "Compress the file", not "perform compression of the file".
- **Complete grammar.** No contractions. Keep articles and "that". Short sentences, not telegraph style.
- **One item, one name.** Do not use a noun as a verb ("webhook the event") or a verb as a noun ("do a deploy").
- **Noun chains of three words or fewer.** "the timeout value for the connection pool", not "the connection pool timeout configuration value".
- **No semicolons.** Write two sentences.
- **No phrasal verbs** when a single verb exists: "set up" becomes "install" or "configure".
- **No Latin abbreviations.** "e.g." becomes "for example", "i.e." becomes "that is". Delete "etc." and name the items.
- **One new fact per sentence** in descriptive text. Use a vertical list for complex text.
- **Safety pattern.** Risk word, then the command, then the result: "CAUTION: Do not use `--force` against production. The flag deletes rows that do not match the source."

### Approved modals

**Approved: can, will, must. Banned: should, would, may, might, could.** Models read "should" as optional.

| You wrote | Write |
|---|---|
| should (requirement) | must |
| should (recommendation) | Delete it, or state it as fact: "X is better because Y." |
| may / might / could (possibility) | can |
| may (permission) | can |
| would (hypothetical) | Restructure: "If X occurs, Y occurs." |

### Slop words

Delete words that carry no fact: simply, just, easily, seamlessly, robust, powerful, comprehensive, "it is worth noting that", "it is important to".
Replace the rest: leverage/utilize → use, in order to → to, prior to → before, enables you to → you can, in the event that → if, due to the fact that → because, out of the box → by default.
The full table is in `references/rules.md`.

## Untouchables

These are technical names. Leave them exact, even when they break vocabulary rules:

- Code blocks, inline code, identifiers, CLI commands, flags, file paths
- Quoted error messages and log lines
- Product names, API endpoint names, config keys
- Numbers with units

Each backticked item, number with unit, and identifier counts as one word in the sentence limit.

## Self-Check Before You Deliver

This step is not optional. Run these four checks on your draft:

1. Count words in your three longest sentences. Over the 20/25 limit → split them.
2. Search your draft for: `'ll`, `'re`, `'s` (contraction), `has been`, `have been`, `should`, `-ing` verbs after a comma, semicolons.
3. Search for every `if` and `when`. Each one stands at the START of its sentence, before the command. "Increase the timeout if the network is slow" → "If the network is slow, increase the timeout."
4. Search for the verbs you did NOT pick in Your Task step 3 (the check/verify/confirm set). Replace every hit with your chosen verb.

Fix what you find, then deliver. For a full audit, run `references/checklist.md`.

## Limits

STE is for technical facts and instructions. Do not apply it to marketing copy, blog voice, or brand writing. When a user asks for STE on marketing text, say so and offer it for the docs instead.

This skill is an unofficial aid. It is not affiliated with or endorsed by ASD or STEMG, and no tool can guarantee STE compliance. ASD-STE100 is a registered trademark of ASD. The official standard is a free download at asd-ste100.org.

## References

- `references/rules.md`: the 53-rule catalog, vocabulary rulings, slop table, consistency pass, other text types, and a full before/after example. Read it for strict mode, check mode, and full audits.
- `references/checklist.md`: full verification pass with searchable patterns
- `references/use-cases.md`: error messages, runbooks, incident reports, commits, UI copy, i18n
