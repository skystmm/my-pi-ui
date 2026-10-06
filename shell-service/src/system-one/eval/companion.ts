// Separate process for standalone Pi: credentials and reports stay in this host.
import { evalService } from './service.js'
import { evalBroker } from './broker.js'
const grant = await evalBroker.grant()
process.stdout.write(JSON.stringify({ url: grant.url, token: grant.token }) + '\n')
let closing = false
async function close() { if (closing) return; closing = true; grant.revoke(); await evalService.shutdown(); await evalBroker.close(); process.exit(0) }
process.stdin.resume()
process.stdin.on('end', close)
process.on('SIGTERM', close)
process.on('SIGINT', close)
