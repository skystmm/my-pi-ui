import assert from "node:assert/strict"
import { test } from "node:test"

test("WebSocket connection listeners observe reconnects so the UI can resync", async () => {
  class FakeSocket {
    static OPEN = 1
    static CONNECTING = 0
    static instances: FakeSocket[] = []
    readyState = FakeSocket.CONNECTING
    sent: string[] = []
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    constructor(_url: string) { FakeSocket.instances.push(this) }
    send(data: string) { this.sent.push(data) }
    close() { this.readyState = 3 }
    open() { this.readyState = FakeSocket.OPEN; this.onopen?.() }
    drop() { this.readyState = 3; this.onclose?.() }
  }
  const globals = globalThis as typeof globalThis & { WebSocket: typeof FakeSocket; location: { protocol: string; host: string }; window: typeof globalThis }
  const previousSocket = globals.WebSocket
  const previousLocation = globals.location
  const previousWindow = globals.window
  try {
    globals.WebSocket = FakeSocket
    globals.location = { protocol: "http:", host: "127.0.0.1:5173" }
    globals.window = globalThis
    const { WsClient } = await import("../../src/lib/ws-client.ts")
    const client = new WsClient("ws://127.0.0.1:5173/ws")
    const epochs: number[] = []
    let closes = 0
    const unsubscribe = client.subscribeConnection(() => epochs.push(client.getConnectionEpoch()))
    const unsubscribeClose = client.onClose(() => { closes++ })
    assert.equal(client.sendNow({ t: "prompt", requestId: "one", cwd: "/tmp", message: "hello" }), false)
    client.connect()
    FakeSocket.instances[0].open()
    assert.deepEqual(epochs, [1])
    FakeSocket.instances[0].drop()
    assert.equal(closes, 1)
    client.connect()
    FakeSocket.instances[1].open()
    assert.deepEqual(epochs, [1, 2])
    assert.deepEqual(FakeSocket.instances[1].sent.map(value => JSON.parse(value)), [{ t: "list_projects" }])
    unsubscribe()
    unsubscribeClose()
    client.disconnect()
  } finally {
    globals.WebSocket = previousSocket
    globals.location = previousLocation
    globals.window = previousWindow
  }
})
