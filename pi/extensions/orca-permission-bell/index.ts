export default function (pi) {
  if (!process.env.ORCA_PANE_KEY) return

  const dispose = pi.events.on('permissions:ui_prompt', () => {
    // Orca turns a terminal BEL into its native attention notification.
    try { process.stdout.write('\u0007') } catch {}
  })

  pi.on('session_shutdown', () => dispose?.())
}
