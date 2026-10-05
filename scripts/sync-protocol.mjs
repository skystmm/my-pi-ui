#!/usr/bin/env node
// Mirrors the wire protocol + session entry schema from the Shell Service (the
// source of truth, compiled with NodeNext) into the frontend, which uses Vite's
// bundler resolution and therefore needs the same relative imports WITHOUT the
// `.js` extension.
//
//   node scripts/sync-protocol.mjs           # write the mirrors
//   node scripts/sync-protocol.mjs --check   # fail if they drifted (used by prebuild)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const PAIRS = [
  ["shell-service/src/system-one/types.ts", "src/lib/system-one/types.ts"],
  ["shell-service/src/session-entry-schema.ts", "src/lib/session-entry-schema.ts"],
  ["shell-service/src/provider-map.ts", "src/lib/provider-map.ts"],
  ["shell-service/src/ws-protocol.ts", "src/lib/ws-protocol.ts"],
]

const BANNER = `// GENERATED — do not edit. Source: shell-service/{file}
// Regenerate with: npm run sync:protocol
`

function render(sourceRel) {
  const src = readFileSync(join(root, sourceRel), "utf-8")
  const body = src.replace(/(from\s+")(\.\/[^"]+)\.js(")/g, "$1$2$3")
  return BANNER.replace("{file}", sourceRel.replace(/^shell-service\/src\//, "")) + body
}

const check = process.argv.includes("--check")
let drift = 0

for (const [source, target] of PAIRS) {
  const want = render(source)
  const abs = join(root, target)
  const have = existsSync(abs) ? readFileSync(abs, "utf-8") : null
  if (have === want) { console.log(`${check ? "ok    " : "same  "} ${target}`); continue }
  if (check) {
    drift++
    console.error(`DRIFT ${target} differs from ${source}`)
    continue
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, want)
  console.log(`wrote ${target}`)
}

if (check && drift) {
  console.error(`\n${drift} generated file(s) out of date — run: npm run sync:protocol`)
  process.exit(1)
}
console.log(check ? "protocol mirrors in sync" : "protocol mirrors written")
void relative
