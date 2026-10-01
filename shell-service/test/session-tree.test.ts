import assert from "node:assert/strict"
import { test } from "node:test"
import { buildSessionTreeRows, lastForkableUserEntryId } from "../../src/lib/session-tree.ts"
import type { SessionEntry } from "../src/ws-protocol.js"

const entry = (id: string, parentId: string | null, role: "user" | "assistant"): SessionEntry => ({
  type: "message", id, parentId, timestamp: "2026-09-27T00:00:00Z",
  message: { role, content: [{ type: "text", text: id }], timestamp: Date.now() },
}) as SessionEntry

test("session tree includes sibling branches and identifies the active path", () => {
  const entries = [entry("root", null, "user"), entry("answer", "root", "assistant"),
    entry("next", "answer", "user"), entry("branch", "root", "assistant")]
  const rows = buildSessionTreeRows(entries, "next")
  assert.deepEqual(rows.map(row => [row.entry.id, row.depth, row.active, row.childCount]), [
    ["root", 0, true, 2], ["answer", 1, true, 1], ["next", 2, true, 0], ["branch", 1, false, 0],
  ])
  assert.equal(lastForkableUserEntryId(entries, "next"), "next")
  assert.equal(lastForkableUserEntryId(entries, "branch"), "root")
})
