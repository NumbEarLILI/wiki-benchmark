import type { HfSplit } from './hf.js';

export interface BeirSpec {
  format: 'beir';
  corpus: HfSplit;
  queries: HfSplit;
  qrels: HfSplit;
  fields: { docId: string; docTitle?: string; docText: string; queryId: string; queryText: string; qrelQuery: string; qrelDoc: string; qrelScore: string };
}

export interface SquadSpec {
  format: 'squad';
  data: HfSplit;
  splits: string[];
}

export interface MultiHopSpec {
  format: 'multihop-rag';
  queries: HfSplit;
  corpus: HfSplit;
}

export interface BenchmarkEntry {
  id: string;
  name: string;
  org: string;
  lang: 'zh' | 'en';
  domain: string;
  task: '段落检索' | '阅读理解问答' | '多跳问答';
  description: string;
  homepage: string;
  license: string;
  /** 原始规模，导入时按抽样参数截取子集 */
  stats: { documents: number; questions: number };
  hasAnswers: boolean;
  defaults: { queries: number; distractors: number };
  spec: BeirSpec | SquadSpec | MultiHopSpec;
}

const C_MTEB_FIELDS = { docId: 'id', docText: 'text', queryId: 'id', queryText: 'text', qrelQuery: 'qid', qrelDoc: 'pid', qrelScore: 'score' };
const BEIR_FIELDS = { docId: '_id', docTitle: 'title', docText: 'text', queryId: '_id', queryText: 'text', qrelQuery: 'query-id', qrelDoc: 'corpus-id', qrelScore: 'score' };
const C_MTEB_LICENSE = '数据集未标注许可，使用前请查阅原始数据来源';

function cmteb(name: string, domain: string, description: string, stats: BenchmarkEntry['stats']): BenchmarkEntry {
  const ds = `C-MTEB/${name}`;
  return {
    id: `cmteb-${name.toLowerCase()}`,
    name,
    org: 'C-MTEB',
    lang: 'zh',
    domain,
    task: '段落检索',
    description,
    homepage: `https://huggingface.co/datasets/${ds}`,
    license: C_MTEB_LICENSE,
    stats,
    hasAnswers: false,
    defaults: { queries: 100, distractors: 900 },
    spec: {
      format: 'beir',
      corpus: { dataset: ds, config: 'default', split: 'corpus' },
      queries: { dataset: ds, config: 'default', split: 'queries' },
      qrels: { dataset: `${ds}-qrels`, config: 'default', split: 'dev' },
      fields: C_MTEB_FIELDS,
    },
  };
}

function beir(name: string, label: string, domain: string, description: string, stats: BenchmarkEntry['stats']): BenchmarkEntry {
  const ds = `BeIR/${name}`;
  return {
    id: `beir-${name}`,
    name: label,
    org: 'BEIR',
    lang: 'en',
    domain,
    task: '段落检索',
    description,
    homepage: `https://huggingface.co/datasets/${ds}`,
    license: 'CC BY-SA 4.0（以 HF 数据集卡为准）',
    stats,
    hasAnswers: false,
    defaults: { queries: 100, distractors: 900 },
    spec: {
      format: 'beir',
      corpus: { dataset: ds, config: 'corpus', split: 'corpus' },
      queries: { dataset: ds, config: 'queries', split: 'queries' },
      qrels: { dataset: `${ds}-qrels`, config: 'default', split: 'test' },
      fields: BEIR_FIELDS,
    },
  };
}

