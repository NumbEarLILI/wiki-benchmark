# KB Bench · 知识库测评平台

一个用于对比评测不同知识库（RAG）服务的跑分网站。接入多个知识库服务，用同一套测评集与指标体系跑分，输出排行榜、雷达图与逐题诊断。

## 功能

- **知识库接入**：内置 9 类适配器，表单驱动配置，支持在线连通性测试、原始响应与工具调用轨迹查看
  | 类型 | 对接方式 |
  | --- | --- |
  | 内置演示知识库 | 本地 BM25（虚构的「星云云」产品文档），可调噪声与延迟，用于体验流程或作基线 |
  | 本地检索基线（BM25） | 直接对测评集自带的文档集合建立 BM25 索引，无需部署任何服务，作为传统关键词检索的参考线 |
  | MCP 服务 | Streamable HTTP / SSE / WebSocket / stdio 四种传输；**直连模式**调用指定检索工具（可一键获取工具列表并按 inputSchema 生成参数模板），**Agent 模式**由 LLM 自主选择工具作答 |
  | Skill 技能包 | Agent Skill 规范（`SKILL.md` + 参考资料 / 脚本），支持单个技能或技能目录；**Agent 模式**由 LLM 按技能说明读文件、检索、（可选）执行脚本后作答，**检索模式**无需 LLM 直接评估资料可检索性 |
  | Dify | 应用对话 `chat-messages`（引用和归属）或知识库检索 `datasets/{id}/retrieve` |
  | RAGFlow | 检索 `/api/v1/retrieval` 或聊天助手 `/api/v1/chats/{id}/completions` |
  | FastGPT | 应用对话 `/api/v1/chat/completions`（`detail=true` 返回引用）或知识库搜索测试 |
  | OpenAI 兼容接口 | 任意 Chat Completions 兼容的 RAG 服务，可配置引用片段的提取路径 |
  | 自定义 HTTP | 请求模板（`{{question}}`、`{{topK}}`）+ 字段路径映射（支持 `a.b[0].c`、`[*]`） |
- **测评集 = 文档集合 + 问题集合**：内置 13 个社区开源专业评测集，一键按需抽样导入；也可上传 BEIR / SQuAD / Markdown 文档 + 问题文件，在线编辑文档与题目，单题调试
- **文档接入知识库**：一键把测评集文档上传到 Dify / RAGFlow / FastGPT，或打包为 Skill 技能包 / 文档 ZIP，保证各家知识库基于同一份语料评测
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

首次启动会自动创建演示测评集（含文档集合）、三个不同质量的演示知识库、本地 BM25 基线及 MCP / Skill 演示接入，并跑一次对比评测。设置 `NO_SEED=1` 可跳过。

生产模式（由 API 服务托管前端静态文件）：

```bash
npm run build
npm start            # http://localhost:8787
```

数据保存在 `server/data/db.json`（可通过 `DATA_DIR` 修改），知识库密钥在接口返回时会脱敏。

## MCP 与 Skill 接入说明

- **选择路径**：Skill 的「技能路径」旁有「浏览」按钮，可以在网页上浏览评测服务所在机器的目录并选中技能文件夹（包含 SKILL.md 的目录会标记为「技能」），常用位置里列出了演示技能、生成的技能和已接入的技能。目录浏览会暴露服务端的目录结构，请勿把评测服务暴露在公网。

