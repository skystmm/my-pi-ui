import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'pi-ui-104-'));
mkdirSync(root + '/agent');
mkdirSync(root + '/project');
process.env.PI_CODING_AGENT_DIR = root + '/agent';
process.env.PI_OFFLINE = '1';
const version = execFileSync(process.env.PI_UI_PI_BIN ?? 'pi', ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, '1.0.4');
writeFileSync(root + '/extension.ts', `export default function(pi){pi.registerCommand('compat-ui',{description:'fixture',handler:async(args,ctx)=>{const v=await ctx.ui.input('compat input','value');ctx.ui.notify('compat-answer:'+v)}});pi.registerCommand('compat-omit',{description:'fixture',handler:async(args,ctx)=>{const e=ctx.sessionManager.getEntries().find(e=>e.type==='message'&&e.message.role==='user');if(e)ctx.sessionManager.appendContextEdit(e.id,null);ctx.ui.notify('context-edited')}})}`);
const out = { pi: '1.0.4', checks: [], requests: [], events: [] };
let slow = false;
const server = createServer(async (req, res) => { let body = ''; for await (const d of req)
    body += d; const p = JSON.parse(body); if (req.url.includes('systemone')) {
    const answers = Object.fromEntries(Object.entries(p.questions).map(([id, q]) => { if (q.type === 'noul')
        return [id, { type: 'noul', noul: .9 }]; const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i)); const probabilities = Object.fromEntries(keys.map(k => [k, 1 / keys.length])); return [id, q.type === 'choice' ? { type: 'choice', choice: keys[0], probabilities, confidence: .5 } : { type: 'score', score: (keys.length - 1) / 2, probabilities, confidence: .5 }]; }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: p.model ?? 'fixture', answers, usage: { input_tokens: 12, output_tokens: 3 } }));
    return;
} out.requests.push({ roles: p.messages.map(m => m.role), texts: p.messages.filter(m => m.role === 'user').map(m => m.content) }); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); const chunk = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-chat', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'); if (JSON.stringify(p.messages.at(-1)).includes('CALL_SYSTEM_ONE')) {
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'compat-call', type: 'function', function: { name: 'system_one_evaluate', arguments: JSON.stringify({ state: 'Please review this existing change', questions: { task: { type: 'choice', instructions: 'Which task?', criteria: { review: 'Review existing code', build: 'Create new code' } } } }) } }] });
    chunk({}, 'tool_calls');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
} chunk({ role: 'assistant', content: 'fixture reply \u2028 \u2029' }); if (slow)
    await new Promise(r => setTimeout(r, 1500)); chunk({}, 'stop'); res.write('data: [DONE]\n\n'); res.end(); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
