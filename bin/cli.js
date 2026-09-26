#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = join(__dirname, "../package.json")
let pkgVersion = "0.1.0"
try { pkgVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? pkgVersion } catch {}

const PORT = Number(process.env.PI_UI_PORT ?? 5174)
const HOST = process.env.PI_UI_HOST ?? "127.0.0.1"

function piVersion() {
  try {
    const r = spawnSync("pi", ["--version"], { encoding: "utf-8", timeout: 3000 })
    const v = (r.stdout || r.stderr || "").trim().split(/\s+/).pop()?.replace(/^v/, "") ?? ""
    return v.match(/^\d+\.\d+\.\d+/) ? v : ""
  } catch { return "" }
}

function healthUrl() { return `http://${HOST}:${PORT}/health` }

async function checkHealth() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(healthUrl(), { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch { return false }
}

function spawnShell() {
  const serverJs = join(__dirname, "../shell-service/dist/server.js")
  if (!existsSync(serverJs)) {
    console.error("[pi-ui] shell-service not built — run: npm run build --prefix shell-service")
    process.exit(1)
  }
  const child = spawn(process.execPath, [serverJs], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PI_UI_PORT: String(PORT) },
  })
  child.unref()
  return child
}

const args = process.argv.slice(2)

if (args.includes("--version") || args.includes("-v")) {
  const pv = piVersion()
  console.log(`pi-ui ${pkgVersion}`)
  if (pv) console.log(`pi ${pv}`)
  // strict pin 0.84–0.85
  if (pv && !pv.startsWith("0.84.") && !pv.startsWith("0.85.")) {
    console.warn(`[pi-ui] WARN: pi ${pv} not in 0.84–0.85.x compat matrix — please npm i -g @earendil-works/pi-coding-agent@0.85`)
  }
  process.exit(0)
}

if (args.includes("--health")) {
  const ok = await checkHealth()
  console.log(ok ? "ok" : "not running")
  process.exit(ok ? 0 : 1)
}

if (args[0] === "serve") {
  // explicit serve: just ensure health or spawn
  let idxPort = args.indexOf("--port")
  let idxHost = args.indexOf("--host")
  const port = idxPort !== -1 ? Number(args[idxPort + 1]) : PORT
  // spawn with explicit env
  const serverJs = join(__dirname, "../shell-service/dist/server.js")
  const child = spawn(process.execPath, [serverJs], {
    stdio: "inherit",
    env: { ...process.env, PI_UI_PORT: String(port), PI_UI_HOST: args[idxHost + 1] ?? HOST },
  })
  child.on("close", code => process.exit(code ?? 0))
} else {
  // default: auto sidecar + hint
  const pv = piVersion()
  if (pv && !pv.startsWith("0.84.") && !pv.startsWith("0.85.")) {
    console.warn(`[pi-ui] pi ${pv} outside 0.84–0.85.x — may be incompatible`)
  }
  const ok = await checkHealth()
  if (!ok) {
    console.log(`[pi-ui] starting shell-service on ${HOST}:${PORT}...`)
    spawnShell()
    // wait briefly
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300))
      if (await checkHealth()) break
    }
  }
  const healthy = await checkHealth()
  if (healthy) {
    console.log(`[pi-ui] shell-service ready at http://${HOST}:${PORT} (ws /ws)`)
    console.log(`[pi-ui] open http://localhost:5173 (vite dev) or serve dist/`)
    if (pv) console.log(`[pi-ui] pi ${pv} ↔ pi-ui ${pkgVersion} handshake ok`)
  } else {
    console.error(`[pi-ui] failed to start shell-service on ${HOST}:${PORT}`)
    process.exit(1)
  }
}