- **结果映射**：MCP 工具返回的 `text` 内容若为 JSON，会自动识别 `results / chunks / documents / records …` 列表及 `content / text / title / source / score …` 字段；也可手动填写路径。`resource` 类型内容会作为召回片段，来源取资源 URI。
- **Agent 模型**：MCP Agent 模式与 Skill Agent 模式需要一个支持函数调用的 OpenAI 兼容模型。可在接入配置中单独指定，或在「评分设置 → 默认 Agent 模型」统一配置。Agent 调用工具时读取到的内容会作为召回片段参与检索指标计算，完整轨迹在逐题结果中可见。
- **内置演示**：服务自身在 `/demo/mcp` 暴露了一个演示 MCP 知识库（Streamable HTTP）；stdio 方式可用命令 `npx tsx server/src/demo/mcp-stdio.ts` 启动。演示技能位于 `server/demo/skills/star-cloud-docs/`。
- **安全提示**：stdio 传输会在服务端启动所配置的命令，Skill 的「允许执行脚本」会在服务端运行技能脚本，请仅用于可信的服务与技能。Skill 的文件读取被限制在技能目录内。
- **得分可比性**：仅检索的接入（如 MCP 直连检索工具、Skill 检索模式）没有答案得分，综合分只由检索与性能加权得出，排行榜中会标注「仅检索」。

## 社区开源评测集

在「测评集」页面可直接导入以下基准。数据通过 Hugging Face datasets-server 的 Parquet 文件按需读取（HTTP Range，只读取所需的列和行），无需下载完整数据集，导入通常只需几秒。

| 评测集 | 来源 | 语言 | 领域 | 类型 | 原始规模（文档 / 问题） |
| --- | --- | --- | --- | --- | --- |
| T2Retrieval | C-MTEB | 中文 | 通用搜索 | 段落检索 | 118,605 / 22,812 |
| DuRetrieval | C-MTEB（百度 DuReader） | 中文 | 通用搜索 | 段落检索 | 100,001 / 2,000 |
| MMarcoRetrieval | C-MTEB（mMARCO 中文） | 中文 | 通用搜索 | 段落检索 | 106,813 / 6,980 |
| CmedqaRetrieval | C-MTEB | 中文 | 医疗 | 段落检索 | 100,001 / 3,999 |
| MedicalRetrieval | C-MTEB | 中文 | 医疗 | 段落检索 | 100,999 / 1,000 |
| CovidRetrieval | C-MTEB | 中文 | 政务 / 公共卫生 | 段落检索 | 100,001 / 949 |
| EcomRetrieval | C-MTEB | 中文 | 电商 | 段落检索 | 100,902 / 1,000 |
| CMRC 2018 | 哈工大讯飞联合实验室 | 中文 | 百科 | 阅读理解问答（含答案） | 848 / 3,219 |
| SciFact / NFCorpus / FiQA-2018 | BEIR | 英文 | 科研 / 医学营养 / 金融 | 段落检索 | 5,183 / 300 等 |
| SQuAD v1.1 | Stanford | 英文 | 百科 | 阅读理解问答（含答案） | 2,067 / 10,570 |
| MultiHop-RAG | HKUST | 英文 | 新闻 | 多跳问答（含答案） | 609 / 2,556 |

- **抽样方式**：随机抽取 N 道问题（默认 100），文档集合 = 这些问题的全部标注相关文档 + M 篇随机干扰文档；相同随机种子得到相同子集，便于复现。干扰文档越多，检索难度越接近真实场景。
- **评测流程**：导入 → 「准备知识库」把文档上传到被测服务（见下节）→ 等待知识库完成解析 → 新建评测任务跑分。「本地 BM25 基线」无需准备即可直接参与对比。
- **命中判定**：上传到知识库的文件名为 `{文档ID}__{标题}.md`，召回片段的来源或 ID 能解析出文档 ID 时按 ID 精确判定；否则退化为按文档标题 / 文件名匹配。
- **网络**：国内网络可在「评分设置 → 社区评测集数据源」改用镜像（如 `https://hf-mirror.com`）。各数据集许可以原始发布方为准，仅限评测研究用途。

## 准备知识库（文档导入）

跑分前需要把测评集的文档集合导入被测知识库。「评测任务」页顶部、测评集详情页、知识库接入卡片上都有单独的「准备知识库 / 准备数据」按钮，打开同一个向导：

