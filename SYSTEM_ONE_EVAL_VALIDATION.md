# System One 测评插件验证

日期：2026-10-06。目标：首批可运行测评插件与 UI，使用隔离 `PI_CODING_AGENT_DIR`，未覆盖实际用户模型配置、凭据或聊天会话。

## 自动检查

- `npm run check`：协议镜像、前端 TypeScript、Shell 构建、28 项公共行为测试全部通过。
- `npm run build`：React/Vite 生产构建通过。
- 新增 10 项测评测试：固定指标、失败分母、预算/取消、配置冻结、能力跳过与活跃主机保护、权限/撤销、命令解析、在途取消、总期限、日志故障。
- 总期限通过注入 20ms 时限验证 Abort 与无重试；默认生产时限为 15 分钟，没有等待完整 15 分钟进行壁钟验证。
- 日志故障用例先复现 EISDIR 拒绝，修复后返回 failed/storage_error，质量指标为空，主机继续运行。

## 真实 Pi 与本地 Laya

Pi `@earendil-works/pi-coding-agent` 0.85.1；Laya 0.3.27，English / Multilingual 均在 MPS，health 显示 CPU fallback 0。checkpoint revision 均为 `7b928d828b7b0e022f929d9bd2e44165aa270148`。

通过 `pi --mode rpc --no-session --extension <built extension>` 执行 suites/validate/run/report；命令注册成功，每套 2 模型 × 6 用例，12 次有效结果，0 请求错误，**agent_start=0**。另通过真实 PiAdapter 验证 Shell 提供独立 evaluation grant 与 `/s1-eval validate`，没有聊天 Agent 启动。

执行 `npm pack --pack-destination <temp> --ignore-scripts`，然后在临时目录 `npm install <tarball> --ignore-scripts --omit=dev --offline`；加载该安装包的扩展，独立 companion 再次完成 12 次真实调用，0 错误，agent_start=0。没有安装到用户全局 Pi 插件列表，没有发布 npm 包。

最新打包运行 `ddb2318a-c507-4b6f-88b9-b61112bef06c` 的合成样例明细、routing/health 和报告见 [SYSTEM_ONE_EVAL_VALIDATION.json](SYSTEM_ONE_EVAL_VALIDATION.json)。root model 都返回 laya-rl-agent，实际 routing 分别为 english / multilingual，不用通用 model 名区分权重。

| 模型 | choice 正确率（2例） | noul 正确率（2例） | score MAE（2例） |
|---|---:|---:|---:|
| English | 1.0 | 1.0 | 0.47655 |
| Multilingual | 0.5 | 1.0 | 0.54855 |

这些数字验证固定标签和统计链路，不构成模型排名；样例太少且类别覆盖不平衡。所有报告均 `promotionEligible=false`、`workflow.status=not_run`。

## 浏览器端到端

使用 Playwright CLI 技能，打开隔离端口的实际 React 页面并连接 Shell Service，不使用浏览器 mock。

- UI 选择 English + Multilingual，启动 12 次调用：completed 12/12，错误 0。
- 查看报告、语言/标签分组入口、JSON 与 Markdown 下载成功；下载结果保存在 `output/playwright/s1-eval-ui-report.*`。
- 两个相同版本、重复数且 completed 的报告可比较；取消的运行/重复数不同显示不可比较。
- 启动重复运行并立即取消；在最终构建上得到 `b95d4411-4156-4511-b940-34c2b7791fdc`，cancelled 1/60，记录 1 次 cancelled 在途尝试，不继续后续调用。
- 关闭再打开面板，历史运行可重新查询；重启临时 Shell 后恢复连接并读取既有报告。
- 查看 UI 截图确认表格、分组入口、导出和比较控件可见，截图见 `output/playwright/s1-eval-report.png`。

验证期间 HMR 因依赖/类型变更多次刷新页面，旧引用失效后重新读取页面继续；一次错误选择取消记录导致“可比较”断言失败，改选 completed 记录后可比较/不可比较双向断言通过。浏览器控制台的 favicon 404 与临时 Shell 重启断连未作为功能错误。最终操作没有 React 运行错误。

## 审查与未验证项

**Standards**：检查协议源/镜像、依赖打包、凭据与 URL query 隐藏、回环 token 权限、追加/原子存储、异常处理和最终 diff；无阻断问题。

**Spec**：对照设计的首批范围，命令、共享 runner、六例 smoke、取消/期限/恢复、指标、报告与 UI 已完成。120 例基准、JSONL 导入、bootstrap/resume 和成对工作流 token 实验是后续阶段，实施文档已明确标记。

未使用真实云端 Jev/OpenRouter 凭据；其网络协议复用既有 client，当前真实测评仅覆盖本地 Laya。未手动验证终端交互式 TUI 排版，真实命令验证使用 RPC；renderer 按 Pi Component 接口提供。独立 companion 的 provider 并发限制只在其本进程生效，不提供跨进程共享配额。
