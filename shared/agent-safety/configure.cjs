#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const pathModule = require("node:path");
const os = require("node:os");

const ASK_RULES = [
  "Bash(dangerouslyDisableSandbox:true)",
  "Bash(rm *)",
  "Bash(*/rm *)",
  "Bash(rmdir *)",
  "Bash(*/rmdir *)",
  "Bash(unlink *)",
  "Bash(*/unlink *)",
  "Bash(shred *)",
  "Bash(*/shred *)",
  "Bash(truncate *)",
  "Bash(*/truncate *)",
  "Bash(dd *)",
  "Bash(*/dd *)",
  "Bash(find * -delete*)",
  "Bash(*/find * -delete*)",
  "Bash(command *)",
  "Bash(exec *)",
  "Bash(builtin *)",
  "Bash(env *)",
  "Bash(*/env *)",
  "Bash(sudo *)",
  "Bash(*/sudo *)",
  "Bash(bash -c *)",
  "Bash(sh -c *)",
  "Bash(zsh -c *)",
  "Bash(*/bash -c *)",
  "Bash(*/sh -c *)",
  "Bash(*/zsh -c *)",
  "Bash(git -*)",
  "Bash(*/git *)",
  "Bash(git clean *)",
  "Bash(git reset --hard)",
  "Bash(git reset --hard *)",
  "Bash(git checkout -- *)",
  "Bash(git restore *)",
  "Bash(git branch -D *)",
];

function parseJsonc(text) {
  let output = "";
  let string = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (string) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      output += char;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      output += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else if (char === "}" || char === "]") {
      let end = output.length;
      while (/\s/.test(output[end - 1] ?? "")) end--;
      if (output[end - 1] === ",") output = output.slice(0, end - 1) + output.slice(end);
      output += char;
    } else {
      output += char;
    }
  }
  return JSON.parse(output);
}