export const benchmarkCatalog: BenchmarkEntry[] = [
  cmteb('T2Retrieval', '通用搜索', '源自 T2Ranking 的中文段落检索基准，查询来自真实搜索引擎日志，段落来自网页，标注由人工完成。C-MTEB 检索任务之一。', { documents: 118605, questions: 22812 }),
  cmteb('DuRetrieval', '通用搜索', '源自百度 DuReader-retrieval 的中文段落检索基准，查询来自百度搜索，段落来自百度搜索结果网页。', { documents: 100001, questions: 2000 }),
  cmteb('MMarcoRetrieval', '通用搜索', 'MS MARCO 段落检索的中文机器翻译版本（mMARCO），英文检索领域最常用的基准之一。', { documents: 106813, questions: 6980 }),
  cmteb('CmedqaRetrieval', '医疗', '源自中文医疗问答社区 cMedQA 的检索基准，问题为真实患者提问，段落为医生回答。', { documents: 100001, questions: 3999 }),
  cmteb('MedicalRetrieval', '医疗', '阿里巴巴发布的中文医疗段落检索基准，查询来自医疗搜索场景。', { documents: 100999, questions: 1000 }),
  cmteb('CovidRetrieval', '政务 / 公共卫生', '新冠疫情相关的中文政策问答检索基准，段落来自政府公告与新闻。', { documents: 100001, questions: 949 }),
  cmteb('EcomRetrieval', '电商', '阿里巴巴发布的中文电商搜索检索基准，查询为用户搜索词，段落为商品标题。', { documents: 100902, questions: 1000 }),
  {
    id: 'cmrc2018',
    name: 'CMRC 2018',
    org: '哈工大讯飞联合实验室',
    lang: 'zh',
    domain: '百科',
    task: '阅读理解问答',
    description: '第二届中文机器阅读理解评测数据集，基于中文维基百科段落人工标注问题与答案片段。导入后段落作为文档集合，问题附带参考答案。',
    homepage: 'https://huggingface.co/datasets/hfl/cmrc2018',
    license: 'CC BY-SA 4.0',
    stats: { documents: 848, questions: 3219 },
    hasAnswers: true,
    defaults: { queries: 100, distractors: 400 },
    spec: { format: 'squad', data: { dataset: 'hfl/cmrc2018', config: 'default', split: 'validation' }, splits: ['validation', 'train', 'test'] },
  },
  beir('scifact', 'SciFact', '科研', '科学论断核查：给定一条科学论断，检索能支持或反驳它的论文摘要。BEIR 基准之一。', { documents: 5183, questions: 300 }),
  beir('nfcorpus', 'NFCorpus', '医学营养', '医学营养信息检索：查询来自 NutritionFacts 网站，文档为 PubMed 医学论文摘要。BEIR 基准之一。', { documents: 3633, questions: 323 }),
  beir('fiqa', 'FiQA-2018', '金融', '金融领域问答检索：问题来自 StackExchange 与 Reddit 的金融版块，文档为社区回答。BEIR 基准之一。', { documents: 57638, questions: 648 }),
  {
    id: 'squad',
    name: 'SQuAD v1.1',
    org: 'Stanford',
    lang: 'en',
    domain: '百科',
    task: '阅读理解问答',
    description: '斯坦福问答数据集，基于英文维基百科段落众包标注问题与答案片段，阅读理解领域最经典的基准。导入后段落作为文档集合。',
    homepage: 'https://huggingface.co/datasets/rajpurkar/squad',
    license: 'CC BY-SA 4.0',
    stats: { documents: 2067, questions: 10570 },
    hasAnswers: true,
    defaults: { queries: 100, distractors: 400 },
    spec: { format: 'squad', data: { dataset: 'rajpurkar/squad', config: 'plain_text', split: 'validation' }, splits: ['validation', 'train'] },
  },
  {
    id: 'multihop-rag',
    name: 'MultiHop-RAG',
    org: 'HKUST',
    lang: 'en',
    domain: '新闻',
    task: '多跳问答',
    description: '专为 RAG 设计的多跳问答基准（COLM 2024），语料为 2023 年英文新闻，问题需要综合多篇文章的证据作答，含推理、比较、时序等类型。',
    homepage: 'https://huggingface.co/datasets/yixuantt/MultiHopRAG',
    license: 'ODC-BY',
    stats: { documents: 609, questions: 2556 },
    hasAnswers: true,
    defaults: { queries: 100, distractors: 609 },
    spec: {
      format: 'multihop-rag',
      queries: { dataset: 'yixuantt/MultiHopRAG', config: 'MultiHopRAG', split: 'train' },
      corpus: { dataset: 'yixuantt/MultiHopRAG', config: 'corpus', split: 'train' },
    },
  },
];
