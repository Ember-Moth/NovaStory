import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: "./src/app/client/main.tsx" },
    alias: { "@": "./src" },
  },
  output: {
    distPath: { root: "dist/renderer" },
    target: "web",
  },
  html: {
    template: "./src/app/client/index.html",
  },
  tools: {
    postcss: {
      postcssOptions: {
        plugins: [require("@tailwindcss/postcss")],
      },
    },
    rspack: {
      externals: {
        "node:fs": "{}",
        "node:path": "{}",
        "node:url": "{}",
        "node:os": "{}",
        "node:crypto": "{}",
        "node:stream": "{}",
        "node:buffer": "{}",
        "node:events": "{}",
        "node:util": "{}",
        "nano-git": "{}",
        "nano-git/worktree/sqlite": "{}",
        "nano-git/worktree/core": "{}",
        "better-sqlite3": "{}",
      },
    },
  },
  server: {
    port: 3001,
  },
});
