import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateRetrieval, matchesDocId, matchesDocName } from '../src/metrics.js';
import { importFiles } from '../src/benchmarks/files.js';
import { benchmarkCatalog } from '../src/benchmarks/catalog.js';
import { cleanText, seededRandom, shuffle } from '../src/benchmarks/hf.js';
import { docAliases, docFileName, skillFiles } from '../src/corpus.js';
import { createZip } from '../src/zip.js';
import { localBm25Adapter } from '../src/adapters/local-bm25.js';
import { difyAdapter } from '../src/adapters/dify.js';
import { ragflowAdapter } from '../src/adapters/ragflow.js';
import { fastgptAdapter } from '../src/adapters/fastgpt.js';
import { skillAdapter } from '../src/adapters/skill.js';
import type { Dataset, DatasetDocument } from '../src/types.js';

const docs: DatasetDocument[] = [
  { id: '1001', title: 'Refund policy', content: 'Annual plans can be refunded within 7 days of purchase. Pay-as-you-go resources are not refundable.' },
  { id: '1002', title: 'Invoice guide', content: 'VAT invoices are issued from the billing center. Vouchers cannot be invoiced.' },
  { id: '10021', title: 'Backup', content: 'Snapshots are kept for 7 days by default and up to 730 days.' },
];

describe('relevance matching', () => {
  it('matches doc ids exactly or by file-name prefix', () => {
    expect(matchesDocId({ content: '', source: '1002__Invoice guide.md' }, '1002')).toBe(true);
    expect(matchesDocId({ content: '', id: '1002#3' }, '1002')).toBe(true);
    expect(matchesDocId({ content: '', source: '10021__Backup.md' }, '1002')).toBe(false);
    expect(matchesDocId({ content: '', source: 'kb/1002.txt' }, '1002')).toBe(true);
  });
  it('matches names on word boundaries', () => {
    expect(matchesDocName({ content: '', source: '退款政策.md' }, '退款政策')).toBe(true);
    expect(matchesDocName({ content: '', source: 'Refund policy v2.pdf' }, 'refund policy')).toBe(true);
    expect(matchesDocName({ content: '', source: 'MED-100' }, 'MED-10')).toBe(false);
  });
  it('uses dataset aliases so titles returned by a KB count as hits', () => {
    const item = { id: 'q', question: 'q', relevantDocs: ['1001'] };
    const r = evaluateRetrieval(item, [{ content: '', source: 'Invoice guide.md' }, { content: '', source: 'Refund policy.md' }], 5, docAliases(docs))!;
    expect(r.flags).toEqual([false, true]);
    expect(r.metrics.mrr).toBe(0.5);
  });
});

describe('file import', () => {
  it('reads BEIR corpus / queries / qrels', () => {
    const r = importFiles([
      { name: 'corpus.jsonl', content: docs.map((d) => JSON.stringify({ _id: d.id, title: d.title, text: d.content })).join('\n') },
      { name: 'queries.jsonl', content: '{"_id":"q1","text":"can I get a refund"}\n{"_id":"q2","text":"invoice"}' },
      { name: 'qrels/test.tsv', content: 'query-id\tcorpus-id\tscore\nq1\t1001\t1\nq2\t1002\t1\nq2\t10021\t0' },
    ]);
    expect(r.documents).toHaveLength(3);
    expect(r.items).toEqual([
      { id: 'q-q1', question: 'can I get a refund', relevantDocs: ['1001'] },
      { id: 'q-q2', question: 'invoice', relevantDocs: ['1002'] },
    ]);
  });
  it('reads SQuAD-style json', () => {
    const squad = { data: [{ title: 'Cloud', paragraphs: [{ context: 'Refunds take 3 days.', qas: [{ id: 'a', question: 'How long?', answers: [{ text: '3 days' }] }] }] }] };
    const r = importFiles([{ name: 'dev.json', content: JSON.stringify(squad) }]);
    expect(r.documents[0]).toMatchObject({ title: 'Cloud #1', content: 'Refunds take 3 days.' });
    expect(r.items[0]).toMatchObject({ question: 'How long?', referenceAnswer: '3 days', relevantDocs: [r.documents[0].id] });
  });
  it('maps question csv titles to markdown documents', () => {
    const r = importFiles([
      { name: '退款政策.md', content: '# 退款政策\n\n7天内可退款' },
      { name: 'doc-9__发票指南.md', content: '专票需要税号' },
      { name: 'questions.csv', content: 'question,answer,relevant_docs\n多久能退款,7天,退款政策\n专票要什么,税号,发票指南.md' },
    ]);
    expect(r.documents.map((d) => d.id)).toEqual(['退款政策', 'doc-9']);
    expect(r.items.map((i) => i.relevantDocs)).toEqual([['退款政策'], ['doc-9']]);
  });
  it('round-trips the native export format', () => {
    const r = importFiles([{ name: 'x.json', content: JSON.stringify({ name: 'x', documents: docs, items: [{ question: 'q', relevantDocs: ['Backup'] }] }) }]);
    expect(r.documents).toHaveLength(3);
    expect(r.items[0].relevantDocs).toEqual(['10021']);
  });
});

