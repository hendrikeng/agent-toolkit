const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

test('installer exposes one complete no-argument mode', () => {
  const installer = readFileSync(join(__dirname, '../../install.sh'), 'utf8')
  assert.match(installer, /\[\[ \$# -eq 0 \]\]/)
  assert.doesNotMatch(installer, /git-guard-only|restrictions/)
})
