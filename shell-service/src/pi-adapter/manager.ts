import { PiAdapter } from "./rpc-adapter.js"

/**
 * LiveSessionManager — one PiAdapter per cwd (project), lazy-started.
 * Mirrors pi LiveSessionManager multiplexing but over JSONL pi --mode rpc.
 * Each adapter corresponds to a pi AgentSession bound to that cwd; WS routes
 * prompt/steer/abort/set_model/set_thinking/fork/navigate_tree/clone/compact via it.
 */
export class LiveSessionManager {
  private adapters = new Map<string, PiAdapter>()
  private listeners = new Set<(ev: {cwd:string, t:string, payload:unknown})=>void>()

  on(listener:(ev:{cwd:string,t:string,payload:unknown})=>void): ()=>void { this.listeners.add(listener); return ()=>this.listeners.delete(listener) }
  private emit(cwd:string, t:string, payload:unknown){ for(const l of this.listeners) l({cwd,t,payload}) }

  private keyFor(cwd:string): string { return cwd }

  getAdapter(cwd:string): PiAdapter {
    const k = this.keyFor(cwd)
    let a = this.adapters.get(k)
    if(!a){
      a = new PiAdapter(cwd)
      a.on(ev=>{
        if(ev.t==="agent_event") this.emit(cwd, "agent_event", ev.event)
        else this.emit(cwd, "rpc_error", {message: ev.message})
      })
      this.adapters.set(k,a)
    }
    return a
  }

  // Non-creating lookup: returns the adapter only if one already exists for cwd.
  peek(cwd:string): PiAdapter | undefined {
    return this.adapters.get(this.keyFor(cwd))
  }

  async ensure(cwd:string): Promise<PiAdapter>{ const a=this.getAdapter(cwd); await a.start(); return a }

  dispose(cwd:string){
    const a=this.adapters.get(this.keyFor(cwd))
    if(a){ a.stop(); this.adapters.delete(this.keyFor(cwd)) }
  }
  disposeAll(){ for(const [,a] of this.adapters) a.stop(); this.adapters.clear() }
}

export const liveSessions = new LiveSessionManager()
