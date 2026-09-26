import { StringDecoder } from "node:string_decoder"
export function serializeJsonLine(value: unknown): string { return `${JSON.stringify(value)}\n` }
export function attachJsonlLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): () => void {
  const decoder = new StringDecoder("utf8")
  let buffer = ""
  const emit = (line: string) => onLine(line.endsWith("\r") ? line.slice(0, -1) : line)
  const onData = (chunk: unknown) => {
    buffer += typeof chunk === "string" ? chunk as string : decoder.write(chunk as Buffer)
    while (true) { const idx = buffer.indexOf("\n"); if (idx === -1) return; emit(buffer.slice(0, idx)); buffer = buffer.slice(idx + 1) }
  }
  const onEnd = () => { buffer += decoder.end(); if (buffer.length > 0) { emit(buffer); buffer = "" } }
  stream.on("data", onData)
  stream.on("end", onEnd)
  return () => { (stream as NodeJS.EventEmitter).off("data", onData); (stream as NodeJS.EventEmitter).off("end", onEnd) }
}
