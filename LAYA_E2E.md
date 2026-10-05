# pi-ui → 本地 Laya E2E 验证（2026-10-05）

使用 Playwright CLI 的 headed Chromium 浏览器，访问当前 pi-ui 生产构建。UI/Shell 端口 55173/55174；真实 Laya 0.3.27 在 127.0.0.1:8000，English/Multilingual 均用 MPS；聊天模型为本地 Ollama gemma4:e4b，Pi 0.85.1。无 mock 供应商或伪造工具结果。使用 /private/tmp/pi-ui-laya-e2e/agent 隔离配置及会话，不修改真实用户配置。

## 场景结果

| 场景 | 结果与证据 |
| --- | --- |
| 从空配置新增 provider/model，启用和设置默认 | UI 创建 Laya E2E、English、Multilingual；保存成功 |
| 浏览器刷新 / Shell 重启 | provider/model/global default 保留；项目覆盖按设计仅存于 Shell 内存 |
| English 手动测试 | 真实 choice/score/noul、实际 model、耗时、revision、usage 显示；323 ms |
| Multilingual 手动测试 | 三种题型、概率条与置信度展示通过；293 ms |
| 项目切换与跟随全局 | Multilingual 当前项目/English 全局状态切换通过；聊天模型始终为 gemma4:e4b |
| 完整真实聊天工具链 | UI prompt → Ollama → Pi system_one_evaluate → broker → Laya → Pi JSONL → UI 结果卡片通过 |
| 关闭项目 | 发现顶部误显“未配置”，已修复为“关闭”，重建后浏览器复验通过 |
| 不可达 endpoint 与恢复 | 改为本机59999，UI 显示 upstream_error，模型最近测试失败；恢复8000后测试重新通过，无成功误报 |

完整工具结果：中文重复扣款退款请求返回 department=billing（0.9994）、refund noul=0.9821、urgency score=1.326（0–2）；耗时440 ms，配置revision2，modelConfigId匹配项目Multilingual选择，实际model=laya-rl-agent，usage input_tokens144/output_tokens0。结果卡片展示分布与结构化详情。原始工具结果见 [tool-results.json](output/playwright/laya-e2e/tool-results.json)。

## 发现与边界

首次聊天模型输出错误嵌套结构（如 department.choice.instructions，而非 department.type/instructions），Pi 拒绝参数，未到达 Laya。使用安装的 Pi validator 对正确参数核验通过，第二轮提示给出精确 JSON 后真实工具调用成功。因此首轮失败属于模型生成参数偏差，未放宽接口校验。

第二轮在完成目标工具后，gemma4:e4b 又调用 write，生成隔离测试项目内 calendar_getter.py，最后回复也偏离任务。整回合“仅调用一次并正确总结”未通过，不能把它描述为自主 Agent 行为合格；目标 System One 工具调用、Laya真实答案与UI渲染均有独立成功证据。测试文件保留在临时项目，未进入业务仓库。

初次测试覆盖 PI_CODING_AGENT_SESSION_DIR 后，Pi 将JSONL写入根目录，测试UI watcher 未按项目发现；移除测试覆盖，按项目存储后JSONL与UI时间线正常。该修正仅在测试启动脚本，不改变产品路径。

修复只涉及 DecisionPanel 的关闭状态显示判断；低风险展示修复以浏览器复验验证，无新增测试框架。Standards审查：未改变工具协议/持久化/聊天模型，无无关源码改动；Spec审查：配置、真实测试、项目选择与工具结果覆盖，剩余模型行为限制如上。

修复后 `npm run check` 18/18通过（协议同步、TypeScript、Shell构建与测试）；`npm run build` 通过；`git diff --check` 通过。没有提交/推送。

## 视觉证据

- [多语言模型手动测试](output/playwright/laya-e2e/laya-multilingual-results.png)
- [真实聊天工具结果](output/playwright/laya-e2e/laya-tool-result-final.png)
- [项目关闭修复](output/playwright/laya-e2e/project-off-fixed.png)
- [不可达服务错误](output/playwright/laya-e2e/unreachable-endpoint.png)

Playwright snapshots/trace 留在 /private/tmp/pi-ui-laya-e2e/.playwright-cli，未打包完整网络日志或聊天凭据。console中的favicon404为现有资源问题；重启测试服务期间有预期WS重连失败，不作为稳定运行的应用错误。未覆盖Safari/Firefox、多窗口revision冲突、请求中取消、重载中切换和并发极限的浏览器场景，这些不能由此次E2E宣称通过。
