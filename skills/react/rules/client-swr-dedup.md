---
title: Use a Data Library for Automatic Deduplication
impact: MEDIUM-HIGH
impactDescription: automatic deduplication
tags: client, swr, tanstack-query, deduplication, data-fetching
---

## Use a Data Library for Automatic Deduplication

Use the client data library that the project already uses, for example SWR or TanStack Query. These libraries deduplicate requests and cache and revalidate data across component instances. Do not add a second data library. If the project has none, ask before you add one. The SWR examples below show the pattern. TanStack Query uses `useQuery({ queryKey, queryFn })` and `useMutation()` for the same purposes.

**Incorrect (no deduplication, each instance fetches):**

```tsx
function UserList() {
  const [users, setUsers] = useState([])
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(setUsers)
  }, [])
}
```

**Correct (multiple instances share one request):**

```tsx
import useSWR from 'swr'

function UserList() {
  const { data: users } = useSWR('/api/users', fetcher)
}
```

**For immutable data:**

```tsx
import { useImmutableSWR } from '@/lib/swr'

function StaticContent() {
  const { data } = useImmutableSWR('/api/config', fetcher)
}
```

**For mutations:**

```tsx
import { useSWRMutation } from 'swr/mutation'

function UpdateButton() {
  const { trigger } = useSWRMutation('/api/user', updateUser)
  return <button onClick={() => trigger()}>Update</button>
}
```

Reference: [https://swr.vercel.app](https://swr.vercel.app), [https://tanstack.com/query](https://tanstack.com/query)
