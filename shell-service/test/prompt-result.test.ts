import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prompt } from "../src/commands/agent.js"
import { liveSessions } from "../src/pi-adapter/index.js"
import type { Ctx } from "../src/commands/context.js"
import type { ShellEvent } from "../src/ws-protocol.js"

test("prompt rejection reports its request id so the draft can be retried", async () => {
  const events: ShellEvent[] = []
  const ctx = {
    cwdOrError: async () => null,
    send: (event: ShellEvent) => events.push(event),
  } as unknown as Ctx
  await prompt(ctx, { t: "prompt", requestId: "request-1", cwd: "/missing", message: "hello" })
  assert.deepEqual(events, [{ t: "prompt_result", requestId: "request-1", accepted: false, message: "项目目录不可用" }])
})

test("prompt result reports Pi RPC acceptance and rejection by request id", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-ui-prompt-"))
  const entry = join(cwd, "fake-rpc.mjs")
  writeFileSync(entry, `import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
  const cmd = JSON.parse(line);
  process.stdout.write(JSON.stringify({ type: "response", id: cmd.id, command: cmd.type, success: cmd.message !== "reject", error: "rejected by pi" }) + "\\n");
}`)
  const previous = process.env.PI_UI_PI_ENTRY
  const events: ShellEvent[] = []
  const ctx = {
    ws: {},
    wss: {},
    cwdOrError: async () => cwd,
    send: (event: ShellEvent) => events.push(event),
  } as unknown as Ctx
  try {
    process.env.PI_UI_PI_ENTRY = entry
    await prompt(ctx, { t: "prompt", requestId: "ok", cwd, message: "hello" })
    await prompt(ctx, { t: "prompt", requestId: "no", cwd, message: "reject" })
    assert.deepEqual(events, [
      { t: "prompt_result", requestId: "ok", accepted: true },
      { t: "prompt_result", requestId: "no", accepted: false, message: "rejected by pi" },
    ])
  } finally {
    liveSessions.dispose(cwd)
    if (previous === undefined) delete process.env.PI_UI_PI_ENTRY
    else process.env.PI_UI_PI_ENTRY = previous
    rmSync(cwd, { recursive: true, force: true })
  }
})
