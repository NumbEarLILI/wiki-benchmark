import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browseDir, skillTree } from '../src/fs-browse.js';
import { executePlan } from '../src/prepare.js';

let tmp = '';
let skill = '';

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-browse-'));
  skill = path.join(tmp, 'skills', 'space-kb');
  fs.mkdirSync(path.join(skill, 'references', 'kb-bench'), { recursive: true });
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'node_modules'));
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: space-kb\ndescription: test\n---\nbody');
  fs.writeFileSync(path.join(skill, 'references', 'a.md'), 'a');
  fs.writeFileSync(path.join(skill, 'references', 'kb-bench', 'old.md'), 'old');
  fs.writeFileSync(path.join(skill, 'scripts', 'add_doc.py'), 'print(1)');
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x');
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('server directory browser', () => {
  it('lists sub directories, marks skills and hides noise', () => {
    const r = browseDir(tmp, { shortcuts: [] });
    expect(r.path).toBe(path.resolve(tmp));
    expect(r.parent).toBe(path.dirname(path.resolve(tmp)));
    expect(r.entries.map((e) => e.name)).toEqual(['skills']);
    const inner = browseDir(path.join(tmp, 'skills'), { shortcuts: [] });
    expect(inner.entries).toEqual([{ name: 'space-kb', path: skill, dir: true, skill: true }]);
    expect(browseDir(skill, { shortcuts: [] }).skill).toBe(true);
  });

  it('includes files on request and falls back to the nearest existing parent', () => {
    expect(browseDir(tmp, { files: true, shortcuts: [] }).entries.map((e) => e.name)).toEqual(['skills', 'notes.txt']);
    expect(browseDir(path.join(tmp, 'missing', 'deeper'), { shortcuts: [] }).path).toBe(path.resolve(tmp));
    expect(browseDir(path.join(tmp, 'notes.txt'), { shortcuts: [] }).path).toBe(path.resolve(tmp));
  });

  it('starts at the first existing shortcut', () => {
    const r = browseDir(undefined, { shortcuts: [{ label: 'gone', path: path.join(tmp, 'nope') }, { label: 'skills', path: skill }] });
    expect(r.shortcuts).toEqual([{ label: 'skills', path: skill }]);
    expect(r.path.startsWith(path.resolve(tmp))).toBe(true);
  });
});

describe('skill tree', () => {
  it('lists folders and scripts relative to the skill root, without generated docs', () => {
    const t = skillTree(skill);
    expect(t.root).toBe(skill);
    expect(t.dirs).toEqual(['references', 'scripts']);
    expect(t.scripts).toEqual(['scripts/add_doc.py']);
    expect(t.skills[0].name).toBe('space-kb');
  });

  it('can write documents into the skill root when chosen', async () => {
    const r = await executePlan('skill', { skillPath: skill }, { kind: 'skill-files', dir: '', reasoning: '', source: 'manual' }, [{ id: 'D1', title: 'Doc', content: 'hello' }], { fresh: true });
    expect(r.uploaded).toBe(1);
    expect(fs.readdirSync(path.join(skill, 'kb-bench'))).toEqual(['D1__Doc.md']);
  });
});
