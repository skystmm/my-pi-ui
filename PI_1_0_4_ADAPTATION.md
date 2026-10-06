# Pi 1.0.4 适配记录

日期：2026-10-06。目标：把现有网页支持的 Pi RPC、会话、配置、扩展交互与 System One 功能适配到 1.0.4；不将 Pi 的全部终端交互移植到网页。

## 实现决定

- 根项目与 Shell 的 Pi coding-agent / pi-ai SDK 固定为 1.0.4。RPC 状态中的 model 对象统一转换为网页的 provider/model 标识。
- 创建、复制、分叉后采用 Pi 返回的新会话状态与完整条目，下一条输入继续正确会话。运行中输入通过 steering 排队；停止前清理队列并把未发送文字恢复到输入框。进程退出使用 stdin EOF 给 Pi 清理机会。
- 会话保留并展示 context_edit、独立 usage、工具 usage 和图片。上下文编辑展示目标与替换内容，不改写 JSONL 历史。
- 扩展命令通过 Pi 的 prompt 入口执行；支持 editor 初值、setEditorText 与 setTitle。builtin: 扩展来源保存在 extensions，避免错误归类为 package。
- Provider 列表结合 Pi 可用模型，展示 OAuth 与仅通过环境变量认证的 provider；不泄露令牌或凭据命令。配置沿用 SDK provider/model 默认值，支持 Azure Responses 和扩展 API 标识，保留未知元数据与图片能力。

## Azure 配置迁移

1.0.4 的 provider ID 是 azure，API ID 仍是 azure-openai-responses。Shell 启动时迁移 auth.json、models.json、settings.json 中旧 provider ID，以及默认 provider、enabledModels、modelThinkingLevels 的引用；不会修改 API ID 或会话历史。

迁移可重复运行，识别注释及尾逗号。修改前把原始配置备份到 agent/pi-ui/migrations/pi-1.0.4-UUID/，凭据备份权限为 0600。新旧键存在不同值时停止迁移并报告冲突，不覆盖任一方；处理冲突后重新启动。备份保留原始内容可供恢复。

## Pi 原生 System One

决策配置新增 pi-native 协议。在 UI 中添加 Pi 原生 classifier，填写 Pi provider ID，加载分类目录并选择远端模型，启用、设置默认后保存；也可以按项目切换。

调用通过 ModelRuntime 直接分类，复用 Pi 的 auth.json、models.json、模型目录缓存和环境变量认证，不创建聊天 AgentSession。choice / score 保留原生值；noul 映射为 Pi bool 并转换返回值。上游没有提供概率时不会编造。标准 Pi usage 进入工具记录和会话用量。HTTP Laya 和 OpenRouter 协议保留，工具、UI 测试和测评共用模型选择与结果校验。

原生分类目录以固定 SDK 的内置 provider 和本机目录缓存为准；不承诺加载由任意用户扩展动态注册的第三方 provider。认证及 Pi 模型目录在调用时读取，测评冻结的是已保存的 UI 决策配置，运行中不要外部改写 Pi 模型配置。

## 验证与边界

- npm run check：协议镜像、前端类型、Shell 构建及 35 项公共行为测试。
- npm run build：前端生产构建。
- npm run test:pi-compat：真实 Pi 1.0.4 进程配合隔离 agent 和合成服务，17 组集成检查覆盖流式事件、LF 帧、状态、会话、上下文编辑、压缩、扩展交互、队列恢复、原生分类及测评。
- PI_UI_LAYA_URL=http://127.0.0.1:8000/v1/systemone npm run test:pi-compat：加入本地 Laya english / multilingual；测评共 18 次调用，0 错误，没有发起聊天 LLM 请求。此结果是接入正确性，不代表分类质量。
- 浏览器验证覆盖扩展编辑器初值与保存、扩展写入输入框和页面标题、原生分类模型 UI 配置及手动测试。证据在 output/playwright/pi-104-*。

集成报告：[Pi 1.0.4 与本地 Laya](output/playwright/pi-104-integration.json)。原始审计保存在 COMPATIBILITY_PI_1_0_4.md。真实 Azure、云端 Jev、OAuth 交互登录和所有云模型没有逐一实际调用验证；合成服务验证协议与凭据解析，不代表云端服务可用性。Pi RPC 本身不支持的终端 widget/custom UI 仍受上游限制。

## 交付审查

Standards：依赖与协议镜像同步；新增配置迁移和原生调用测试通过；API 凭据不进入 UI 和验证报告。

Spec：逐项核对当前网页支持的 RPC、会话、模型配置、扩展交互、System One 与测评；原生目录加载的命令白名单遗漏已通过失败回归复现并修复。上述云端实际调用和 Pi 终端专用界面属于明确未验证或未支持边界。
