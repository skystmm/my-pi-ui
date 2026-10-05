# 本地 Laya 接入验证（2026-10-05）

真实推理通过 pi-ui System One 客户端与 Pi 工具 execute → broker → HTTP 路径验证。Laya 0.3.27、Python 3.12.13、PyTorch 2.14.1，macOS arm64，服务确认 English/Multilingual 实际设备均为 MPS、CPU fallback 0。权重 bundle revision 为 `7b928d828b7b0e022f929d9bd2e44165aa270148`。本次未改动产品源码，新增可复跑脚本与报告。

## 结果

| 样例 | choice | 退款 noul | urgency score / 0–2 |
| --- | --- | --- | --- |
| 英文重复扣款、立即退款 | billing ✓ | 0.9331 ✓ | 1.8360 |
| 英文设置页面崩溃 | technical ✓ | 0.1031 ✓ | 1.4731 |
| 中文重复扣款、立即退款 | billing ✓ | 0.9821 ✓ | 1.1849 |
| 中文设置页面崩溃 | technical ✓ | 0.0057 ✓ | 1.0637 |

四条 choice 与 noul 标签全部命中（noul 分界预置 0.5）；仅是小样本冒烟，不代表准确率或校准结论。score 结构及分布有效，中文立即退款紧急程度偏低，英文 crash 反而得分较高，尚未通过效果门槛评估。没有为 score 制定独立等级标签，因此不报告 MAE。

首次英文请求 1189 ms（权重已预载，含首次 MPS 推理开销）；首次中文请求 54078 ms（含 multilingual 下载和加载）。暖态串行 20 条英文请求、每条 3 个问题，nearest-rank p50 75 ms、p95 82 ms。原始请求与答案、usage、健康状态和性能样本见 `LAYA_VALIDATION_RESULTS.json`。无云费用；不将延迟外推到其他硬件或长上下文。

客户端接受三种原生答案及额外 Laya 字段，usage 保留；工具切换 English→Multilingual、关闭、token revoke 验证通过。未调用聊天模型，不需要重启 Pi。首次切换测试错误地假设不同 checkpoint 返回不同 model 名，断言失败；Laya 两者均返回 `laya-rl-agent`。修正验证为配置 ID 加直接 HTTP routing 证据后通过，原失败记录作为 coldRun 保留。实际 routing 分别为 english/multilingual，repo 为 bundle 根目录与 multilingual 子目录。

启动日志提醒 English 的 choice:11+ temperature 被限制到 0.5，该范围 confidence 视为未校准。本次只有 2 个 choice 选项，未验证 11+；不把置信度用作自动执行权限。choice/score confidence、answer_confidence 和 noul confidence 的语义不同，UI 配置采用 vendor-defined，完整值可在结构化结果查看。

## 已配置的 UI

- Provider：Local Laya，`http://127.0.0.1:8000/v1/systemone`，无鉴权，15 秒 timeout。
- Model：Laya 自动路由（不发 model）、Laya English（english）、Laya Multilingual（multilingual）。三种题型，maxQuestions 64、maxOptions 100。
- 本次原全局配置为空，已启用并将自动路由设为默认。持久配置位于 Pi agent 目录的 pi-ui/system-one.json；不会写入项目仓库。默认配置中文退款请求已实测 noul=0.9736。
- Laya 服务当前在本机端口 8000 运行。本次环境位于 `/private/tmp/pi-ui-laya-venv`，机器重启或清理临时文件后按下述命令重新准备。UI 的“决策配置”刷新后可查看与测试。

## 复跑

```bash
uv venv --python 3.12 .venv-laya
uv pip install --python .venv-laya/bin/python 'laya[serve]==0.3.27'
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=english,multilingual LAYA_DEVICE=mps LAYA_PRELOAD=1 .venv-laya/bin/laya-serve
# 在另一终端
npm run build:shell
node scripts/validate-laya.mjs /tmp/pi-ui-laya-validation.json
```

脚本使用独立临时配置，不修改实际模型选择，向本机服务发送合成样例。需事先启动服务；首次权重加载允许 120 秒，UI 默认 15 秒，换机器首次测试应先预载或调高 timeout。`.venv-laya` 为本地环境，不要提交。

未验证：真实聊天模型自主选择工具、UI 中文结果的视觉联调、大型 choice、长上下文、并发性能、完整中英文效果集及 CPU 推理。既有错误/取消/并发确定性测试仍由 `npm run check` 覆盖。

依据：[官方源码与服务配置](https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py)、[官方模型路由](https://github.com/NandhaKishorM/laya/blob/main/laya/router.py)。
