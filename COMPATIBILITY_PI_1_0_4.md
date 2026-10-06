# my-pi-ui 与 Pi 1.0.4 兼容性审计

日期：2026-10-06。目标：`/Users/sky/claude_project/pi_ui`，分支 `feat_system_one`，当前工作区（包含此前尚未提交的 System One 测评实现）。Pi：本地实际安装 `@earendil-works/pi-coding-agent` 1.0.4；Node 24.14.0。

结论：**核心 RPC 链路可用，但不能宣称完全兼容。** 存在已复现的配置和 UI 状态问题，以及新会话类型与原生 classifier 能力的覆盖缺口。此次只审计，未修改生产实现。

## 实际通过的验证

使用真实 Pi 1.0.4、仓库当前构建后的 `PiAdapter`、独立 `PI_CODING_AGENT_DIR` 和本地合成 OpenAI SSE 服务。没有调用付费云端模型，也没有改用户凭据、默认模型或会话。

| 路径 | 结果与边界 |
| --- | --- |
| 模型目录、`get_state`、扩展命令目录 | 通过；`model` 是对象 |
| 新会话 RPC、模型切换、thinking 设置 | 通过；仅验证 `off` |
| 文本流、U+2028/U+2029、JSONL framing | 通过 |
| `get_entries`、`get_tree`、会话统计 | 通过 |
| 克隆、分叉、切回原会话 | Adapter 通过；没有验证浏览器随后继续对话的选中状态 |
| 手动 compact | 通过；首轮小样本正常返回 Nothing to compact，扩大合成历史后成功 |
| 扩展 input 弹窗响应 | RPC 往返通过；非浏览器点击验证 |
| `/s1-eval validate --suite smoke-v1` | 通过；无额外模型请求 |
| `context_edit` 原始条目和实际推理上下文 | Pi 通过；删除标记保留，后续请求确实不含目标用户消息 |
| 流式响应中 steer 后 abort | 本次样本通过；未观察到停止后继续请求 |
| 合法 Azure 自定义模型配置 | Pi ModelRuntime 接受；my-pi-ui 校验拒绝，见下文 |

## 已复现问题

### 1. UI 拒绝 Pi 接受的 Azure API 配置

`shell-service/src/models-config.ts:12,71` 只接受四种 API，缺少 `azure-openai-responses`。同一配置由 Pi 1.0.4 的公共 `ModelRuntime.create()` 成功加载并取到自定义名称，而我们的 `validateModelsConfig()` 返回 `invalid_api`：

```json
{"providers":{"azure":{"baseUrl":"https://example.invalid/openai/v1","api":"azure-openai-responses","apiKey":"fixture","models":[{"id":"gpt-4.1","name":"Custom label"}]}}}
```

`example.invalid` 与 `fixture` 都是测试占位符；此项只验证配置加载，不测试 Azure 网络请求。内置 provider ID 白名单另仍写旧名称 `azure-openai-responses`，Pi 1.0.3 已改 provider ID 为 `azure`（API 名与 provider ID 不能混为一谈）。

注意：最初尝试的“不提供 baseUrl 的 models 条目”在 Pi 中也无效，已排除该样本；不能把它作为 UI 不兼容证据。该 API 白名单限制可能早已存在，并非全由本次升级引入。

### 2. 新建会话 UI 丢失模型名称

`shell-service/src/commands/session.ts:143` 只处理字符串形态 `st.model`。实测真实 Pi 返回模型对象，调用公开 `createSession` 命令处理器后，`session_snapshot.model` 为 `""`，应为 `fixture/fixture-chat`。pending 会话列表也复用该空值。影响初始显示与状态一致性，未证明模型实际调用失败；此问题可能升级前就存在。

### 3. CLI 仍警告用户降级到 0.85

`node bin/cli.js --version` 实际显示 `pi 1.0.4`，同时打印“不在 0.84–0.85.x 兼容矩阵，安装 @0.85”的提示（`bin/cli.js:57–59,85–86`）。启动并未被硬性阻断，但提示与已验证事实脱节。需更新实际支持范围和版本验证方式。

