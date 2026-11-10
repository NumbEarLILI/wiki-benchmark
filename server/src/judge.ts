import type { DatasetItem, JudgeSettings, RetrievedContext } from './types.js';
import { requestJson, trimSlash } from './adapters/http.js';

export interface JudgeResult {
  correctness: number;
  faithfulness?: number;
  reason: string;
}

const SYSTEM = `你是一名严格、公正的知识库问答评测员。请根据【问题】【参考答案】【关键要点】评估【待评答案】，并根据【召回片段】评估答案是否忠实于检索内容。
评分规则（0-10 的整数）：
- correctness：答案与参考答案在事实上的一致程度与完整度。答非所问、事实错误给 0-3；部分正确给 4-7；完全正确且覆盖要点给 8-10。
- faithfulness：答案中的陈述能否在召回片段中找到依据。若没有召回片段，返回 null。
只输出 JSON：{"correctness": number, "faithfulness": number|null, "reason": "不超过60字的中文理由"}`;

function clamp01(n: unknown): number | undefined {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.min(1, Math.max(0, v / 10));
}

export async function judgeAnswer(
  settings: JudgeSettings,
  item: DatasetItem,
  answer: string,
  contexts: RetrievedContext[],
  signal?: AbortSignal,
): Promise<JudgeResult> {
  const ctxText = contexts.length
    ? contexts.map((c, i) => `[${i + 1}] ${c.content.slice(0, 800)}`).join('\n')
    : '（无）';
  const user = [
    `【问题】${item.question}`,
    `【参考答案】${item.referenceAnswer || '（未提供）'}`,
    `【关键要点】${item.keywords?.join('；') || '（未提供）'}`,
    `【召回片段】\n${ctxText}`,
    `【待评答案】${answer || '（空）'}`,
  ].join('\n\n');

  const data = await requestJson(`${trimSlash(settings.baseUrl)}/chat/completions`, {
    signal,
    headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
    body: {
      model: settings.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    },
  });
  const content: string = data.choices?.[0]?.message?.content ?? '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`裁判模型输出无法解析: ${content.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]);
  const correctness = clamp01(parsed.correctness);
  if (correctness === undefined) throw new Error('裁判模型未给出 correctness');
  return {
    correctness,
    faithfulness: contexts.length ? clamp01(parsed.faithfulness) : undefined,
    reason: String(parsed.reason ?? ''),
  };
}
