# My Pi UI

一个在浏览器中使用 Pi 的本地界面。前端使用 React 和 Vite，本地 Shell Service 通过 `pi --mode rpc` 与 Pi 通信，并读取 Pi 原有的会话数据。

> 当前为早期版本，面向本机使用。服务默认只监听 `127.0.0.1`，没有远程登录或鉴权功能。

## 功能

- **项目与会话**：浏览本地目录、创建文件夹并打开项目；查看 Pi 会话时间线和完整分支树；从用户消息分叉、克隆、压缩会话并查看操作结果；归档和恢复项目、会话。归档只影响列表显示，保留 Pi 的 JSONL 会话文件。
- **对话**：发送消息和图片、查看发送确认与失败提示、保留失败草稿以便重试、查看流式回复与工具调用、停止运行中的请求。
- **斜杠命令**：输入 `/` 可筛选命令，用方向键、Enter 或 Tab 补全。支持 `/new`、`/model`、`/thinking`、`/compact`、`/clone`、`/fork`、`/tree`，也会列出 Pi RPC 返回的扩展、提示模板和技能命令。
- **模型配置**：查看并切换可用模型，配置服务商、模型和凭据，测试连接。
- **扩展与技能**：查看 Pi 资源并管理配置；展示扩展发起的部分交互请求。
- **上下文与文件**：查看用量，在当前项目内按名称搜索文件并只读预览 UTF-8 文本（最多显示前 256 KB）。
- **记忆**：在 Memory 面板显式保存、编辑和删除应用／项目／会话记忆；Pi 扩展按作用域在每轮对话中调用已确认的记忆，并显示本轮用到的记录。偏好推测只生成待确认建议，可审阅或忽略。

## 运行

需要 Node.js `>=22.19.0`。下列命令安装已验证的 Pi 0.85.1、两套锁定依赖并启动开发服务：

```bash
git clone https://github.com/skystmm/my-pi-ui.git
cd my-pi-ui
npm install --global @earendil-works/pi-coding-agent@0.85.1
npm ci
npm ci --prefix shell-service
npm run check:pi
npm run dev:all
```

然后打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。Vite 前端运行在 `5173`，Shell Service 运行在 `5174`；`/ws` 经 Vite 代理连接到本地服务。

如果 `pi` 不在 `PATH`，可设置 `PI_UI_PI_BIN` 指向 Pi 可执行文件，或设置 `PI_UI_PI_ENTRY` 指向其 RPC 入口文件。

WebSocket 默认只接受 `http://127.0.0.1:5173`、`http://localhost:5173` 和 `http://[::1]:5173` 的浏览器来源。如需使用其他本机端口（例如预览端口 `4173`），启动 Shell Service 前设置 `PI_UI_ORIGINS=http://127.0.0.1:4173`；多个来源用逗号分隔。

## 使用方式

1. 点击左侧 **打开项目目录**，在本地目录列表中选择项目；可以直接新建文件夹。
2. 选择已有会话，或点击 **新建会话**。
3. 在底部输入消息。输入 `/` 查看命令候选；选择候选后再按 Enter 执行。
4. 在侧边栏归档项目或会话，需要时从归档区恢复。

项目和会话来自 Pi 的 `~/.pi/agent` 数据。打开过的空项目记录在 `~/.pi/agent/pi-ui-projects.json`，归档状态保存在 `~/.pi/agent/pi-ui-archive.json`；模型与凭据沿用 Pi 的配置文件。本项目不会把这些本地数据放入仓库。

## 开发与验证

```bash
npm run check       # 协议同步检查、类型检查、Shell Service 构建与测试
npm run build       # 生成前端 dist/
npm run build:shell # 生成 shell-service/dist/
npm run check:pi    # 在隔离目录中检查 Pi 版本及 RPC 基本接口
npx playwright install chromium # 首次运行浏览器测试时安装
npm run test:e2e    # 独立端口和 Pi 数据目录运行关键浏览器流程
```

浏览器测试使用 `5273/5274`，不会连接开发服务的 `5173/5174`。macOS 提供原生目录窗口；Linux 使用页面内目录浏览器，Windows 的原生窗口不受支持，页面内目录浏览器仍可使用。

协议类型以 `shell-service/src/ws-protocol.ts` 为源，运行 `npm run sync:protocol` 更新前端镜像。

### 记忆存储接口

`shell-service/src/memory/repository.ts` 定义 `MemoryRepository`，调用方只使用该接口；`shell-service/src/memory/sqlite.ts` 是当前 SQLite 实现。记忆有应用、项目、会话三级作用域。调用方应提供规范化的项目绝对路径；会话键由项目路径与 Pi session ID 组成。每次读取和修改都要显式传入作用域。接口提供创建、读取、分页列表、跨指定作用域检索、带预期修订号的更新和删除，以及修订历史。修订号不匹配时抛出 `MemoryConflictError`。

默认数据库在 `PI_CODING_AGENT_DIR`（未设置时为 `~/.pi/agent`）下的 `pi-ui/memory.sqlite`。SQLite 使用 FTS5 做文本检索，短于三个字符的查询用普通子串匹配。替换存储时实现同一接口，并运行 `shell-service/test/memory-repository.test.ts` 中的行为用例。Shell Service 启动的 Pi RPC 会加载记忆扩展；独立使用 Pi CLI 时，在仓库根目录构建后运行 `pi -e "$PWD/shell-service/dist/memory/pi-extension.js"` 即可启用同一扩展。Memory 面板可分别关闭自动调用与偏好建议，关闭不删除已保存的记忆。

偏好建议目前只识别用户直接表达的长期偏好和跨会话重复表达，不调用额外模型做语义归并；建议需人工确认才会写入正式记忆。`PI_UI_MEMORY_EXTENSION=0` 可禁止 Shell Service 为 Pi RPC 加载记忆扩展。

Pi 扩展接入与首个端到端切片见 [记忆集成设计](MEMORY_DESIGN.md)。

## 安全边界

Shell Service 默认监听本机回环地址，并在 WebSocket 握手时检查来源。文件列表限制在已打开项目目录中，路径校验会处理符号链接。请勿把 `5174` 端口直接暴露到公网；当前版本不提供多用户隔离或远程鉴权。

## 已知限制

- Pi 终端里的全部内置命令尚未移植到网页。命令候选只列出当前会话可执行的网页内置操作，以及 Pi RPC `get_commands` 返回的命令。分支树仅供查看，Pi RPC 没有切换 leaf 的命令。
- 文件区提供有限大小的文本只读预览，尚无编辑器或二进制文件预览。
- 原生系统目录选择窗口依赖 macOS；浏览器内目录选择可跨平台使用。Windows 尚未运行完整构建与浏览器验证。

## 项目结构

```text
src/                 React 前端
shell-service/src/   本地 HTTP/WebSocket 服务与 Pi RPC 适配
shell-service/test/  服务和边界行为测试
bin/cli.js           本地服务启动辅助命令
```
