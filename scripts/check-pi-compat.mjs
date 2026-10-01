import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const bin = process.env.PI_UI_PI_BIN || "pi"
const entry = process.env.PI_UI_PI_ENTRY
const version = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 })
if (version.error || version.status !== 0) throw new Error("找不到可运行的 pi 命令")
const match = (version.stdout + version.stderr).match(/\b(\d+)\.(\d+)\.(\d+)\b/)
if (!match || match[1] !== "0" || !["84", "85"].includes(match[2])) {
  throw new Error(`当前 Pi 版本不在已验证范围 0.84–0.85.x：${(version.stdout + version.stderr).trim()}`)
}

const root = mkdtempSync(join(tmpdir(), "pi-ui-compat-"))
const commands = ["get_state", "get_commands", "get_tree"]
const child = spawn(entry ? process.execPath : bin, entry ? [entry] : ["--mode", "rpc"], {
  cwd: root,
  env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "agent", "sessions") },
  stdio: ["pipe", "pipe", "pipe"],
})

try {
  await new Promise((resolve, reject) => {
    const pending = new Set(commands)
    let buffer = ""
    let stderr = ""
    const timer = setTimeout(() => reject(new Error(`Pi RPC 未回应：${[...pending].join(", ")}`)), 20000)
    const done = error => { clearTimeout(timer); error ? reject(error) : resolve() }
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-1000) })
    child.on("error", done)
    child.on("exit", code => { if (pending.size) done(new Error(`Pi RPC 提前退出 (${code}): ${stderr}`)) })
    child.stdout.on("data", chunk => {
      buffer += chunk.toString()
      let end
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.type !== "response" || !pending.has(message.command)) continue
        if (!message.success) return done(new Error(`Pi RPC ${message.command} 失败: ${message.error ?? "unknown"}`))
        if (message.command === "get_commands" && !Array.isArray(message.data?.commands)) return done(new Error("Pi RPC get_commands 返回结构不兼容"))
        if (message.command === "get_tree" && !Array.isArray(message.data?.tree)) return done(new Error("Pi RPC get_tree 返回结构不兼容"))
        pending.delete(message.command)
        if (!pending.size) return done()
      }
    })
    for (const command of commands) child.stdin.write(JSON.stringify({ id: command, type: command }) + "\n")
  })
  console.log(`Pi ${match[0]} RPC 兼容检查通过（${commands.join(", ")}）`)
} finally {
  child.kill("SIGTERM")
  rmSync(root, { recursive: true, force: true })
}