writeFileSync(root + '/agent/models.json', JSON.stringify({ providers: { typesafe: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'fixture' }, fixture: { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture-chat', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }] } } }));
writeFileSync(root + '/agent/settings.json', JSON.stringify({ extensions: [root + '/extension.ts'], defaultProvider: 'fixture', defaultModel: 'fixture-chat', defaultThinkingLevel: 'off', compaction: { enabled: false, keepRecentTokens: 128 }, retry: { enabled: false } }));
const base = fileURLToPath(new URL('../shell-service/dist', import.meta.url));
const { decisionStore } = await import(base + '/system-one/store.js');
const { evaluateDecision } = await import(base + '/system-one/client.js');
const { evalService } = await import(base + '/system-one/eval/service.js');
const providers = [{ id: 'native-fixture', name: 'Pi native fixture', protocol: 'pi-native', endpoint: 'pi://typesafe', piProviderId: 'typesafe', auth: { mode: 'pi' }, timeoutMs: 10000 }];
const models = [{ id: 'native', providerId: 'native-fixture', name: 'Pi native fixture', remoteModel: 'jev-latest', questionTypes: ['choice', 'score', 'noul'], confidenceSemantics: 'vendor-defined' }];
if (process.env.PI_UI_LAYA_URL) {
    providers.push({ id: 'laya', name: 'Local Laya', protocol: 'systemone-http', endpoint: process.env.PI_UI_LAYA_URL, auth: { mode: 'none' }, timeoutMs: 15000 });
    for (const remoteModel of ['english', 'multilingual'])
        models.push({ id: 'laya-' + remoteModel, providerId: 'laya', name: 'Laya ' + remoteModel, remoteModel, questionTypes: ['choice', 'score', 'noul'], confidenceSemantics: 'normalized-entropy' });
}
await decisionStore.save({ revision: 0, enabled: true, providers, models, defaultModelId: 'native' });
const { liveSessions } = await import(base + '/pi-adapter/index.js');
const a = liveSessions.getAdapter(root + '/project');
const events = [];
a.on(e => { if (e.t === 'agent_event') {
    events.push(e.event);
    out.events.push(e.event.type);
} });
const check = async (name, fn) => { try {
    const detail = await fn();
    out.checks.push({ name, status: 'pass', detail });
}
catch (e) {
    out.checks.push({ name, status: 'fail', error: e.message });
    process.exitCode = 1;
} };
const wait = async (pred) => { const start = Date.now(); while (!pred()) {
    if (Date.now() - start > 12000)
        throw Error('wait timeout');
    await new Promise(r => setTimeout(r, 20));
} };
const prompt = async (text) => { const i = events.length; await a.prompt(text); await wait(() => events.slice(i).some(e => e.type === 'agent_settled')); return events.slice(i); };
try {
    await check('models/state/commands', async () => { const m = await a.getAvailableModels(); assert.ok(m.models.some(m => m.provider === 'fixture')); const st = await a.getState(); assert.equal(st.model.id, 'fixture-chat'); assert.ok((await a.getCommands()).commands.some(c => c.name === 's1-eval')); return { modelShape: typeof st.model }; });
    await check('new_session + set_model + set_thinking', async () => { await a.newSession(); await a.setModel('fixture', 'fixture-chat'); await a.setThinkingLevel('off'); assert.equal((await a.getState()).thinkingLevel, 'off'); });
    await check('stream + LF framing + entries + stats + tree', async () => { const ev = await prompt('COMPAT_FIRST'); assert.ok(ev.some(e => e.type === 'message_update')); const entries = await a.getEntries(); out.entriesShape = Object.keys(entries); const es = entries.entries ?? entries; assert.ok(es.some(e => e.type === 'message' && e.message.role === 'assistant')); const st = await a.getSessionStats(); out.statsShape = Object.keys(st); await a.getTree(); return { entries: es.length, events: [...new Set(ev.map(e => e.type))] }; });
    await check('extension dialog round-trip', async () => { const i = events.length; const p = a.prompt('/compat-ui'); await wait(() => events.slice(i).some(e => e.type === 'extension_ui_request' && e.method === 'input')); const e = events.slice(i).find(e => e.type === 'extension_ui_request' && e.method === 'input'); await a.respondExtensionUI(e.id, { value: 'confirmed' }); await p; await wait(() => events.slice(i).some(e => e.message === 'compat-answer:confirmed')); assert.ok(!events.slice(i).some(e => e.type === 'agent_start')); });
    await check('hosted s1-eval validate without LLM', async () => { const i = events.length, n = out.requests.length; await a.prompt('/s1-eval validate --suite smoke-v1'); assert.ok(events.slice(i).some(e => String(e.message).includes('smoke-v1'))); assert.equal(out.requests.length, n); });
    const original = await a.getState();
    await check('clone + switch_session', async () => { const r = await a.clone(); out.clone = r; assert.notEqual((await a.getState()).sessionId, original.sessionId); await a.switchSession(original.sessionFile); assert.equal((await a.getState()).sessionId, original.sessionId); });
    await check('fork + switch_session', async () => { const es = (await a.getEntries()).entries; const e = es.find(e => e.type === 'message' && e.message.role === 'user'); out.fork = await a.fork(e.id); await a.switchSession(original.sessionFile); });
    await check('manual compaction', async () => { for (let i = 0; i < 4; i++)
        await prompt('COMPACT_' + i + ' ' + ('synthetic context '.repeat(150))); out.compact = await a.compact('Summarize briefly'); assert.ok(out.compact.summary); });
    await check('context_edit preserved and applied by Pi', async () => { await prompt('OMIT_THIS'); await a.prompt('/compat-omit'); const es = (await a.getEntries()).entries; assert.ok(es.some(e => e.type === 'context_edit')); await prompt('AFTER_OMIT'); out.contextEdit = es.findLast(e => e.type === 'context_edit'); const target = es.find(e => e.id === out.contextEdit.targetId); assert.ok(!JSON.stringify(out.requests.at(-1).texts).includes(target.message.content)); return { entry: out.contextEdit }; });
    await check('stop after queued steer', async () => { slow = true; const i = events.length, n = out.requests.length; await a.prompt('SLOW_PROMPT'); await wait(() => out.requests.length > n); await a.steer('QUEUED_AFTER_STOP'); await a.abort(); await new Promise(r => setTimeout(r, 2200)); out.stop = { requestsAfterAbort: out.requests.length - n, agentStarts: events.slice(i).filter(e => e.type === 'agent_start').length, queuedReachedModel: out.requests.slice(n + 1).some(r => JSON.stringify(r.texts).includes('QUEUED_AFTER_STOP')) }; assert.equal(out.stop.queuedReachedModel, false, 'queued steer still sent to model after stop'); });
    await check('UI create_session model metadata', async () => { const { createSession } = await import(base + '/commands/session.js'); const sent = []; const ctx = { ws: {}, wss: { clients: new Set() }, send: e => sent.push(e), broadcast: e => sent.push(e), fail: (c, m) => { throw Error(c + ':' + m); }, cwdOrError: async () => root + '/project' }; await createSession(ctx, { t: 'create_session', cwd: root + '/project' }); const s = sent.find(e => e.t === 'session_snapshot'); out.createdSnapshot = s; assert.equal(s.model, 'fixture/fixture-chat', 'new session snapshot loses model object'); });
    await check('UI clone selects the cloned session for the next prompt', async () => { const { clone, prompt: sendPrompt } = await import(base + '/commands/agent.js'); const sent = []; const ctx = { ws: {}, wss: { clients: new Set() }, send: e => sent.push(e), broadcast: e => sent.push(e), fail: (c, m) => { throw Error(c + ':' + m); }, cwdOrError: async () => root + '/project' }; await prompt('SAVED_BEFORE_UI_CLONE'); await clone(ctx, { t: 'clone', cwd: root + '/project' }); const snap = sent.find(e => e.t === 'session_snapshot'); assert.ok(snap.entries.length); const sid = snap.sessionId, i = events.length; await sendPrompt(ctx, { t: 'prompt', cwd: root + '/project', message: 'CLONED_CONTINUATION' }); await wait(() => events.slice(i).some(e => e.type === 'agent_settled')); assert.equal((await a.getState()).sessionId, sid); });
    await check('interactive abort restores queued text', async () => { const { abort } = await import(base + '/commands/agent.js'); const sent = []; const ctx = { ws: {}, wss: { clients: new Set() }, send: e => sent.push(e), broadcast: e => sent.push(e), fail: (c, m) => { throw Error(c + ':' + m); }, cwdOrError: async () => root + '/project' }; const n = out.requests.length; slow = true; await a.prompt('STOP_AND_RESTORE'); await wait(() => out.requests.length > n); await a.prompt('UNSENT_QUEUE'); await abort(ctx, { t: 'abort', cwd: root + '/project' }); assert.ok(sent.find(e => e.t === 'queue_restored').steering.includes('UNSENT_QUEUE')); slow = false; });
    await check('Pi native classifier transport, schema and usage', async () => { const r = await evaluateDecision(decisionStore.resolveModel('native'), { state: 'synthetic', questions: { flag: { type: 'noul', instructions: 'Is this synthetic?' } } }); assert.equal(r.answers.flag.noul, .9); assert.equal(r.usage.totalTokens, 15); });
    await check('Agent System One tool calls selected native and optional real Laya providers', async () => { for (const id of ['native', ...(process.env.PI_UI_LAYA_URL ? ['laya-english', 'laya-multilingual'] : [])]) {
        decisionStore.select(root + '/project', id);
        const ev = await prompt('CALL_SYSTEM_ONE');
        const result = ev.find(e => e.type === 'message_end' && e.message?.role === 'toolResult');
        assert.ok(result);
        assert.equal(result.message.isError, false);
        assert.equal(result.message.details.modelConfigId, id);
        if (id === 'native') {
            assert.equal(result.message.usage.totalTokens, 15);
        }
        else
            assert.ok(result.message.details.actualModel);
    } });
    await check('Pi hosted evaluation runs all configured decision providers without chat calls', async () => { const n = out.requests.length; await a.prompt('/s1-eval run --models ' + models.map(m => m.id).join(',')); await wait(() => evalService.list().length > 0); const run = evalService.list()[0]; const report = await evalService.settled(run.id); assert.equal(report.run.status, 'completed'); assert.equal(report.run.errors, 0); assert.equal(report.run.completed, 6 * models.length); assert.equal(out.requests.length, n); out.evaluation = { completed: report.run.completed, errors: report.run.errors, modelIds: models.map(m => m.id) }; });
    await check('Pi and UI accept the same Azure configuration', async () => { const { validateModelsConfig } = await import(base + '/models-config.js'); const { ModelRuntime } = await import('@earendil-works/pi-coding-agent'); const cfg = { providers: { azure: { baseUrl: 'https://example.invalid/openai/v1', api: 'azure-openai-responses', apiKey: 'fixture', models: [{ id: 'gpt-4.1', name: 'Custom label' }] } } }; writeFileSync(root + '/azure.json', JSON.stringify(cfg)); const m = await ModelRuntime.create({ modelsPath: root + '/azure.json', authPath: root + '/agent/auth.json', modelsStorePath: root + '/agent/catalog.json', allowModelNetwork: false, refreshOnCreate: false }); assert.equal(m.getError(), undefined); assert.equal(validateModelsConfig(cfg), null); });
}
finally {
    liveSessions.disposeAll();
    await new Promise(r => server.close(r));
    if (process.env.PI_UI_COMPAT_REPORT)
        writeFileSync(process.env.PI_UI_COMPAT_REPORT, JSON.stringify({ pi: version, checks: out.checks, stop: out.stop, evaluation: out.evaluation }, null, 2));
    console.log(JSON.stringify(out.checks, null, 2));
    rmSync(root, { recursive: true, force: true });
}