1. **选择测评集与知识库**，显示该知识库上次准备的时间与结果。
2. 按知识库类型导入文档：
   - **Dify / RAGFlow / FastGPT**：直接调用各自的知识库文档 API。
   - **Skill：选择一个目录，直接写入**。点击「选择目录」在目录浏览器中选中文件夹（默认是技能的 `references/`），文档以 `{文档ID}__{标题}.md` 直接写进去，Skill 检索与 Agent 读取立即可用。目录不存在时自动创建；再次导入只会删除上一次写入的文件，不影响目录里原有的内容。选择的目录不在技能目录内时会提示 Skill 检索不到。
   - **MCP：由大模型理解接口**。读取 `tools/list` 的工具名、说明和参数 Schema，大模型选出写入文档的工具并生成参数模板（占位符 `{{id}} {{title}} {{fileName}} {{content}} {{markdown}} {{url}}`），如 `add_document(title, content)`，可选一个收尾工具（如触发索引）。方案可在页面上修改，保存在接入配置中，之后每篇文档按模板执行，不会逐篇调用大模型；未配置模型或调用失败时按工具名 / 参数名规则生成。MCP 方案可以先**试传第一篇文档**查看工具返回和耗时。
3. **批量导入**，后台任务显示进度，结果记录在测评集上；新建评测时每个知识库会标出「已准备 / 未准备 / 无需准备」，点击「未准备」可直接打开向导。

无法通过接口写入的服务（如 OpenAI 兼容问答、通用 HTTP）可以选择它背后知识库读取 / 监听的目录直接写入，或下载文档 ZIP 手动导入，或用「生成 Skill 接入」把测评集打包成技能。大模型使用「评分设置 → 默认 Agent 模型」或接入配置里单独填写的模型。内置演示 MCP 知识库提供了 `add_document` / `clear_documents` 工具，可以直接体验完整流程。

## 测评集格式

上传文件导入支持：

- **BEIR / MTEB 目录**：`corpus.jsonl`（`_id` / `title` / `text`）+ `queries.jsonl` + `qrels/*.tsv`（或 TREC 格式 qrels）
- **SQuAD / CMRC JSON**：`data[].paragraphs[].qas[]`，段落作为文档，答案作为参考答案
- **文档 + 问题**：每个 Markdown / TXT / HTML 文件一篇文档（文件名作为 ID，`{id}__{标题}.md` 会被拆分），问题使用下面的 JSON / JSONL / CSV 格式，`relevantDocs` 可写文件名或标题，导入时自动映射为文档 ID
- **本平台导出的 JSON**：`{ "documents": [...], "items": [...] }`

问题格式：

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
- `relevantDocs`：有文档集合时为文档 ID；没有文档集合时填写文件名 / 标题，召回片段的来源或 ID 按完整词匹配该值即判定为相关
- 未提供 `relevantDocs` 时，用 `keywords` 覆盖率（≥50%）判定相关；再退化为参考答案词元覆盖率（≥50%）
- CSV 首行为表头，可用中文表头：`问题,参考答案,相关文档,关键词,标签`，多值用 `|` 或 `;` 分隔

## 扩展新的知识库

在 `server/src/adapters/` 下实现 `AdapterDefinition`（声明配置字段 `fields` 与 `query()`，返回 `{ answer?, contexts[], trace? }`；可选实现 `ingest()` 以支持把测评集文档同步到该知识库），并在 `adapters/index.ts` 中注册，前端表单会根据字段定义自动生成（字段可用 `showIf` 按其它字段取值显示）。需要 LLM 自主调用工具的接入可复用 `server/src/agent.ts` 中的 `runAgent`。

## 目录结构

```
server/   Express + TypeScript：适配器、指标计算、评测执行器、社区评测集导入（server/src/benchmarks）、JSON 持久化
web/      React + Vite + Tailwind + Recharts 前端
```

## 测试

```bash
npm test             # 指标、分词、数据导入、字段映射单元测试；MCP（HTTP / SSE / stdio）、Agent 循环与 Skill 集成测试；评测集文件导入、命中判定、ZIP 导出、BM25 基线与文档同步测试
npm run typecheck
```
