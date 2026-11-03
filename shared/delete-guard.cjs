#!/usr/bin/env node
'use strict'
// PreToolUse/PostToolUse hook for Claude Code and Codex shell commands.
// Refuses deletes outside the current repository's interior and this session's mktemp directories.
// It fails closed: a target the guard cannot resolve is refused.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const HINT = /\b(?:rm|unlink|pg-test)\b|-delete\b/
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const DELETERS = new Set(['rm', 'unlink', ...SHELLS])
const KEYWORDS = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac'])
const WRAPPERS = new Set(['time', 'sudo', 'doas', 'command', 'builtin', 'exec', 'nohup', 'nice', 'timeout', 'env', 'stdbuf', 'caffeinate'])
const DECLARE = new Set(['export', 'local', 'declare', 'readonly', 'typeset'])
const DISPATCH = new Set(['rm', 'unlink', 'find', 'xargs', 'eval', 'trap', 'cd', 'pushd', 'popd', 'pg-test', ...SHELLS, ...DECLARE])
const SAFE = 'd=$(mktemp -d) || exit 1; ...; rm -rf -- "${d:?}"'
const unknown = why => ({ kind: 'unknown', why })

// Close index of a backtick body. Bash removes backslashes in it before it runs the body, so refuse them.
function backtick(src, i) {
  const end = src.indexOf('`', i + 1)
  if (end < 0) throw Error('unbalanced backtick')
  if (src.slice(i + 1, end).includes('\\')) throw Error('a backslash inside backticks')
  return end
}

// Close index of a $'...' string that starts at i; a backslash escapes the next character.
function closeAnsi(src, i) {
  while (i < src.length && src[i] !== "'") i += src[i] === '\\' ? 2 : 1
  if (i >= src.length) throw Error('unbalanced quote')
  return i
}

