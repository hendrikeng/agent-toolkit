// Source-side policy builder. Activation requires the separately accepted installation bundle.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const POLICY_VERSION = 'development-roots-v1'

// Resolve missing destinations through their nearest existing parent. Never treat
// an inaccessible or dangling symlink as a missing ordinary directory.
function physicalPath(value) {
  assert.equal(process.platform === 'win32', false, 'This development-root contract requires POSIX paths')
  const absolute = path.isAbsolute(value) ? value : `${process.cwd()}/${value}`
  let current = '/'
  for (const part of absolute.split('/').filter(Boolean)) {
    if (part === '.') continue
    if (part === '..') { current = path.dirname(current); continue }
    current = path.join(current, part)
    try {
      fs.lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    // A dangling link is an error, not permission for a future destination.
    current = fs.realpathSync.native(current)
  }
  return current
}

function developmentRoots(home) {
  assert.ok(path.isAbsolute(home), 'Development home must be absolute')
  assert.equal(physicalPath(home), home, 'Development home and roots must be physical directories, without aliases or traversal')
  return ['Code', 'orca/workspaces'].map(local => {
    const root = path.join(home, local)
    assert.equal(physicalPath(root), root, 'Development roots must be physical directories, without symlink aliases')
    assert.ok(!/[\x00-\x1f\x7f*?\[\]{}]/.test(root), 'Development roots must not contain policy metacharacters')
    return root
  })
}

function within(target, roots) {
  const physical = physicalPath(target)
  return roots.some(root => physical === root || physical.startsWith(root + path.sep))
}

function assertDevelopmentPath(target, roots) {
  if (!within(target, roots)) {
    throw new Error(`[path policy; ${POLICY_VERSION}] Target is outside accepted development roots: ${physicalPath(target)}. Bounded host authorization is required; chat approval does not change this denial.`)
  }
  return physicalPath(target)
}

function buildDevelopmentPolicy(defaults, { home, scratchRoot, reportRoot, restrictions = {} }) {
  assert.ok(restrictions && typeof restrictions === 'object' && !Array.isArray(restrictions), 'Restrictions must be an object')
  const surfaces = ['bash', 'path', 'external_directory', 'read', 'write', 'edit']
  assert.ok(Object.keys(restrictions).every(key => surfaces.includes(key)), 'Unsupported human restriction surface; do not silently discard policy')
  const roots = developmentRoots(home)
  assertDevelopmentPath(scratchRoot, roots)
  const reports = physicalPath(reportRoot)
  assert.ok(!/[\x00-\x1f\x7f*?\[\]{}]/.test(reports), 'Report path must be literal')
  const policy = structuredClone(defaults)
  // Never convert a human ask into allow. Root approval authorizes development,
  // not every operation which the underlying package can silently approve.
  policy.yoloMode = false
  policy.permission.external_directory = { '*': 'deny' }
  for (const root of [...roots, reports]) {
    policy.permission.external_directory[root] = 'allow'
    policy.permission.external_directory[path.join(root, '*')] = 'allow'
  }
  for (const pattern of ['*.env', '*.env.*', '*.pem', '*.key']) policy.permission.path[pattern] = 'deny'
  for (const surface of surfaces) {
    const narrower = restrictions[surface]
    if (narrower === undefined) continue
    const entries = typeof narrower === 'string' ? { '*': narrower } : narrower
    assert.ok(entries && typeof entries === 'object' && !Array.isArray(entries), 'Invalid human restriction')
    for (const decision of Object.values(entries)) {
      assert.ok(['deny', 'ask'].includes(typeof decision === 'string' ? decision : decision?.action), 'Human restrictions can narrow, not expand, the root contract')
    }
    const base = policy.permission[surface]
    const baseEntries = typeof base === 'string' ? { '*': base } : base
    if (surface === 'external_directory') {
      for (const [pattern, decision] of Object.entries(entries)) {
        const action = typeof decision === 'string' ? decision : decision.action
        assert.ok(action === 'deny' || baseEntries[pattern] === 'allow', 'An external ask must narrow an exact existing root grant')
      }
    }
    const merged = { ...baseEntries }
    for (const [pattern, decision] of Object.entries(entries)) { delete merged[pattern]; merged[pattern] = decision }
    // Required operation/secret denials remain last-match-wins. External root
    // denies are a fallback, not a blanket denial to move after root grants.
    if (surface !== 'external_directory') {
      for (const [pattern, decision] of Object.entries(baseEntries || {})) {
        if ((typeof decision === 'string' ? decision : decision?.action) !== 'deny') continue
        delete merged[pattern]
        merged[pattern] = decision
      }
    }
    policy.permission[surface] = merged
  }
  return { version: POLICY_VERSION, roots, scratchRoot: physicalPath(scratchRoot), reportRoot: reports, policy }
}

module.exports = { POLICY_VERSION, physicalPath, developmentRoots, within, assertDevelopmentPath, buildDevelopmentPolicy }