function configureClaude(text) {
  const settings = text.trim() ? parseJsonc(text) : {};
  settings.sandbox = {
    ...settings.sandbox,
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: settings.sandbox?.allowUnsandboxedCommands === false ? false : true,
    failIfUnavailable: true,
  };
  settings.permissions = {
    ...settings.permissions,
    ask: [...new Set([...(settings.permissions?.ask ?? []), ...ASK_RULES])],
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function configurePi(text, toolkitDir, piAgentDir, piWebConfigDir) {
  const paths = [toolkitDir, piAgentDir, piWebConfigDir];
  if (paths.some((value) => !pathModule.isAbsolute(value))) throw new Error("Pi safety paths must be absolute");
  if (paths.some((value) => /[*?]/.test(value))) throw new Error("Pi safety paths cannot contain permission glob characters");

  const canonical = (value) => fs.existsSync(value) ? fs.realpathSync(value) : pathModule.resolve(value);
  const toolkit = canonical(toolkitDir);
  const agentDir = canonical(piAgentDir);
  const webConfigDir = canonical(piWebConfigDir);
  const settings = JSON.parse(text);
  const home = os.homedir();
  settings.piInfrastructureReadPaths = [
    pathModule.join(toolkit, "codex/skills"),
    pathModule.join(toolkit, "pi/skills"),
    canonical(pathModule.join(home, ".agents/skills")),
    canonical(pathModule.join(home, ".claude/skills")),
    canonical(pathModule.join(home, ".codex/skills")),
    // ponytail: trusted read-only development roots; writes still use the external-directory gate.
    canonical(pathModule.join(home, "Code")),
    canonical(pathModule.join(home, "orca/workspaces")),
  ];
  settings.permission.path[pathModule.join(agentDir, "auth.json")] = "deny";
  settings.permission.path[pathModule.join(webConfigDir, "web-search.json")] = "deny";
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function configureCodex(text) {
  if (text.includes("'''") || text.includes('\"\"\"')) {
    throw new Error("refusing to rewrite Codex TOML containing multiline strings");
  }
  const table = text.search(/^[ \t]*\[{1,2}[^\]\r\n]+\]{1,2}[ \t]*(?:#[^\r\n]*)?$/m);
  let head = table < 0 ? text : text.slice(0, table);
  const tail = table < 0 ? "" : text.slice(table);
  if (/^[ \t]*(?:(?:default_permissions|permission_profile|profile)|["'](?:default_permissions|permission_profile|profile)["'])[ \t]*=/m.test(head)) {
    throw new Error("refusing Codex permission profiles; configure the selected profile directly");
  }
  if (/^[ \t]*["'](?:sandbox_mode|approval_policy)["'][ \t]*=/m.test(head)) {
    throw new Error("refusing quoted Codex safety keys");
  }

  if (/^[ \t]*sandbox_mode\s*=\s*(["'])read-only\1[ \t]*(?:#[^\r\n]*)?$/m.test(head)) {
    // Preserve a stricter user policy.
  } else if (/^[ \t]*sandbox_mode\s*=/m.test(head)) {
    head = head.replace(/^[ \t]*sandbox_mode\s*=.*$/m, 'sandbox_mode = "workspace-write"');
  } else {
    head = `sandbox_mode = "workspace-write"\n${head}`;
  }

  if (/^[ \t]*approval_policy\s*=\s*(["'])untrusted\1[ \t]*(?:#[^\r\n]*)?$/m.test(head) || /^[ \t]*approval_policy\s*=\s*\{/m.test(head)) {
    // Preserve stricter or granular user policies.
  } else if (/^[ \t]*approval_policy\s*=/m.test(head)) {
    head = head.replace(/^[ \t]*approval_policy\s*=.*$/m, 'approval_policy = "on-request"');
  } else {
    head = `approval_policy = "on-request"\n${head}`;
  }

  return `${head.replace(/\s+$/, "")}\n\n${tail.replace(/^\s+/, "")}`.replace(/\n+$/, "\n");
}

if (process.argv[2] === "--self-test") {
  const claude = JSON.parse(configureClaude('{// keep values\n"permissions":{"ask":["Bash(custom *)",],},}'));
  assert.equal(claude.sandbox.enabled, true);
  assert.deepEqual(claude.permissions.ask.slice(0, 2), ["Bash(custom *)", ASK_RULES[0]]);
  const pi = JSON.parse(configurePi('{"piInfrastructureReadPaths":[],"permission":{"path":{}}}', "/toolkit", "/pi-agent", "/pi-config"));
  assert.deepEqual(pi.piInfrastructureReadPaths.slice(0, 2), [
    "/toolkit/codex/skills",
    "/toolkit/pi/skills",
  ]);
  assert.equal(pi.piInfrastructureReadPaths.some((value) => value.endsWith("/.agents/skills")), true);
  assert.equal(pi.piInfrastructureReadPaths.some((value) => value.endsWith("/Code")), true);
  assert.equal(pi.piInfrastructureReadPaths.some((value) => value.endsWith("/orca/workspaces")), true);
  assert.equal(pi.permission.path["/pi-agent/auth.json"], "deny");
  assert.equal(pi.permission.path["/pi-config/web-search.json"], "deny");
  assert.throws(() => configurePi('{"permission":{"path":{}}}', "/tool?kit", "/pi-agent", "/pi-config"));
  assert.match(configureCodex('sandbox_mode = "danger-full-access"\napproval_policy = "never"\n\n[features]\nhooks = true\n'), /^sandbox_mode = "workspace-write"\napproval_policy = "on-request"/);
  assert.match(configureCodex("  sandbox_mode = 'read-only' # keep\n  approval_policy = 'untrusted' # keep\n"), /sandbox_mode = 'read-only' # keep\n  approval_policy = 'untrusted' # keep/);
  assert.match(configureCodex('[profiles.unsafe] # local\nsandbox_mode = "danger-full-access"\n'), /^approval_policy = "on-request"\nsandbox_mode = "workspace-write"/);
  assert.throws(() => configureCodex('note = """\nsandbox_mode = "read-only"\n"""\n'));
  assert.throws(() => configureCodex('permission_profile = "default"\n'));
  assert.throws(() => configureCodex('profile = "unsafe"\n[profiles.unsafe]\nsandbox_mode = "danger-full-access"\n'));
  assert.throws(() => configureCodex("'profile' = 'unsafe'\n[profiles.unsafe]\nsandbox_mode = 'danger-full-access'\n"));
  assert.throws(() => configureCodex("'sandbox_mode' = 'read-only'\n"));
  assert.match(configureCodex('[mcp_servers.foo.env]\nprofile = "dev"\n'), /^approval_policy = "on-request"\nsandbox_mode = "workspace-write"/);
  console.log("agent-safety configure self-test passed");
  process.exit(0);
}

const [, , host, path, extra, piAgentDir, piWebConfigDir] = process.argv;
if (!path || !["claude", "codex", "pi"].includes(host) || (host === "pi" && (!extra || !piAgentDir || !piWebConfigDir))) {
  console.error("usage: configure.cjs <claude|codex|pi> <path> [toolkit-dir pi-agent-dir pi-web-config-dir]");
  process.exit(2);
}
const text = fs.readFileSync(path, "utf8");
const configured = host === "claude" ? configureClaude(text) : host === "codex" ? configureCodex(text) : configurePi(text, extra, piAgentDir, piWebConfigDir);
fs.writeFileSync(path, configured);
