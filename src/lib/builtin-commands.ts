import type { SlashCommandEntry } from "./ws-protocol"

// Pi's RPC get_commands omits the commands handled by its terminal UI.
// Only expose commands that this web UI can execute through its own controls/RPC.
export const builtinCommands: SlashCommandEntry[] = [
  { name: "new", source: "builtin", description: "新建会话" },
  { name: "model", source: "builtin", description: "选择模型，或输入 provider/model" },
  { name: "thinking", source: "builtin", description: "设置思考级别：off / low / medium / high 等" },
  { name: "compact", source: "builtin", description: "压缩当前会话；可附加自定义指令" },
  { name: "clone", source: "builtin", description: "克隆当前会话" },
  { name: "fork", source: "builtin", description: "从当前时间线末端创建分支" },
  { name: "tree", source: "builtin", description: "打开时间线树面板" },
]

export function parseBuiltinCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match || !builtinCommands.some(c => c.name === match[1])) return null
  return { name: match[1], args: (match[2] ?? "").trim() }
}

export function outgoingPrompt(text: string, mode: "plan" | "build"): string {
  const message = text.trim()
  return mode === "plan" && message && !message.startsWith("/") ? `/plan ${message}` : message
}
