# System One 测评插件（首批实现）

已落地共享 runner、Pi `/s1-eval`、独立 companion 与 pi-ui 测评面板。固定 `smoke-v1` 包含中英文 × choice/noul/score 六个合成样例。此套件用于接入验证，不作为生产模型排名。

## 使用

在 pi-ui 顶部打开 **模型测评**，选择已保存且启用的模型、重复次数，查看预计调用数后开始。界面显示进度、取消、报告、语言/标签分组、JSON/Markdown 导出与基线比较。无需先创建聊天会话。

模型配置 ID 显示在测评选择列表中。pi-ui 新启动的 Pi 自动加载命令：

```text
/s1-eval suites
/s1-eval validate --suite smoke-v1
/s1-eval run --suite smoke-v1 --models MODEL_ID_A,MODEL_ID_B --repeats 1
/s1-eval list
/s1-eval status RUN_ID
/s1-eval cancel RUN_ID
/s1-eval report RUN_ID
/s1-eval compare RUN_ID --baseline BASELINE_ID
```

将占位符替换为实际配置 ID / 运行 ID。已有 Pi 进程需重新启动才能加载新扩展。命令直接调用测评主机，不触发聊天 LLM；只用 `appendEntry` 写少量会话元数据，TUI renderer 不参与模型上下文。

独立终端 Pi 使用同一插件，构建后显式加载：

```bash
npm ci
npm ci --prefix shell-service
npm run build:shell
pi --extension ./shell-service/dist/system-one/eval/pi-extension.js
```

仓库也声明了 `package.json` 的 `pi.extensions`，可在构建后以本地 Pi package 安装；实际验证采用本地 npm 打包安装后的 `--extension` 路径，没有改动全局 Pi 插件列表。独立模式自动启动回环随机端口的 companion，使用同一 agent 目录的 `pi-ui/system-one.json` / 私有凭据文件。自定义目录使用 `PI_CODING_AGENT_DIR`。

## 行为与存储

- 单主机同时运行一个测评，串行执行；最多 8 模型、10 次重复、200 个计划调用，15 分钟总时限，不自动重试。
- 复用 HTTP client 与输入/输出校验。Shell 内决策工具、手动连接测试、测评共用每 provider 两个并发槽；测评等待空闲槽。独立 companion 是独立主机，不跨进程共享并发限额。
- 启动时冻结模型、provider 和凭据的内存快照；持久化 manifest 只含公开模型身份、能力、超时、地址 origin 和 revision，省略密钥和 URL 查询参数。
- 运行目录：`<agent-dir>/pi-ui/evals/<UUID>/`。包含 manifest、固定 cases、追加 events、JSON/Markdown report；目录 0700、文件 0600。
- 普通决策工具 token 不具备批量测评权限。测评使用独立 token；撤销 Pi grant 会取消该 Pi 启动的工作。UI 启动的任务关闭面板后继续；独立 Pi 会话退出关闭 companion。
- 正常取消会保留已发出的那次请求为 `cancelled` 错误行，避免掩盖实际尝试。已计费的上游调用不能撤销。
- 同 agent 目录的多个主机用 PID lease 避免互相标记中断。重启时将已死亡主机遗留的 running 记录标记 interrupted；不自动续跑。跨主机取消通过本地取消标记传递。
- manifest/cases/report 原子替换；运行中的报告读取不改写运行状态。日志或报告写入失败时，主机内存返回 failed/storage_error 且不输出质量分数；失败产物可能无法持久化，重启后按中断处理。完整上游 usage、答案字段与 routing（若返回）留在合成样例明细中。

## 指标口径

- choice：正确率、macro-F1、混淆矩阵、未缩放多分类 Brier（0–2）。macro-F1 包含声明的全部类别，缺少样本的类别 F1 为 0，因此六例 smoke 不能全面验证类别能力。
- noul：阈值 0.5，正确率、正类 precision/recall/F1、二元 Brier（0–1）。
- choice/noul：ECE 使用 10 个等宽 bins 和概率最大值；供应商 confidence 不混入该计算。score 无 ECE。
- score：连续 score 与固定标签的 MAE、指定容差命中率；当前 smoke 容差为 0，连续分数不等于整数标签时即不命中。
- 有效样例正确率与含失败的尝试正确率分开；未支持题型跳过。失败按 sanitized code 汇总。
- nearest-rank p50/p95 包含已尝试失败的耗时，使用单调时钟；firstCall 只是本次运行的首请求，不承诺服务处于冷启动。重复一致性按成功返回的原始预测众数比例计算。
- 比较要求 dataset hash、指标/适配器版本、重复次数一致，且运行均 completed；只并列展示描述性结果，不输出显著性或晋级结论。

## 验证与交付边界

验证记录见 [SYSTEM_ONE_EVAL_VALIDATION.md](SYSTEM_ONE_EVAL_VALIDATION.md)。固定指标 fixture、失败分母、配置冻结、能力跳过、取消、期限、恢复与权限边界由 `npm run check` 验证；生产前端由 `npm run build` 构建。

本阶段未实现外部 JSONL 导入、120 例质量基准集、source-group bootstrap、resume、工作流基线/变体实验、自动 token 计量和用 System One 裁判评判其他 LLM。这些属于设计中的后续阶段；报告始终明确 `workflow.status=not_run`，不宣称已节省 token。
