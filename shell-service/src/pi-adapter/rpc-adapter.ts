import { evalBroker } from "../system-one/eval/broker.js"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import { decisionBroker } from "../system-one/broker.js"
import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js"

const STDERR_KEEP = 8 * 1024

let cachedPiPath: string | null | undefined

/** Locate the pi binary via PATH (cached; null when not found). */
function whichPi(): string | null {
  if (cachedPiPath !== undefined) return cachedPiPath
  const probe = process.platform === "win32" ? "where" : "which"
  try {
    const out = execFileSync(probe, ["pi"], { encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] })
    cachedPiPath = out.split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? null
  } catch { cachedPiPath = null }
  return cachedPiPath
}

type RpcResponse = { id?: string|number, type: "response", command: string, success: boolean, data?: unknown, error?: string }
type RpcEvent = Record<string, unknown> & { type: string }

export type PiAdapterEvent =
  | { t: "agent_event"; event: RpcEvent }
  | { t: "rpc_error"; message: string }

export class PiAdapter {
  private evalGrant?: Awaited<ReturnType<typeof evalBroker.grant>>
  private decisionGrant?: Awaited<ReturnType<typeof decisionBroker.grant>>
  private starting: Promise<void> | null = null
  private generation = 0
  private proc: ChildProcess | null = null
  private stopReader: (()=>void) | null = null
  private pending = new Map<string|number, {resolve:(v:RpcResponse)=>void, reject:(e:Error)=>void}>()
  private seq = 1
  private listeners = new Set<(ev: PiAdapterEvent)=>void>()
  private cwd: string
  private stderr = ""

  constructor(cwd?: string) { this.cwd = cwd ?? process.cwd() }

  on(listener:(ev:PiAdapterEvent)=>void): ()=>void { this.listeners.add(listener); return ()=>this.listeners.delete(listener) }
  private emit(ev: PiAdapterEvent){ for(const l of this.listeners) l(ev) }

  private resolveCli(): {cmd:string, args:string[]} {
    // Never hardcode an install path: resolve the pi binary from the environment
    // the Shell Service was started in, so any npm prefix / bun / local install works.
    //   PI_UI_PI_BIN   explicit binary (used verbatim, rpc args appended)
    //   PI_UI_PI_ENTRY explicit path to dist/rpc-entry.js (run with node)
    //   otherwise      `pi` from PATH
    const envBin = process.env.PI_UI_PI_BIN?.trim()
    if (envBin) return { cmd: envBin, args: ["--mode", "rpc"] }

    const envEntry = process.env.PI_UI_PI_ENTRY?.trim()
    if (envEntry) return { cmd: process.execPath, args: [envEntry] }

    const onPath = whichPi()
    if (onPath) return { cmd: onPath, args: ["--mode", "rpc"] }

    throw new Error("找不到 pi：请把 pi 加入 PATH，或设置 PI_UI_PI_BIN / PI_UI_PI_ENTRY 指向 pi 可执行文件与 dist/rpc-entry.js")
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.startProcess()
    try { await this.starting } finally { this.starting = null }
  }

