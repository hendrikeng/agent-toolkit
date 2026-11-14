---
title: Use useEffectEvent for Event Handlers in Effects
impact: LOW
impactDescription: stable subscriptions
tags: advanced, hooks, useEffectEvent, refs, event-handlers, optimization
---

## Use useEffectEvent for Event Handlers in Effects

If an effect uses a callback but must not re-subscribe when the callback changes, wrap the callback in `useEffectEvent`. React 19.2 includes `useEffectEvent`. On older React versions, store the callback in a ref.

**Incorrect (re-subscribes on every render):**

```tsx
function useWindowEvent(event: string, handler: (e) => void) {
  useEffect(() => {
    window.addEventListener(event, handler)
    return () => window.removeEventListener(event, handler)
  }, [event, handler])
}
```

**Correct (React 19.2 and later):**

```tsx
import { useEffectEvent } from 'react'

function useWindowEvent(event: string, handler: (e) => void) {
  const onEvent = useEffectEvent(handler)

  useEffect(() => {
    window.addEventListener(event, onEvent)
    return () => window.removeEventListener(event, onEvent)
  }, [event])
}
```

`useEffectEvent` returns a function that always calls the latest handler. Call it only from inside Effects or other Effect Events. Do not put it in the dependency array, and do not pass it to other components or hooks (see `advanced-effect-event-deps`).

**Fallback (React earlier than 19.2):**

```tsx
function useWindowEvent(event: string, handler: (e) => void) {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    const listener = (e) => handlerRef.current(e)
    window.addEventListener(event, listener)
    return () => window.removeEventListener(event, listener)
  }, [event])
}
```

Reference: [useEffectEvent](https://react.dev/reference/react/useEffectEvent)
