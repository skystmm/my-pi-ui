import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
type Runner = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>

/** Returns an absolute path from the macOS folder dialog, or null on Cancel. */
export async function chooseProjectDirectory(run: Runner = execFileAsync): Promise<string | null> {
  if (process.platform !== "darwin") throw new Error("当前系统暂不支持原生目录选择")
  try {
    const { stdout } = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "选择项目目录")'], {
      timeout: 120_000,
      maxBuffer: 16 * 1024,
    })
    const path = stdout.replace(/\r?\n$/, "").replace(/\/$/, "") || "/"
    if (!path.startsWith("/")) throw new Error("目录选择器未返回绝对路径")
    return path
  } catch (error) {
    if (/(?:-128|User cancel(?:led|ed))/i.test((error as Error).message)) return null
    throw error
  }
}
