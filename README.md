# My Pi UI

一个在浏览器中使用 Pi 的本地界面。前端使用 React 和 Vite，本地 Shell Service 通过 `pi --mode rpc` 与 Pi 通信，并读取 Pi 原有的会话数据。

> 当前为早期版本，面向本机使用。服务默认只监听 `127.0.0.1`，没有远程登录或鉴权功能。

## 功能

- **项目与会话**：浏览本地目录、创建文件夹并打开项目；查看 Pi 会话时间线；归档和恢复项目、会话。归档只影响列表显示，保留 Pi 的 JSONL 会话文件。
- **对话**：发送消息和图片、查看流式回复与工具调用、停止运行中的请求。
- **斜杠命令**：输入 `/` 可筛选命令，用方向键、Enter 或 Tab 补全。支持 `/new`、`/model`、`/thinking`、`/compact`、`/clone`、`/fork`、`/tree`，也会列出 Pi RPC 返回的扩展、提示模板和技能命令。
- **模型配置**：查看并切换可用模型，配置服务商、模型和凭据，测试连接。
- **System One 决策模型**：独立配置服务商与模型，通过全局默认或当前项目覆盖切换；支持 TypeSafe Jev、本地 System One HTTP 和 OpenRouter Decisions。
- **扩展与技能**：查看 Pi 资源并管理配置；展示扩展发起的部分交互请求。
- **上下文与文件**：查看用量、会话分支链，以及当前项目内的文件列表。

## 运行

需要 Node.js `>=22.19.0` 和可通过 `PATH` 调用的 `pi` 命令。项目当前使用 `@earendil-works/pi-coding-agent` 的 RPC 接口；其他 Pi 发行版或版本可能不兼容。

```bash
git clone https://github.com/skystmm/my-pi-ui.git
cd my-pi-ui
npm ci
npm ci --prefix shell-service
npm run dev:all
```

然后打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。Vite 前端运行在 `5173`，Shell Service 运行在 `5174`；`/ws` 经 Vite 代理连接到本地服务。

如果 `pi` 不在 `PATH`，可设置 `PI_UI_PI_BIN` 指向 Pi 可执行文件，或设置 `PI_UI_PI_ENTRY` 指向其 RPC 入口文件。

## 使用方式

1. 点击左侧 **打开项目目录**，在本地目录列表中选择项目；可以直接新建文件夹。
2. 选择已有会话，或点击 **新建会话**。
3. 在底部输入消息。输入 `/` 查看命令候选；选择候选后再按 Enter 执行。
4. 在侧边栏归档项目或会话，需要时从归档区恢复。

项目和会话来自 Pi 的 `~/.pi/agent` 数据。归档状态保存在 `~/.pi/agent/pi-ui-archive.json`；模型与凭据沿用 Pi 的配置文件。本项目不会把这些本地数据放入仓库。

## System One 决策模型

点击顶部 **决策配置**，或在聊天模型配置中进入 **决策**：

1. 添加 TypeSafe Jev、本地服务或 OpenRouter 服务商，填写完整 endpoint、鉴权方式和超时。
2. 添加模型，填写远端模型 ID、支持的问题类型（choice / score / noul）和置信度语义。本地单模型服务可以省略远端 ID；OpenRouter 必须填写其 Decisions 模型 ID。
3. 启用决策工具，设置全局默认并保存。点击 **测试模型（可能计费）** 查看实际模型、概率分布、耗时及 usage。
4. 打开项目后，可在顶部选择该项目的模型、跟随全局或关闭。选择立即影响下一次调用，无需重启 Pi；已发出的请求使用原配置。

Shell 启动的 Pi 会加载 `system_one_evaluate` 工具。工具接受 `state` 和 `questions`，由 Shell 根据项目选择解析模型；结果显示在对话工具卡片中。概率只供判断参考，不会自动授予执行权限。此功能不改变聊天模型。

配置保存在 Pi agent 目录下的 `pi-ui/system-one.json`，API Key 单独保存在 `pi-ui/system-one-auth.json`（0600），不会返回 UI。环境变量方式读取 **Shell Service 进程** 的环境；修改变量后需重启 Shell。当前项目覆盖与最近测试状态只在本次 Shell 生命周期内保留。配置保存有 revision 冲突检测，其他窗口修改后应刷新再编辑。

首批支持原生 System One HTTP 与 OpenRouter Decisions，请勿填写 Chat Completions 地址。没有自动重试或模型回退；每服务商最多同时处理两次工具请求，超限返回 busy。手动测试不占工具并发槽。真实模型冒烟和效果评估需自行提供凭据或运行本地服务，验证场景见 [设计与实施记录](SYSTEM_ONE_DESIGN.md)。

## 开发与验证

```bash
npm run check       # 协议同步检查、类型检查、Shell Service 构建与测试
npm run build       # 生成前端 dist/
npm run build:shell # 生成 shell-service/dist/
```

协议类型以 `shell-service/src/ws-protocol.ts` 为源，运行 `npm run sync:protocol` 更新前端镜像。

## 安全边界

Shell Service 默认监听本机回环地址，并在 WebSocket 握手时检查来源。文件列表限制在已打开项目目录中，路径校验会处理符号链接。请勿把 `5174` 端口直接暴露到公网；当前版本不提供多用户隔离或远程鉴权。

## 已知限制

- Pi 终端里的全部内置命令尚未移植到网页。命令候选只列出网页已接入的内置操作，以及 Pi RPC `get_commands` 返回的命令。
- 文件区目前提供目录列表，尚无文件内容预览或编辑器。
- 原生系统目录选择窗口依赖 macOS；浏览器内目录选择可跨平台使用。

## 项目结构

```text
src/                 React 前端
shell-service/src/   本地 HTTP/WebSocket 服务与 Pi RPC 适配
shell-service/test/  服务和边界行为测试
bin/cli.js           本地服务启动辅助命令
```