// Close index of a $( ... ) or <( ... ) body that starts at i, skipping quoted text and heredoc bodies.
function closeParen(src, i) {
  const docs = [], start = i
  for (let depth = 1; i < src.length; i++) {
    const c = src[i], doc = c === '<' && /^<<-?[ \t]*(['"]?)([^\s'";&|<>()]+)\1/.exec(src.slice(i))
    if (doc && src[i + 2] !== '<') { docs.push(doc[2]); i += doc[0].length - 1 }
    else if (c === '\n') for (const delimiter of docs.splice(0)) {
      for (let line = null; line?.replace(/^\t+/, '') !== delimiter && i < src.length; ) {
        const end = src.indexOf('\n', i + 1)
        line = src.slice(i + 1, end < 0 ? src.length : end)
        i = end < 0 ? src.length : end
      }
    }
    else if (c === '\\') i++
    else if (c === '#' && (i === start || /[\s;&|(]/.test(src[i - 1]))) { const end = src.indexOf('\n', i); i = (end < 0 ? src.length : end) - 1 }
    else if (c === '$' && src[i + 1] === "'") i = closeAnsi(src, i + 2)
    else if (c === "'") i = src.indexOf("'", i + 1)
    else if (c === '"') { for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++ }
    else if (c === '(') depth++
    // A case pattern such as `clean)` does not close the substitution in bash.
    else if (c === ')' && --depth === 0) { if (/\bcase\b/.test(src.slice(start, i))) throw Error('a case statement inside a substitution'); return i }
    if (i < 0) break
  }
  throw Error('unbalanced parentheses')
}

// Splits shell text into simple commands. Each word is a list of parts:
// { lit, quoted } | { var, required, other } | { sub } (command or process substitution).
function parse(src) {
  const commands = [], pending = []
  let i = 0, word = null, raw = 0, skip = false, input = false
  let current = { words: [], op: '', input: [], redirects: [] }
  const add = part => {
    if (!word) { word = []; raw = i }
    const last = word.at(-1)
    if (part.lit !== undefined && last?.lit !== undefined && last.quoted === part.quoted) last.lit += part.lit
    else word.push(part)
  }
  const endWord = () => {
    if (word) {
      word.raw = src.slice(raw, i)
      if (input) current.input.push(word.every(p => p.lit !== undefined) ? word.map(p => p.lit).join('') : null)
      // Redirection targets are not arguments, but their substitutions still run.
      if (skip || input) current.redirects.push(word)
      else current.words.push(word)
      skip = input = false
    }
    word = null
  }
  const endCommand = op => {
    endWord()
    if (current.words.length || current.input.length) commands.push(current)
    // A newline after | or && continues the same pipeline or list.
    current = { words: [], op: current.words.length || current.input.length || !current.op ? op : current.op, input: [], redirects: [] }
    skip = input = false
  }
  const dropDescriptor = () => { if (word?.every(p => p.lit !== undefined && !p.quoted && /^\d*$/.test(p.lit))) word = null }
  function dollar(quoted) {
    const start = i
    // $(( can also open a subshell substitution, so arithmetic bodies are checked as commands too.
    if (src.startsWith('$(', i)) { const end = closeParen(src, i + 2); add({ sub: src.slice(i + 2, end) }); i = end + 1; return }
    if (src[i + 1] === '"' && !quoted) { i++; return } // $"..." is a locale string; the $ disappears.
    if ('=~^+'.includes(src[i + 1] ?? ' ')) { add(unknown('a zsh expansion')); i += 2; return }
    if (src.startsWith("$'", i) && !quoted) {
      const end = closeAnsi(src, i + 2), body = src.slice(i + 2, end)
      add(body.includes('\\') ? unknown("a backslash escape inside $'...'") : { lit: body, quoted: true }); i = end + 1; return
    }
    if (src[i + 1] === '{') {
      const end = src.indexOf('}', i)
      if (end < 0) throw Error('unbalanced braces')
      const body = src.slice(i + 2, end)
      if (/\$\(|`/.test(body)) throw Error('a command substitution inside ${...}')
      const name = /^(?:[A-Za-z_]\w*|\d+|[@*#?$!-])/.exec(body)?.[0]
      const rest = name ? body.slice(name.length) : body
      add({ var: name ?? body, required: /^:\?/.test(rest), other: !name || (rest !== '' && !/^:\?/.test(rest)), quoted, raw: src.slice(start, end + 1) })
      i = end + 1
      return
    }
    const name = /^(?:[A-Za-z_]\w*|\d|[@*#?$!-])/.exec(src.slice(i + 1))?.[0]
    if (!name) { i++; return add({ lit: '$', quoted }) }
    add({ var: name, required: false, other: false, quoted })
    i += 1 + name.length
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '\\' && src[i + 1] === '\n') i += 2
    else if (c === '\\') { add({ lit: src[i + 1] ?? '', quoted: true }); i += 2 }
    else if (c === "'") { const end = src.indexOf("'", i + 1); if (end < 0) throw Error('unbalanced quote'); add({ lit: src.slice(i + 1, end), quoted: true }); i = end + 1 }
    else if (c === '"') {
      add({ lit: '', quoted: true })
      for (i++; src[i] !== '"'; ) {
        if (i >= src.length) throw Error('unbalanced quote')
        if (src[i] === '\\' && src[i + 1] === '\n') i += 2 // line continuation
        else if (src[i] === '\\' && '$`"\\'.includes(src[i + 1])) { add({ lit: src[i + 1], quoted: true }); i += 2 }
        else if (src[i] === '$') dollar(true)
        else if (src[i] === '`') { const end = backtick(src, i); add({ sub: src.slice(i + 1, end) }); i = end + 1 }
        else add({ lit: src[i++], quoted: true })
      }
      i++
    }
    else if (c === '$') dollar(false)
    else if (c === '`') { const end = backtick(src, i); add({ sub: src.slice(i + 1, end) }); i = end + 1 }
    else if (c === '#' && !word) { while (i < src.length && src[i] !== '\n') i++ }
    else if (c === ' ' || c === '\t') { endWord(); i++ }
    else if (c === '\n') {
      endWord(); i++
      for (const doc of pending.splice(0)) {
        const lines = []
        for (;;) {
          const end = src.indexOf('\n', i), line = src.slice(i, end < 0 ? src.length : end)
          i = end < 0 ? src.length : end + 1
          if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delimiter) break
          lines.push(line)
          if (end < 0) throw Error('unterminated heredoc')
        }
        // The parent shell expands an unquoted heredoc before the child reads it.
        const body = lines.join('\n')
        doc.command.input.push(doc.quoted || !/[\\$`]/.test(body) ? body : null)
      }
      endCommand('\n')
    }
    else if ((c === '<' || c === '>') && src[i + 1] === '(') { const end = closeParen(src, i + 2); add({ sub: src.slice(i + 2, end) }); i = end + 1 }
    else if (c === '<' && src.startsWith('<<<', i)) { dropDescriptor(); endWord(); i += 3; input = true }
    else if (c === '<' && src[i + 1] === '<') {
      dropDescriptor(); endWord(); i += 2
      const strip = src[i] === '-'
      if (strip) i++
      while (src[i] === ' ' || src[i] === '\t') i++
      const match = /^[^\s;&|<>()]+/.exec(src.slice(i))
      if (!match) throw Error('missing heredoc delimiter')
      i += match[0].length
      pending.push({ command: current, strip, delimiter: match[0].replace(/['"\\]/g, ''), quoted: /['"\\]/.test(match[0]) })
    }
    else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      dropDescriptor()
      endWord()
      while ('<>&|'.includes(src[i]) && i < src.length) i++
      skip = true
    }
    else if (c === '(' && (word || current.words.length) && src[i + 1] !== ')') throw Error('a parenthesis inside a command')
    else if (';&|()'.includes(c)) {
      const op = /^(?:;;&?|;&|&&|\|\||\|&|[;&|()])/.exec(src.slice(i))[0]
      endCommand(op)
      i += op.length
    }
    else { let j = i; while (j < src.length && !' \t\n\\\'"$`#;&|()<>'.includes(src[j])) j++; if (j === i) j++; add({ lit: src.slice(i, j), quoted: false }); i = j }
  }
  if (pending.length) throw Error('unterminated heredoc')
  endCommand('')
  return commands
}

const literal = word => word && word.every(p => p.lit !== undefined) ? word.map(p => p.lit).join('') : null
const base = text => text == null ? null : path.basename(text)
const assignment = word => word[0]?.lit !== undefined && !word[0].quoted ? /^([A-Za-z_]\w*)(\+?)=/.exec(word[0].lit) : null

// Resolves a word to { kind: 'path', text, glob } | { kind: 'owned', suffix, glob } | unknown.
function resolve(word, ctx, isValue = false) {
  let text = '', glob = -1, owned = false, brace = -1
  for (const [k, part] of word.entries()) {
    if (part.kind === 'unknown') return part
    if (part.sub !== undefined) return unknown(`the command substitution $(${part.sub})`)
    if (part.var !== undefined) {
      const value = ctx.vars.get(part.var)
      if (part.other) return unknown(`the expansion ${part.raw}`)
      if (value === undefined) {
        if (['HOME', 'TMPDIR'].includes(part.var) && ctx.env[part.var]) { text += ctx.env[part.var]; continue }
        return unknown(`$${part.var}, which this command does not set`)
      }
      // A skipped or conditional assignment leaves the variable empty, so every use needs :?.
      if (!part.required) return unknown(`$${part.var}; write it as "\${${part.var}:?}"`)
      if (value.kind === 'owned') {
        if (k > 1 || (k === 1 && word[0].lit !== '')) return unknown(`$${part.var}; write the mktemp variable as "\${${part.var}:?}" at the start of the path`)
        if (!part.quoted && /[\s*?[{]/.test(value.suffix)) return unknown(`unquoted $${part.var}, which the shell splits or expands`)
        owned = true; text = value.suffix; continue
      }
      if (value.kind === 'path' && !part.quoted && /[\s*?[{]/.test(value.text)) return unknown(`unquoted $${part.var}, which the shell splits or expands`)
      if (value.kind === 'path') { text += value.text; continue }
      return value
    }
    let lit = part.lit
    if (!part.quoted && k === 0 && lit.startsWith('~')) {
      if (!/^~(\/|$)/.test(lit) || !ctx.env.HOME) return unknown(`the path ${lit}`)
      lit = ctx.env.HOME + lit.slice(1)
    }
    // Bash expands {a,"b"} before quote removal, so a brace that spans parts cannot be judged.
    if (!part.quoted && /\{[^}]*~/.test(lit)) return unknown('a tilde inside a brace expansion')
    if (!part.quoted && brace >= 0 && lit.includes('}')) return unknown('a brace expansion with quoted or expanded parts')
    if (!part.quoted && lit.includes('{') && !/\{[^}]*\}/.test(lit.slice(lit.lastIndexOf('{')))) brace = k
    const g = part.quoted || isValue ? -1 : lit.search(/[*?[]|\{[^}]*(,|\.\.)[^}]*\}/)
    if (g >= 0 && glob < 0) glob = text.length + g
    text += lit
  }
  return owned ? { kind: 'owned', suffix: text, glob } : { kind: 'path', text, glob }
}

// Physical path: realpath of the longest existing prefix, so `..` after a symlink cannot escape.
function physical(abs) {
  const parts = abs.split('/')
  for (let n = parts.length; n > 0; n--) {
    try { return path.resolve(fs.realpathSync.native(parts.slice(0, n).join('/') || '/'), ...parts.slice(n)) } catch {}
  }
  return path.resolve(abs)
}

function judge(value, ctx, display) {
  if (value.kind === 'unknown') return `${display} uses ${value.why}`
  const text = value.kind === 'owned' ? value.suffix : value.text
  if (value.kind === 'path' && text === '') return `${display} is empty`
  if (value.kind === 'owned' && text && !text.startsWith('/')) return `${display} names a sibling of the mktemp directory`
  // A glob deletes children of its static directory, so judge that directory.
  // A matched entry can be a symbolic link, so no path component can follow the glob.
  if (value.glob >= 0 && /\.\.|\//.test(text.slice(value.glob))) return `${display} has .. or another path component in or after a glob or brace`
  const fixed = value.glob >= 0 ? text.slice(0, text.lastIndexOf('/', value.glob) + 1) : text
  const targets = value.kind === 'owned' ? [{ kind: 'owned', suffix: fixed }]
    : fixed.startsWith('/') ? [{ kind: 'path', text: fixed }]
    : ctx.cwds.map(cwd => cwd.kind === 'unknown' ? cwd : cwd.kind === 'owned' ? { kind: 'owned', suffix: `${cwd.suffix}/${fixed}` } : { kind: 'path', text: `${cwd.text}/${fixed}` })
  // Older bash versions match .. with a glob that starts with a dot.
  if (value.glob >= 0 && /^\.|[{,]\./.test(text.slice(fixed.length))) return `${display} has a glob that starts with a dot`
  for (const target of targets) {
    if (target.kind === 'unknown') return `${display} is relative to a directory that the guard cannot resolve`
    if (target.kind === 'owned') {
      if (target.suffix.split('/').includes('..')) return `${display} uses .. after the mktemp directory`
      if (target.suffix && !target.suffix.startsWith('/')) return `${display} names a sibling of the mktemp directory`
      continue
    }
    const real = physical(target.text)
    if ([real, path.resolve(target.text)].some(p => path.dirname(p) === '/' || p === '/')) return `${display} resolves to a root or top-level system path (${real})`
    if (ctx.home && (real === ctx.home || ctx.home.startsWith(real + '/'))) return `${display} resolves to the home directory or one of its parents (${real})`
    if (ctx.owned.some(dir => real === dir || real.startsWith(dir + '/'))) continue
    if (ctx.repo && real.startsWith(ctx.repo + '/')) {
      if (path.relative(ctx.repo, real).split('/')[0] === '.git') return `${display} is Git metadata (${real})`
      continue
    }
    if (real === ctx.repo) return `${display} is the repository root (${real})`
    return `${display} resolves outside the current repository and this session's mktemp directories (${real})`
  }
  return null
}

function run(words, command, ctx, counts) {
  let name = base(literal(words[0]))
  if (WRAPPERS.has(name)) {
    const j = words.findIndex((word, k) => k > 0 && DISPATCH.has(base(literal(word))))
    if (j < 0) return null
    words = words.slice(j); name = base(literal(words[0]))
  }
  const args = words.slice(1), texts = args.map(literal)
  const target = (word, label = 'the target') => judge(resolve(word, ctx), ctx, `${label} ${word.raw}`)
  if (name === 'rm' || name === 'unlink') {
    let options = name === 'rm'
    for (const word of args) {
      if (options && literal(word) === '--') { options = false; continue }
      if (options && /^-./.test(literal(word) ?? '')) continue
      const reason = target(word)
      if (reason) return reason
    }
  } else if (name === 'find') {
    let deletes = texts.includes('-delete')
    for (let k = 0; k < texts.length; k++) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(texts[k])) continue
      let end = k + 1
      while (end < texts.length && texts[end] !== ';' && texts[end] !== '+') end++
      const action = args.slice(k + 1, end), j = action.findIndex(word => DELETERS.has(base(literal(word))))
      k = end
      if (j < 0) continue
      deletes = true
      if (SHELLS.has(base(literal(action[j])))) return 'find -exec runs a shell script on the found paths'
      // Extra paths beside {} are deleted too.
      for (const word of action.slice(j + 1)) {
        if (/^(\{\}|--|-.+)$/.test(literal(word) ?? '')) continue
        const reason = target(word)
        if (reason) return reason
      }
    }
    if (!deletes) return null
    if (texts.some(text => text === '-follow' || /^-[HLPEXdsx]*[HL][HLPEXdsx]*$/.test(text ?? ''))) return 'find follows symbolic links while it deletes'
    let k = 0
    const starts = []
    for (;;) {
      if (/^(-[HLPEXdsx]+|--|-O\d*)$/.test(texts[k] ?? '')) k++
      else if (texts[k] === '-D') k += 2
      else if (texts[k] === '-f' && args[k + 1]) { starts.push(args[k + 1]); k += 2 }
      else break
    }
    for (; k < args.length && !/^[-(!]/.test(texts[k] ?? ''); k++) starts.push(args[k])
    for (const word of starts.length ? starts : [Object.assign([{ lit: '.', quoted: false }], { raw: '.' })]) {
      const reason = target(word, 'the find start path')
      if (reason) return reason
    }
  } else if (name === 'xargs') {
    if (texts.some(text => DELETERS.has(base(text))) || HINT.test(texts.join(' '))) return 'xargs passes computed targets to a delete command'
  } else if (name === 'eval') {
    const code = texts[0] === '--' ? texts.slice(1) : texts
    if (code.some(text => text === null)) return 'eval runs computed text'
    return check(code.join(' '), ctx)
  } else if (name === 'trap') {
    const k = texts[0] === '--' ? 1 : 0
    if (args.length <= k || /^-[lp]$/.test(texts[k] ?? '')) return null
    if (texts[k] === null) return `the trap action ${args[k].raw} is computed; use single quotes and "\${d:?}"`
    ctx.traps.push(texts[k])
  } else if (SHELLS.has(name)) {
    let k = 0, inline = false, stdin = false
    for (; k < args.length; k++) {
      const text = texts[k] ?? ''
      if (text === '--' || text === '-') { stdin ||= text === '-'; k++; break }
      if (/^(--rcfile|--init-file|[-+][oO])$/.test(text)) k++
      else if (/^-[A-Za-z]+$/.test(text)) { inline ||= text.includes('c'); stdin ||= text.includes('s') }
      else if (!/^(--[\w-]+|\+[A-Za-z]+)$/.test(text)) break
    }
    if (inline) {
      if (k >= args.length || texts[k] === null) return `${name} -c runs a computed script`
      return check(texts[k], { ...ctx, vars: new Map(), traps: [] })
    }
    if (!stdin && k < args.length) return null // ponytail: script files are not inspected; the hook sees only the command line.
    for (const text of command.input) {
      if (text === null) return `${name} reads a computed script`
      const reason = check(text, { ...ctx, vars: new Map(ctx.vars), traps: [] })
      if (reason) return reason
    }
    if (!command.input.length && /^\|&?$/.test(command.op)) return `a script piped into ${name} cannot be checked`
  } else if (name === 'pg-test') {
    if (texts.find(text => !text?.startsWith('-')) === 'gc') return '`pg-test gc` affects fixtures that other sessions own; run `pg-test stop <id>` for your own fixture'
  } else if (DECLARE.has(name)) {
    for (const word of args) if (assignment(word)) assign(word, ctx, counts)
  } else if (name === 'cd' || name === 'pushd' || name === 'popd') {
    const word = args.find((_, k) => !/^(-[LPe@]+|--)$/.test(texts[k] ?? ''))
    const value = name === 'popd' || texts[0] === '-' ? unknown('popd') : word ? resolve(word, ctx) : { kind: 'path', text: ctx.env.HOME ?? '' }
    const next = value.kind === 'unknown' || value.glob >= 0 ? [unknown('cd')]
      : value.kind === 'owned' || value.text.startsWith('/') ? [value]
      : ctx.cwds.map(cwd => cwd.kind === 'path' ? { kind: 'path', text: `${cwd.text}/${value.text}` } : cwd.kind === 'owned' ? { kind: 'owned', suffix: `${cwd.suffix}/${value.text}` } : cwd)
    // A failed cd leaves the old directory, so relative targets must pass for every candidate.
    ctx.cwds = [...ctx.cwds, ...next]
  }
  return null
}

function assign(word, ctx, counts) {
  const [match, name, append] = assignment(word)
  const value = [{ ...word[0], lit: word[0].lit.slice(match.length) }, ...word.slice(1)].filter(p => p.lit !== '')
  const inner = value.length === 1 && value[0].sub !== undefined ? parse(value[0].sub) : null
  const mktemp = inner?.length === 1 && base(literal(inner[0].words[0])) === 'mktemp' && !inner[0].words.some(w => /^-(-dry-run|\w*u\w*)$/.test(literal(w) ?? ''))
  if (counts.get(name) > 1 || append) ctx.vars.set(name, unknown(`$${name}, which this command assigns more than once`))
  else if (ctx.env[name] !== undefined) ctx.vars.set(name, unknown(`$${name}, which shadows an environment variable`))
  else ctx.vars.set(name, mktemp ? { kind: 'owned', suffix: '' } : resolve(value, ctx, true))
}

function check(src, ctx) {
  const commands = parse(src), counts = new Map(), traps = ctx.traps.length
  // A function or loop body can run after a later cd, so its relative targets have no known directory.
  if (/\b(cd|pushd|popd)\b/.test(src) && /\b(for|while|until|select|function)\b|\(\s*\)/.test(src)) ctx.cwds = [...ctx.cwds, unknown('cd')]
  const count = name => counts.set(name, (counts.get(name) ?? 0) + 1)
  // A variable assigned twice, including by read in a loop, has no single safe value.
  for (const { words } of commands) {
    const reads = words.some(word => literal(word) === 'read')
    for (const word of words) {
      const match = assignment(word), text = literal(word)
      if (match) count(match[1])
      else if (reads && /^[A-Za-z_]\w*$/.test(text ?? '')) count(text), count(text)
    }
  }
  for (const command of commands) {
    const { words } = command
    for (const word of [...words, ...command.redirects]) for (const part of word) if (part.sub !== undefined) {
      const reason = check(part.sub, { ...ctx, vars: new Map(ctx.vars), traps: [] })
      if (reason) return reason
    }
    let k = 0
    while (k < words.length && KEYWORDS.has(literal(words[k]))) k++
    const first = literal(words[k])
    if (first === 'for' || first === 'select') { ctx.vars.set(literal(words[k + 1]), unknown('a loop variable')); continue }
    if (first === 'case') continue
    // The body of `function name { ...` continues in the same simple command.
    if (first === 'function') for (k += 2; k < words.length && KEYWORDS.has(literal(words[k])); ) k++
    while (k < words.length && assignment(words[k])) k++
    if (k === words.length) { for (const word of words) if (assignment(word)) assign(word, ctx, counts); continue }
    const reason = run(words.slice(k), command, ctx, counts)
    if (reason) return reason
  }
  for (const trap of ctx.traps.splice(traps)) {
    const reason = check(trap, ctx)
    if (reason) return reason
  }
  return null
}

// Number of directory-creating mktemp calls; a parse error counts as none.
function mktempDirs(src) {
  try {
    return parse(src).reduce((n, { words, redirects }) => {
      for (const word of [...words, ...redirects]) for (const part of word) if (part.sub !== undefined) n += mktempDirs(part.sub)
      const texts = words.map(literal), k = texts.findIndex(text => base(text) === 'mktemp')
      return n + (k >= 0 && texts.slice(k + 1).some(text => /^(-\w*d\w*|--directory)$/.test(text ?? '')) && !texts.some(text => /^-(-dry-run|\w*u\w*)$/.test(text ?? '')) ? 1 : 0)
    }, 0)
  } catch { return 0 }
}

const real = file => { try { return fs.realpathSync.native(file) } catch { return null } }
const exists = file => { try { return fs.lstatSync(file) } catch { return null } }

// Returns a refusal reason, or null when the command may run.
function evaluate(command, { cwd, env = process.env, owned = [], repo = null }) {
  if (!HINT.test(command)) return null
  const home = env.HOME ? real(env.HOME) ?? path.resolve(env.HOME) : null
  repo = repo && real(repo)
  if (repo && (repo === '/' || (home && (repo === home || home.startsWith(repo + '/'))))) repo = null
  try {
    return check(command, { cwds: [{ kind: 'path', text: cwd }], vars: new Map(), traps: [], env, home, repo, owned: owned.map(real).filter(Boolean) })
  } catch (error) { return `the guard cannot parse this command (${error.message})` }
}

const message = reason => `Delete guard refused this command: ${reason}.
Delete only paths strictly inside the current repository (not its root or .git), or a temporary directory that this session created with mktemp.
Never delete an existing shared name, a computed path, or another session's files. Safe pattern: ${SAFE}
If this deletion is necessary, ask the human to run it.`

function hook(input) {
  let command = input.tool_input?.command
  if (Array.isArray(command)) command = command.length >= 3 && /^-\w*c$/.test(command[1]) ? command[2] : command.join(' ')
  if (typeof command !== 'string') return null
  const tmp = real(os.tmpdir())
  const state = input.session_id && tmp ? path.join(tmp, 'agent-toolkit-delete-guard', `${String(input.session_id).replace(/[^\w.-]/g, '_')}.jsonl`) : null
  // Trust state only in a private directory and file that this user owns.
  const mine = (file, mode) => { const stat = exists(file); return stat && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === mode }
  if (state) {
    fs.mkdirSync(path.dirname(state), { recursive: true, mode: 0o700 })
    if (!mine(path.dirname(state), 0o700) || (exists(state) && !mine(state, 0o600))) throw Error(`unsafe guard state in ${path.dirname(state)}`)
  }
  const records = state && exists(state) ? fs.readFileSync(state, 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }) : []
  const save = record => fs.appendFileSync(state, JSON.stringify(record) + '\n', { mode: 0o600 })
  // macOS mktemp ignores TMPDIR without a template and uses the per-user temporary directory.
  const roots = () => [tmp, real('/tmp'), process.platform === 'darwin' && real(execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim())]
  const ownedDir = (dir, temp) => dir && temp.includes(path.dirname(dir)) && mine(dir, 0o700) && exists(dir).isDirectory()
  const mktemp = /\bmktemp\b/.test(command) && state && input.tool_use_id
  if (input.hook_event_name === 'PostToolUse') {
    // Record new mode-0700 directories in a temporary root that a mktemp command printed.
    const start = mktemp && records.find(record => record.start === input.tool_use_id)?.t
    if (!start) return null
    const temp = roots(), output = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response ?? '')
    const fresh = dir => dir !== path.dirname(state) && ownedDir(dir, temp) && fs.statSync(dir).birthtimeMs >= start
    const printed = [...new Set((output.match(/\/[^\s"'\\]+/g) ?? []).map(real))], found = printed.filter(fresh)
    // An older entry of a temporary root in the output means that the command listed the shared directory.
    if (printed.some(file => file && temp.includes(path.dirname(file)) && !(exists(file).birthtimeMs >= start))) return null
    // More new directories than mktemp calls means that another session also created one meanwhile.
    const created = [...new Set(found.map(dir => path.dirname(dir)))].flatMap(root => { try { return fs.readdirSync(root).map(name => path.join(root, name)) } catch { return [] } }).filter(fresh)
    if (created.length <= mktempDirs(command)) for (const dir of found) if (!records.some(r => r.own === dir)) save({ own: dir })
    return null
  }
  if (mktemp) save({ start: input.tool_use_id, t: Date.now() })
  if (!HINT.test(command)) return null
  const cwd = input.cwd || process.cwd()
  let repo = null
  try { repo = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {}
  const owned = records.flatMap(record => record.own ? [real(record.own)] : [])
  const temp = owned.length ? roots() : []
  return evaluate(command, { cwd, repo, owned: owned.filter(dir => ownedDir(dir, temp)) })
}

module.exports = { evaluate, hook }
if (require.main === module) {
  let raw = ''
  try { raw = fs.readFileSync(0, 'utf8') } catch {}
  let reason
  try { reason = hook(JSON.parse(raw)) } catch (error) { reason = HINT.test(raw) ? `the guard failed (${error.message})` : null }
  if (reason) { process.stderr.write(message(reason) + '\n'); process.exitCode = 2 }
}
