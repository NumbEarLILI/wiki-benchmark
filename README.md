# KB Bench · 知识库测评平台

一个用于对比评测不同知识库（RAG）服务的跑分网站。接入多个知识库服务，用同一套测评集与指标体系跑分，输出排行榜、雷达图与逐题诊断。

## 功能

- **知识库接入**：内置 6 类适配器，表单驱动配置，支持在线连通性测试与原始响应查看
  | 类型 | 对接方式 |
  | --- | --- |
  | 内置演示知识库 | 本地 BM25（虚构的「星云云」产品文档），可调噪声与延迟，用于体验流程或作基线 |
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

在 `server/src/adapters/` 下实现 `AdapterDefinition`（声明配置字段 `fields` 与 `query()`，返回 `{ answer?, contexts[] }`），并在 `adapters/index.ts` 中注册，前端表单会根据字段定义自动生成。

## 目录结构

```
server/   Express + TypeScript：适配器、指标计算、评测执行器、JSON 持久化
web/      React + Vite + Tailwind + Recharts 前端
```

## 测试

```bash
npm test             # 指标、分词、数据导入、适配器字段映射等单元测试
npm run typecheck
```
