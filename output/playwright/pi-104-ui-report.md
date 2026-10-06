# Pi 1.0.4 浏览器验证

2026-10-06，隔离 agent / 项目，Chrome，真实 Pi 1.0.4，合成聊天与 Jev HTTP 服务（未调用云端 Jev）。

- 创建会话后显示 fixture/chat 与 off。
- /compat-editor：编辑器 value 为“预填内容”；不修改点击保存，通知为“保存:预填内容”。
- /compat-prefill：输入框显示“插件写入输入框”，页面标题为 Pi UI 1.0.4。
- 决策配置：添加 Pi 原生 classifier，启用工具，加载目录出现 Jev · jev-latest，选择、保存并设置全局默认成功。
- 测试模型：显示测试通过、实际模型 jev-latest；choice 概率 50%/50%，score 1（没有虚构概率）、noul 0.9。

截图：pi-104-editor.png、pi-104-editor-saved.png、pi-104-prefill.png、pi-104-native.png。测试中重启专用 Shell 导致 WebSocket 断线重连日志，另有 favicon 404；稳定连接下以上流程通过。