describe('benchmark helpers', () => {
  it('has a well-formed catalog', () => {
    expect(new Set(benchmarkCatalog.map((b) => b.id)).size).toBe(benchmarkCatalog.length);
    for (const b of benchmarkCatalog) expect(b.homepage).toMatch(/^https:\/\/huggingface\.co\/datasets\//);
    expect(benchmarkCatalog.filter((b) => b.lang === 'zh').length).toBeGreaterThanOrEqual(8);
  });
  it('samples deterministically and cleans html', () => {
    expect(shuffle([1, 2, 3, 4, 5, 6], seededRandom(42))).toEqual(shuffle([1, 2, 3, 4, 5, 6], seededRandom(42)));
    expect(cleanText('a<br>b <img src="x"/>c&amp;d')).toBe('a\nb c&d');
  });
});

describe('corpus export', () => {
  const ds: Dataset = { id: 'ds_1', name: 'Demo', items: [], documents: docs, createdAt: '', updatedAt: '' };
  it('builds a valid zip with utf-8 names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
    const file = path.join(dir, 'a.zip');
    fs.writeFileSync(file, createZip([{ name: 'kb/文档.md', content: '你好' }, ...docs.map((d) => ({ name: docFileName(d), content: d.content }))]));
    const listing = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("\\n".join(z.namelist()));print(z.read("kb/文档.md").decode())', file]).toString();
    expect(listing).toContain('kb/文档.md');
    expect(listing).toContain('1001__Refund policy.md');
    expect(listing).toContain('你好');
  });
  it('generates a skill that the skill adapter can search', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
    for (const f of skillFiles(ds)) {
      fs.mkdirSync(path.dirname(path.join(root, f.name)), { recursive: true });
      fs.writeFileSync(path.join(root, f.name), f.content);
    }
    const r = await skillAdapter.query({ skillPath: root, mode: 'retrieval' }, 'refund within 7 days', { topK: 3 });
    const hit = evaluateRetrieval({ id: 'q', question: '', relevantDocs: ['1001'] }, r.contexts, 3, docAliases(docs))!;
    expect(hit.metrics.hit).toBe(1);
  });
});

describe('local BM25 baseline', () => {
  it('retrieves from the dataset corpus and reports doc ids', async () => {
    const r = await localBm25Adapter.query({}, 'which vouchers cannot be invoiced', { topK: 2, documents: docs, corpusKey: 't1' });
    expect(r.contexts[0].source).toBe('1002__Invoice guide.md');
    expect(r.answer).toContain('Vouchers');
  });
  it('falls back to the demo corpus', async () => {
    const r = await localBm25Adapter.query({ answerMode: 'none' }, '包年包月多久可以退款', { topK: 1 });
    expect(r.contexts[0].source).toMatch(/^doc-refund__/);
    expect(r.answer).toBeUndefined();
  });
});

describe('ingest', () => {
  const calls: { url: string; auth?: string; body: string; type?: string }[] = [];
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        calls.push({ url: req.url!, auth: req.headers.authorization, body: b, type: req.headers['content-type'] });
        res.setHeader('Content-Type', 'application/json');
        if (req.url!.includes('fail')) return res.writeHead(500).end('{"message":"boom"}');
        if (req.url!.endsWith('/documents')) return res.end(JSON.stringify({ code: 0, data: (b.match(/filename="/g) ?? []).map((_, i) => ({ id: `d${i}` })) }));
        if (req.url!.includes('/collection/create/text')) return res.end('{"code":200,"data":{}}');
        res.end('{"code":0,"data":{}}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => server.close());

  it('uploads to Dify with the dataset key', async () => {
    calls.length = 0;
    const progress: number[] = [];
    const r = await difyAdapter.ingest!({ baseUrl: base, mode: 'chat', apiKey: 'app', datasetApiKey: 'dk', datasetId: 'D1' }, docs, { onProgress: (d) => progress.push(d) });
    expect(r).toEqual({ uploaded: 3, failed: 0, errors: [] });
    expect(calls[0].url).toBe('/datasets/D1/document/create-by-text');
    expect(calls[0].auth).toBe('Bearer dk');
    expect(JSON.parse(calls.find((c) => c.body.includes('1001__'))!.body).name).toBe('1001__Refund policy.md');
    expect(progress.at(-1)).toBe(3);
  });
  it('uploads to RAGFlow as multipart and starts parsing', async () => {
    calls.length = 0;
    const r = await ragflowAdapter.ingest!({ baseUrl: base, apiKey: 'rk', datasetIds: 'R1,R2' }, docs, {});
    expect(r.uploaded).toBe(3);
    expect(calls[0].url).toBe('/api/v1/datasets/R1/documents');
    expect(calls[0].type).toMatch(/multipart\/form-data/);
    expect(calls[1]).toMatchObject({ url: '/api/v1/datasets/R1/chunks', body: '{"document_ids":["d0","d1","d2"]}' });
  });
  it('uploads to FastGPT and reports failures', async () => {
    const ok = await fastgptAdapter.ingest!({ baseUrl: base, mode: 'search', apiKey: 'fk', datasetId: 'F1' }, docs, {});
    expect(ok.uploaded).toBe(3);
    const bad = await fastgptAdapter.ingest!({ baseUrl: `${base}/fail`, mode: 'search', apiKey: 'fk', datasetId: 'F1' }, docs.slice(0, 1), {});
    expect(bad).toMatchObject({ uploaded: 0, failed: 1 });
    expect(bad.errors[0]).toContain('HTTP 500');
    await expect(fastgptAdapter.ingest!({ baseUrl: base, mode: 'chat', apiKey: 'app', datasetId: 'F1' }, docs, {})).rejects.toThrow(/OpenAPI Key/);
  });
});
