# pi-ui 工程约束

本仓库是 React/Vite 浏览器 UI 与 Node Shell Service。Pi RPC 当前验证版本为 `@earendil-works/pi-coding-agent` 1.0.4；实际仓库优先于历史会话。

- 前端位于 `src/`，主机服务位于 `shell-service/src/`；Node 使用 NodeNext 相对 `.js` 导入。
- `shell-service/src/ws-protocol.ts`、System One 类型及会话 schema 是源文件；通过 `npm run sync:protocol` 生成前端镜像，不直接改生成文件。
- `npm run check`：协议同步、前端 TypeScript、Shell 构建、Node 公共行为测试。
- `npm run test:pi-compat`：真实 Pi 1.0.4 RPC 集成回归，使用隔离 agent 与合成服务；可通过 `PI_UI_LAYA_URL` 加入本地 Laya。
- `npm run build`：前端生产构建；`npm run build:shell`：Shell 与 Pi 插件构建。
- 定向测试：在 `shell-service/` 执行 `node --import tsx --test test/<file>.test.ts`。部分测试需要本地监听权限。
- System One HTTP 协议由 `system-one/client.ts` 统一验证。聊天模型选择、决策模型选择与测评模型列表相互独立。
- 测评固定标签作为真值，不用模型自己的输出构造期望值；未支持能力、失败、取消与成功不得混算。
- 测评命令是用户操作，不注册批量测评 Agent tool，不通过 `sendMessage` 将报告注入 LLM。
- 本地凭据、agent 目录、报告运行目录不得提交。报告导出必须显式操作；内置合成样例的脱敏验证产物可以版本化。
- 外部真实服务验证使用独立 `PI_CODING_AGENT_DIR`，不得覆盖用户选择、凭据或会话。
- 本地任务通过设计与实施 Markdown 追踪；未经当前用户授权不提交、推送、创建远程 Issue/PR 或部署。
