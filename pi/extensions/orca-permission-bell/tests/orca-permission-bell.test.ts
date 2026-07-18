import assert from 'node:assert/strict'
import test from 'node:test'
import extension from '../index.ts'

test('rings Orca terminal bell only for active permission prompts', () => {
  const eventHandlers = new Map<string, () => void>()
  const lifecycleHandlers = new Map<string, () => void>()
  const originalPaneKey = process.env.ORCA_PANE_KEY
  const originalWrite = process.stdout.write
  let output = ''

  try {
    process.env.ORCA_PANE_KEY = 'test-pane'
    process.stdout.write = ((chunk) => {
      output += String(chunk)
      return true
    }) as typeof process.stdout.write

    extension({
      events: {
        on(name, handler) {
          eventHandlers.set(name, handler)
          return () => eventHandlers.delete(name)
        },
      },
      on(name, handler) {
        lifecycleHandlers.set(name, handler)
      },
    })

    eventHandlers.get('permissions:ui_prompt')?.()
    assert.equal(output, '\u0007')
    lifecycleHandlers.get('session_shutdown')?.()
    assert.equal(eventHandlers.has('permissions:ui_prompt'), false)
  } finally {
    process.stdout.write = originalWrite
    if (originalPaneKey === undefined) delete process.env.ORCA_PANE_KEY
    else process.env.ORCA_PANE_KEY = originalPaneKey
  }
})