## 源码审查确认的覆盖缺口

- **新会话类型**：Pi 1.0.4 的 `SessionEntry` 还包含 `context_edit`、`usage`；我们的共享 schema 不包含它们。解析器仍保留未知条目，历史不会因此被静默删除；`EntryView` 只显示通用类型标签，不能解释上下文删改目标、替换内容及独立 usage 的分类/明细。不要把原始历史展示当作当前模型实际上下文。
- **扩展 UI 不完整**：editor 的 `prefill` 放在 placeholder，值被初始化为空，直接保存会提交空字符串（`ExtensionUIOverlay.tsx:10,83`）；appStore 未消费 `setTitle` 与 `set_editor_text`。这是源码确认的行为缺口，本轮没有浏览器复现，也不能归因于新版本。
- **原生 System One 未整合**：Pi 现已提供 classifier 模型目录、`modelRegistry.classify()` 与 codemode 分类调用计费。我们的 System One 仍走独立 broker/client；测评命令能加载，不代表原生目录、认证、路由和费用汇总已统一。当前 `choice/score/noul` 与 Pi 原生示例中的 `bool` 等差异需要显式适配，不能只换函数名。
- **队列与生命周期需要补覆盖**：当前 Adapter 不暴露 `clear_queue`，服务接收 `agent_settled` 后只更新条目/统计。官方建议交互式停止先清队列再 abort，并以 settled 判断完整结束。此次停止样本没有复现继续请求，因此列为待补验证，不作为确认 Bug。

## 工程检查与可复现证据

在目标仓库实际执行：

```sh
npm run check
npm run build
node bin/cli.js --version
node /private/tmp/pi-ui-compat-104/validate.mjs
node /private/tmp/pi-ui-compat-104/azure-probe.mjs
```

`npm run check`：协议镜像同步、前端 TypeScript、Shell 构建、28/28 公共行为测试通过。`npm run build`：生产构建通过。隔离兼容性断言的两个失败对应“新建会话模型名称”和“UI 接受合法 Azure API 配置”；测试结果摘要见同目录 JSON。临时验证脚本与独立 agent 目录位于 `/private/tmp/pi-ui-compat-104`，不作为发布运行时。

Standards 审查：现有检查通过；发现手工白名单/schema 与上游演进脱节。Spec 审查（无独立规格，以本次用户请求为准）：不能通过“完全兼容”门禁；核心命令通过，配置与状态问题已复现，新增能力尚未覆盖。

未验证：真实云端鉴权/OAuth、Azure 实际请求、Pi 1.0.4 下真实 Laya 推理完整 E2E、System One tool 的完整 Agent 自动调用、图片输入/生成、MCP/codemode 全流程、插件会话替换中的长期任务清理、浏览器所有交互。历史 Pi 0.85.1 的 Laya 验证结果不能冒充本轮 1.0.4 结果。

## 建议实施顺序

1. 修正新建会话模型对象解析；为公开命令增加回归测试。
2. 扩展模型配置验证到实际支持 API，更新 provider ID，验证迁移和旧配置行为。
3. 更新 CLI 支持版本与文档；把真实 Pi 的隔离协议验证纳入升级回归。
4. 补充 `context_edit`、`usage` 展示和扩展 UI；补队列/settled 场景。
5. 以独立 adapter 接入 Pi 原生 classifier，保留 Laya 现有 HTTP provider，再进行真实 Laya 与原生 Jev 的分别验证。

## 一手依据

精确版本以本地 1.0.4 安装包的 `docs/`、`dist/core/session-manager.d.ts`、`dist/core/model-runtime.d.ts`、`CHANGELOG.md` 与运行结果为准。在线 main 文档可能继续变化：

- [Pi 官方 RPC 命令](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md)
- [Pi 官方模型与 classifier 接口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
- [Pi 官方会话格式](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)
- [Pi 官方变更记录](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md)

## 后续适配

2026-10-06 已实施 Pi 1.0.4 适配；本文件保留首次审计记录，问题修复与实际验证范围见 [适配说明](PI_1_0_4_ADAPTATION.md)。
