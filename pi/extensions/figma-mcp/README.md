# Token-efficient Figma Desktop MCP for Pi

A global Pi extension that keeps Figma's main tool out of model requests until a Figma task needs it.

## Commands

```text
/figma on       # connect to Figma Desktop MCP
/figma status
/figma tools
/figma off
```

The model may also call the tiny `enable_figma` loader automatically when a task references Figma. The extension exposes all five desktop server tools through one compact Pi tool (`figma_mcp`) rather than forwarding every MCP schema to the model. `/figma off` removes that schema and leaves only the loader available.

## How it stays small

- Each Pi session starts with only `enable_figma`; MCP modules and connections load lazily.
- Common reads have compact aliases: `inspect`, `screenshot`, `variables`, `metadata`, and `figjam`.
- Other tools use `catalog` → `schema` → `call`, so only the needed schema enters conversation context.
- Official Figma guidance is fetched on demand with `resources` / `resource` rather than installed as an always-visible skill.
- Text results are capped at Pi's 50 KB / 2,000-line limits; full truncated output is written under the system temp directory.

## Requirements

Open Figma Desktop and enable its desktop MCP server at:

```text
http://127.0.0.1:3845/mcp
```

The desktop server supports read workflows and the current Figma selection.

## Remote limitation

Pi does not advertise remote/write mode. Figma's hosted MCP server currently rejects OAuth Dynamic Client Registration from clients outside its approved MCP catalog, so generic bridges such as `mcp-remote` fail with HTTP 403 before OAuth can begin. Use Figma Desktop here, or native Codex CLI for Figma remote/write access. Re-add remote mode only when Figma officially supports Pi or provides approved client credentials.

Official references:

- https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/
- https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/

## Installation

The extension is symlinked to `~/.pi/agent/extensions/figma-mcp/`. Run `/reload` in an existing Pi session after installation or updates. Dependencies are pinned in `package.json` and `package-lock.json`.