  private async startProcess(): Promise<void> {
    if (this.proc) return
    const generation = this.generation
    const {cmd, args} = this.resolveCli()
    const built = fileURLToPath(new URL("../system-one/pi-extension.js", import.meta.url))
    const source = fileURLToPath(new URL("../system-one/pi-extension.ts", import.meta.url))
    const extension = existsSync(built) ? built : source
    if (!existsSync(extension)) throw new Error("System One extension unavailable")
    this.decisionGrant = await decisionBroker.grant(this.cwd)
    if (generation !== this.generation) { this.decisionGrant.revoke(); this.decisionGrant = undefined; throw new Error("pi rpc start cancelled") }
    const evalBuilt = fileURLToPath(new URL("../system-one/eval/pi-extension.js", import.meta.url))
    const evalSource = fileURLToPath(new URL("../system-one/eval/pi-extension.ts", import.meta.url))
    const evalExtension = existsSync(evalBuilt) ? evalBuilt : evalSource
    if (!existsSync(evalExtension)) { this.decisionGrant.revoke(); throw new Error("System One evaluation extension unavailable") }
    try { this.evalGrant = await evalBroker.grant() } catch (error) { this.decisionGrant.revoke(); throw error }
    if (generation !== this.generation) { this.evalGrant.revoke(); this.decisionGrant?.revoke(); throw new Error("pi rpc start cancelled") }
    args.push("--extension", extension, "--extension", evalExtension)
    this.stderr = ""
    const proc = spawn(cmd, args, { cwd: this.cwd, stdio: ["pipe","pipe","pipe"], env: { ...process.env, PI_UI_DECISION_URL: this.decisionGrant.url, PI_UI_DECISION_TOKEN: this.decisionGrant.token, PI_UI_EVAL_URL: this.evalGrant.url, PI_UI_EVAL_TOKEN: this.evalGrant.token } })
    this.proc = proc
    proc.stderr?.on("data", d => {
      // keep only the tail: a chatty pi must not grow this without bound
      this.stderr = (this.stderr + d.toString()).slice(-STDERR_KEEP)
      process.stderr.write(d)
    })
    const grant = this.decisionGrant
    const evalGrant = this.evalGrant
    proc.on("error", () => { grant?.revoke(); evalGrant?.revoke() })
    proc.on("exit", (code, sig) => {
      grant?.revoke(); evalGrant?.revoke()
      if (this.proc !== proc) return // superseded by a restart
      const err = new Error(`pi rpc exited code=${code} sig=${sig} stderr=${this.stderr.slice(-800)}`)
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
      this.proc = null
      this.emit({ t: "rpc_error", message: err.message })
    })
    proc.on("error", (e) => {
      const err = new Error(`pi rpc spawn error: ${e.message}`)
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
      this.proc = null
    })
    this.stopReader = attachJsonlLineReader(proc.stdout!, line => {
      if (!line.trim()) return
      let obj: unknown
      try { obj = JSON.parse(line) } catch { return }
      const rec = obj as RpcEvent & { id?: string | number }
      if (rec.type === "response" && rec.id !== undefined) {
        const p = this.pending.get(rec.id)
        if (p) { this.pending.delete(rec.id); p.resolve(rec as RpcResponse) }
        return
      }
      this.emit({ t: "agent_event", event: rec as RpcEvent })
    })

    // Wait for the OS to confirm the spawn instead of guessing with a sleep, then
    // give a misconfigured binary a moment to die so the caller fails fast.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => { proc.off("error", onError); resolve() }
      const onError = (e: Error) => { proc.off("spawn", onSpawn); reject(new Error(`pi rpc spawn error: ${e.message}`)) }
      proc.once("spawn", onSpawn)
      proc.once("error", onError)
    })
    await new Promise(r => setTimeout(r, 120))
    if (proc.exitCode !== null) {
      throw new Error(`pi rpc failed to start exit=${proc.exitCode} stderr=${this.stderr.slice(-500)}`)
    }
  }

  stop() {
    this.generation++
    this.evalGrant?.revoke(); this.evalGrant = undefined
    this.decisionGrant?.revoke(); this.decisionGrant = undefined
    this.stopReader?.(); this.stopReader = null
    const proc = this.proc
    this.proc = null
    for (const [, p] of this.pending) p.reject(new Error("pi rpc stopped"))
    this.pending.clear()
    if (!proc) return
    proc.stdin?.end()
    const killTimer = setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 3000)
    proc.once("exit", () => clearTimeout(killTimer))
  }

  get alive(){ return !!this.proc && this.proc.exitCode===null }

  private sendRaw(cmd: Record<string,unknown>, timeoutMs = 25000): Promise<RpcResponse>{
    if(!this.proc?.stdin) return Promise.reject(new Error("pi rpc not started"))
    const id = `piui_${this.seq++}`
    const payload = { id, ...cmd }
    return new Promise<RpcResponse>((resolve,reject)=>{
      const timer = setTimeout(()=>{ if(this.pending.has(id)){ this.pending.delete(id); reject(new Error("rpc timeout")) } }, timeoutMs)
      this.pending.set(id, {
        resolve: (v)=>{ clearTimeout(timer); resolve(v) },
        reject: (e)=>{ clearTimeout(timer); reject(e) },
      })
      try { this.proc!.stdin!.write(serializeJsonLine(payload)) }
      catch(e){ clearTimeout(timer); this.pending.delete(id); reject(e as Error) }
    })
  }

  // High-level commands mirroring RpcClient
  async prompt(message:string, images?:unknown){ await this.ensure(); const r = await this.sendRaw({type:"prompt", message, images, streamingBehavior:"steer"}); if(!r.success) throw new Error(r.error ?? "prompt failed") }
  async steer(message:string, images?:unknown){ await this.ensure(); const r = await this.sendRaw({type:"steer", message, images}); if(!r.success) throw new Error(r.error ?? "steer failed") }
  async clearQueue(){ await this.ensure(); const r = await this.sendRaw({type:"clear_queue"}); if(!r.success) throw new Error(r.error ?? "clear_queue failed"); return r.data as { steering: string[]; followUp: string[] } }
  async abort(){ await this.ensure(); const r = await this.sendRaw({type:"abort"}, 600000); if(!r.success) throw new Error(r.error ?? "abort failed") }
  async setModel(provider:string, modelId:string){ await this.ensure(); const r = await this.sendRaw({type:"set_model", provider, modelId}); if(!r.success) throw new Error(r.error ?? "set_model failed") }
  async setThinkingLevel(level:string){ await this.ensure(); const r = await this.sendRaw({type:"set_thinking_level", level}); if(!r.success) throw new Error(r.error ?? "set_thinking_level failed") }
  async fork(entryId:string){ await this.ensure(); const r = await this.sendRaw({type:"fork", entryId}); if(!r.success) throw new Error(r.error ?? "fork failed"); return r.data }
  async clone(){ await this.ensure(); const r = await this.sendRaw({type:"clone"}); if(!r.success) throw new Error(r.error ?? "clone failed"); return r.data }
  async getState(){ await this.ensure(); const r = await this.sendRaw({type:"get_state"}); if(!r.success) throw new Error(r.error ?? "get_state failed"); return r.data }
  async getSessionStats(){ await this.ensure(); const r = await this.sendRaw({type:"get_session_stats"}); if(!r.success) throw new Error(r.error ?? "get_session_stats failed"); return r.data }
  async getAvailableModels(){ await this.ensure(); const r = await this.sendRaw({type:"get_available_models"}); if(!r.success) throw new Error(r.error ?? "get_available_models failed"); return r.data as { models?: unknown[] } }
  async getCommands(){ await this.ensure(); const r = await this.sendRaw({type:"get_commands"}); if(!r.success) throw new Error(r.error ?? "get_commands failed"); return r.data as { commands?: unknown[] } }
  async getEntries(since?: string){ await this.ensure(); const r = await this.sendRaw({type:"get_entries", since}); if(!r.success) throw new Error(r.error ?? "get_entries failed"); return r.data }
  async compact(customInstructions?:string){ await this.ensure(); const r = await this.sendRaw({type:"compact", customInstructions}, 600000); if(!r.success) throw new Error(r.error ?? "compact failed"); return r.data }
  async getTree(){ await this.ensure(); const r = await this.sendRaw({type:"get_tree"}); if(!r.success) throw new Error(r.error ?? "get_tree failed"); return r.data }
  async switchSession(sessionPath:string){ await this.ensure(); const r = await this.sendRaw({type:"switch_session", sessionPath}); if(!r.success) throw new Error(r.error ?? "switch_session failed"); return r.data }
  async newSession(parentSession?:string){ await this.ensure(); const r = await this.sendRaw({type:"new_session", parentSession}); if(!r.success) throw new Error(r.error ?? "new_session failed"); return r.data }

  async respondExtensionUI(requestId: string, payload: Record<string, unknown>){
    await this.ensure()
    if(!this.proc?.stdin) throw new Error("pi rpc not started")
    const line = serializeJsonLine({ type:"extension_ui_response", id: requestId, ...payload })
    this.proc.stdin.write(line)
  }

  private async ensure(){ if(!this.alive) await this.start() }
}
