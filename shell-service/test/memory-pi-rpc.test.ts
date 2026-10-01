import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { openSqliteMemoryRepository } from "../src/memory/sqlite.js"

const pi = process.env.PI_UI_PI_BIN || "pi"
const available = spawnSync(pi, ["--version"], { encoding: "utf8", timeout: 3000 }).status === 0

test("real Pi RPC loads memory extension and saves a reviewed memory", { skip: !available }, async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-memory-rpc-"))
  const projectPath = join(root, "project")
  mkdirSync(projectPath)
  const extension = fileURLToPath(new URL("../src/memory/pi-extension.ts", import.meta.url))
  const proc = spawn(pi, ["--mode", "rpc", "--no-skills", "--no-prompt-templates", "--extension", extension], {
    cwd: projectPath, env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"],
  })
  let buffer = ""
  let stderr = ""
  proc.stderr.on("data", chunk => { stderr += String(chunk) })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Pi RPC memory command timed out: ${stderr.slice(-500)}`)), 12000)
      proc.on("error", reject)
      proc.on("exit", code => reject(new Error(`Pi RPC exited ${code}: ${stderr.slice(-500)}`)))
      proc.stdout.on("data", chunk => {
        buffer += String(chunk)
        let end: number
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          let event: Record<string, unknown>
          try { event = JSON.parse(line) } catch { continue }
          if (event.type === "extension_ui_request" && event.method === "editor") {
            proc.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: "回答先给结论" })}\n`)
          }
          if (event.type === "extension_ui_request" && event.method === "notify" && String(event.message).startsWith("已保存")) {
            clearTimeout(timeout)
            resolve()
          }
        }
      })
      proc.stdin.write(`${JSON.stringify({ id: "save", type: "prompt", message: "/memory save project 回答简洁" })}\n`)
    })
    const repo = openSqliteMemoryRepository(join(root, "pi-ui", "memory.sqlite"))
    try {
      const memories = await repo.list({ kind: "project", projectPath: realpathSync(projectPath) })
      assert.equal(memories.length, 1)
      assert.equal(memories[0].content, "回答先给结论")
    } finally { await repo.close() }
  } finally {
    proc.kill("SIGTERM")
    rmSync(root, { recursive: true, force: true })
  }
})
