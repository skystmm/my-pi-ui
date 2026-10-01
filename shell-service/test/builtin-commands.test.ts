import assert from "node:assert/strict"
import { test } from "node:test"
import { builtinCommands, availableBuiltinCommands, outgoingPrompt, parseBuiltinCommand } from "../../src/lib/builtin-commands.ts"

test("web command palette contains executable Pi builtins", () => {
  assert.deepEqual(builtinCommands.map(c => c.name), ["new", "model", "thinking", "compact", "clone", "fork", "tree"])
  assert.deepEqual(parseBuiltinCommand("/compact keep recent decisions"), { name: "compact", args: "keep recent decisions" })
  assert.deepEqual(parseBuiltinCommand("/model ollama/gemma4:e4b"), { name: "model", args: "ollama/gemma4:e4b" })
  assert.equal(parseBuiltinCommand("/llama"), null)
  assert.equal(parseBuiltinCommand("explain /new"), null)
})

test("plan mode leaves explicit slash commands untouched", () => {
  assert.equal(outgoingPrompt("/llama", "plan"), "/llama")
  assert.equal(outgoingPrompt("/skill:review this", "plan"), "/skill:review this")
  assert.equal(outgoingPrompt("inspect this", "plan"), "/plan inspect this")
})

test("command suggestions only include actions executable in the current context", () => {
  assert.deepEqual(availableBuiltinCommands({ project: false, session: false, leaf: false, forkable: false }), [])
  assert.deepEqual(availableBuiltinCommands({ project: true, session: false, leaf: false, forkable: false }).map(c => c.name), ["new", "model", "thinking"])
  assert.deepEqual(availableBuiltinCommands({ project: true, session: true, leaf: true, forkable: false }).map(c => c.name), ["new", "model", "thinking", "compact", "clone", "tree"])
})
