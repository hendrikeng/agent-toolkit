# Token-efficient Figma MCP for Pi

A global Pi extension that keeps Figma completely out of model requests until you explicitly enable it.

## Commands

```text
/figma on local    # Figma desktop MCP: fast, current selection, read-only
/figma on remote   # Figma remote MCP: OAuth, URL-based reads and canvas writes
/figma on          # interactive endpoint picker
/figma status
/figma tools
/figma off
```

The extension exposes the entire active Figma server through **one compact Pi tool** (`figma_mcp`) instead of forwarding every MCP schema to the model. `/figma off` removes that schema from future model requests and closes the connection.

## How it stays small

- Default state is off for every Pi session.
- MCP SDK modules and connections are loaded lazily.
- Remote OAuth starts only after `/figma on remote`.
- The OAuth proxy receives only the MCP SDK's safe environment allowlist, its dedicated config directory, and explicit browser/proxy/TLS variables; Pi's provider and cloud credentials are not forwarded.
- Common reads have compact aliases: `inspect`, `screenshot`, `variables`, `metadata`, and `figjam`.
- Other tools use `catalog` → `schema` → `call`, so only the needed schema enters conversation context.
- Official Figma guidance is fetched on demand with `resources` / `resource` rather than installed as always-visible skills.
- Text results are capped at Pi's 50 KB / 2,000-line limits; full truncated output is written under the system temp directory.

## Requirements

### Local desktop

Open the Figma desktop app and enable its desktop MCP server. The endpoint is:

```text
http://127.0.0.1:3845/mcp
```

The desktop server supports read workflows and the current Figma selection.

### Remote

The remote endpoint is:

```text
https://mcp.figma.com/mcp
```

The first connection opens a browser for Figma OAuth. Credentials are managed by `mcp-remote` under:

```text
~/.pi/agent/mcp-auth/
```

Remote mode is required for Figma's canvas-write tools. Before `use_figma`, the agent is required to load the official `figma-use` resource and pass its required `skillNames` argument.

## Installation layout

This extension is installed globally at:

```text
~/.pi/agent/extensions/figma-mcp/
```

After edits or first installation, run `/reload` in Pi. Dependencies are pinned in `package.json` and `package-lock.json`.
