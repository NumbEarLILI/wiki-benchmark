# KB Bench · 知识库测评平台

一个用于对比评测不同知识库（RAG）服务的跑分网站。接入多个知识库服务，用同一套测评集与指标体系跑分，输出排行榜、雷达图与逐题诊断。

## 功能

- **知识库接入**：内置 8 类适配器，表单驱动配置，支持在线连通性测试、原始响应与工具调用轨迹查看
  | 类型 | 对接方式 |
  | --- | --- |
  | 内置演示知识库 | 本地 BM25（虚构的「星云云」产品文档），可调噪声与延迟，用于体验流程或作基线 |
  | MCP 服务 | Streamable HTTP / SSE / WebSocket / stdio 四种传输；**直连模式**调用指定检索工具（可一键获取工具列表并按 inputSchema 生成参数模板），**Agent 模式**由 LLM 自主选择工具作答 |
  | Skill 技能包 | Agent Skill 规范（`SKILL.md` + 参考资料 / 脚本），支持单个技能或技能目录；**Agent 模式**由 LLM 按技能说明读文件、检索、（可选）执行脚本后作答，**检索模式**无需 LLM 直接评估资料可检索性 |
  | Dify | 应用对话 `chat-messages`（引用和归属）或知识库检索 `datasets/{id}/retrieve` |
  | RAGFlow | 检索 `/api/v1/retrieval` 或聊天助手 `/api/v1/chats/{id}/completions` |
  | FastGPT | 应用对话 `/api/v1/chat/completions`（`detail=true` 返回引用）或知识库搜索测试 |
  | OpenAI 兼容接口 | 任意 Chat Completions 兼容的 RAG 服务，可配置引用片段的提取路径 |
  | 自定义 HTTP | 请求模板（`{{question}}`、`{{topK}}`）+ 字段路径映射（支持 `a.b[0].c`、`[*]`） |
- **测评集管理**：在线编辑，或导入 JSON / JSONL / CSV（兼容中英文字段别名），单题调试
- **评测任务**：选择测评集 + 多个知识库并发跑分，实时进度，可停止、重跑、导出 CSV
- **指标体系**
  - 检索：Hit@K、Recall@K、Precision@K、MRR、nDCG@K、上下文要点覆盖
  - 答案：要点覆盖率、Token F1、ROUGE-L（中文按字切分），可选 LLM 裁判（正确性 / 忠实度）
  - 性能：成功率、平均 / P50 / P95 延迟
  - 综合得分 = 检索、答案、性能三项加权（权重可调，缺失维度自动归一化，失败题计 0 分）
- **排行榜与对比**：按测评集排名，分项柱状图、能力雷达、延迟分布，逐题矩阵对比召回片段与答案

## 快速开始

```bash
npm install
npm run dev          # API: http://localhost:8787  Web: http://localhost:5173
```

首次启动会自动创建演示测评集与三个不同质量的演示知识库，并跑一次对比评测。设置 `NO_SEED=1` 可跳过。

生产模式（由 API 服务托管前端静态文件）：

```bash
npm run build
npm start            # http://localhost:8787
```

数据保存在 `server/data/db.json`（可通过 `DATA_DIR` 修改），知识库密钥在接口返回时会脱敏。

## MCP 与 Skill 接入说明

- **结果映射**：MCP 工具返回的 `text` 内容若为 JSON，会自动识别 `results / chunks / documents / records …` 列表及 `content / text / title / source / score …` 字段；也可手动填写路径。`resource` 类型内容会作为召回片段，来源取资源 URI。
- **Agent 模型**：MCP Agent 模式与 Skill Agent 模式需要一个支持函数调用的 OpenAI 兼容模型。可在接入配置中单独指定，或在「评分设置 → 默认 Agent 模型」统一配置。Agent 调用工具时读取到的内容会作为召回片段参与检索指标计算，完整轨迹在逐题结果中可见。
- **内置演示**：服务自身在 `/demo/mcp` 暴露了一个演示 MCP 知识库（Streamable HTTP）；stdio 方式可用命令 `npx tsx server/src/demo/mcp-stdio.ts` 启动。演示技能位于 `server/demo/skills/star-cloud-docs/`。
- **安全提示**：stdio 传输会在服务端启动所配置的命令，Skill 的「允许执行脚本」会在服务端运行技能脚本，请仅用于可信的服务与技能。Skill 的文件读取被限制在技能目录内。
- **得分可比性**：仅检索的接入（如 MCP 直连检索工具、Skill 检索模式）没有答案得分，综合分只由检索与性能加权得出，排行榜中会标注「仅检索」。

## 测评集格式

```json
[
  {
    "question": "包年包月资源多久内可以无理由退款？",
    "referenceAnswer": "购买后 7 天内可申请无理由全额退款。",
    "relevantDocs": ["退款政策.md"],
    "keywords": ["7天", "全额退款"],
    "tags": ["计费"]
  }
]
```

- `question` 必填；其余字段越完整，可计算的指标越多
- `relevantDocs`：召回片段的来源（文件名）或 ID 包含该值即判定为相关
- 未提供 `relevantDocs` 时，用 `keywords` 覆盖率（≥50%）判定相关；再退化为参考答案词元覆盖率（≥50%）
- CSV 首行为表头，可用中文表头：`问题,参考答案,相关文档,关键词,标签`，多值用 `|` 或 `;` 分隔

## 扩展新的知识库

在 `server/src/adapters/` 下实现 `AdapterDefinition`（声明配置字段 `fields` 与 `query()`，返回 `{ answer?, contexts[], trace? }`），并在 `adapters/index.ts` 中注册，前端表单会根据字段定义自动生成（字段可用 `showIf` 按其它字段取值显示）。需要 LLM 自主调用工具的接入可复用 `server/src/agent.ts` 中的 `runAgent`。

## 目录结构

```
server/   Express + TypeScript：适配器、指标计算、评测执行器、JSON 持久化
web/      React + Vite + Tailwind + Recharts 前端
```

## 测试

```bash
npm test             # 指标、分词、数据导入、字段映射单元测试；MCP（HTTP / SSE / stdio）、Agent 循环与 Skill 集成测试
npm run typecheck
```
