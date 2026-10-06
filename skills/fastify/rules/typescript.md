# TypeScript

- Match the repository's existing TypeScript runtime and module strategy; do not introduce a second build path for Fastify alone.
- When using Node's type stripping, use erasable syntax, explicit file extensions as required by the module setup, and `import type` for type-only symbols.
- Use route generics for small isolated schemas or an existing type provider for schema-derived request and reply types.
- With TypeBox, import `TypeBoxTypeProvider` as a type and call `app.withTypeProvider<TypeBoxTypeProvider>()` at the correct encapsulation scope.
- Extend Fastify request, reply, and instance decorators through module declaration merging, matching runtime registration exactly.
- Avoid casts that bypass schema-derived types and avoid elaborate generic wrappers around one route pattern.
- Run `tsc --noEmit` even when Node executes TypeScript directly; stripping types does not type-check.

Official references: [TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/), [Type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/).
