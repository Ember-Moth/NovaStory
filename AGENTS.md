Default to Bun over Node.js.

- **CLI:** `bun <file>`, `bun test`, `bun build`, `bun install`, `bun run`, `bunx` — never use npm/yarn/pnpm/npx/webpack/esbuild/vitest/jest/ts-node. Bun auto-loads `.env`.
- **Type checking:** `bunx tsc --noEmit` — TypeScript type checking (Bun does not type-check at runtime).
- **Lint:** `bun run lint` — runs `biome check` for static analysis.
- **APIs:** `Bun.serve()` (no express), `bun:sqlite` (no better-sqlite3), `Bun.redis` (no ioredis), `Bun.sql` (no pg), built-in `WebSocket` (no ws), `Bun.file` (over node:fs), `Bun.$` (over execa).
- **Testing:** `bun test` with `import { test, expect } from "bun:test"`.
- **Frontend:** HTML imports with `Bun.serve()`. No vite. `.tsx`/`.jsx`/`.css` files are transpiled automatically when referenced from HTML. Use `bun --hot` to run.
- **UI Stack:** React + Tailwind CSS v4.
- **Class names:** Use `cn` from `src/shared/lib/cn.ts` for conditional or overridable Tailwind class composition. Do not inline `twMerge` in components unless there is a local one-off reason.
- **Icons:** `@iconify/tailwind4` with `@iconify-json/material-symbols`. Prefer `material-symbols` regular style (e.g. `icon-[material-symbols--close]`).
- **Bun Docs:** `node_modules/bun-types/docs/**.mdx`
