import { parse as parseYaml } from 'yaml';

import { DirectiveError, reportSyntaxError } from './diagnostics.js';
import { WIDTH_OPTION, parseOptions } from './directive-syntax.js';
import { createEnv } from './units.js';

const CODE_ATTRIBUTES = Object.freeze({ width: WIDTH_OPTION, filename: { type: 'text' } });
const BLOCK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIAGRAM_ATTRIBUTES = Object.freeze({ width: WIDTH_OPTION, name: { type: 'text' } });

// 항목 목록 안의 Markdown 필드. 필드 순서는 구성 요소가 본문을 그리는 순서이며 구성 요소 번호와 각주 ID가 이 순서를 따른다.
const itemBodies = (data, field = 'body') =>
  Array.isArray(data.items)
    ? data.items.map((_, index) => ({ path: `items.${index}.${field}` }))
    : [];

/**
 * ui: 구성 요소의 이름과 안쪽 Markdown 필드. 필드가 없는 구성 요소는 빈 목록이다.
 * inline 필드는 문단 없이 한 줄 안에서 해석한다.
 */
export const UI_KINDS = Object.freeze({
  __proto__: null,
  group: () => [{ path: 'body' }],
  feature: () => [{ path: 'body' }],
  'syntax-examples': (data) => itemBodies(data),
  'feature-list': (data) => itemBodies(data),
  device: () => [],
  demos: (data) => [...itemBodies(data), ...(data.after ? [{ path: 'after' }] : [])],
  'feature-pair': (data) => [...itemBodies(data), { path: 'media' }],
  callout: () => [{ path: 'body' }],
  details: () => [{ path: 'body' }],
  figure: () => [],
  fineprint: () => [{ path: 'body', inline: true, nullAsEmpty: true }],
  'figure-grid': () => [],
  video: () => [],
  gallery: () => [],
  platform: (data) => itemBodies(data),
  tabs: (data) => itemBodies(data),
  cards: () => [],
  definitions: (data) => itemBodies(data),
  speech: () => [],
  keys: () => [],
  tooltip: () => [{ path: 'description' }],
});

export function installFences(md) {
  md.core.ruler.push('fence-semantics', fenceSemantics);
}

/** `a.items.0.body` 같은 경로로 구성 요소 데이터의 값을 읽는다. */
export function valueAt(data, path) {
  return path.split('.').reduce((value, key) => value?.[key], data);
}

function fenceSemantics(state) {
  for (const token of state.tokens) {
    if (token.type !== 'fence') continue;
    try {
      token.meta = classifyFence(state, token);
    } catch (error) {
      if (!(error instanceof DirectiveError)) throw error;
      reportSyntaxError(state.env, error);
      token.meta = { role: 'error', message: error.detail };
    }
  }
}

const fenceLine = (env, token) => env.fenceLine ?? (token.map?.[0] ?? 0) + 1;

function classifyFence(state, token) {
  const kind = token.info.trim();
  const { env } = state;
  const fail = (message, name = 'code', line = (token.map?.[0] ?? 0) + 1) => {
    throw new DirectiveError(message, { page: env.pageId, line, name });
  };
  const optionSource = kind.replace(/^\S+\s*/, '');
  if (/^(?:diagramplay|thinkflow|torso)(?:\s|$)/.test(kind)) {
    const options = parseOptions(optionSource, DIAGRAM_ATTRIBUTES, fail);
    if (options.name !== undefined && !BLOCK_NAME.test(options.name)) {
      fail('name은 영문 소문자·숫자와 가운데 하이픈(-)만 쓸 수 있습니다 (예: name=flow-1)');
    }
    recordDiagram(env, token, options);
    return { role: 'diagram', options };
  }
  if (kind.startsWith('ui:')) return classifyComponent(state, token, kind, fail);
  return { role: 'code', options: parseOptions(optionSource, CODE_ATTRIBUTES, fail) };
}

// 같은 원문은 한 번만 만든다. 도표 생성은 렌더러 밖의 worker가 맡으므로 원문과 줄만 모은다.
function recordDiagram(env, token, options) {
  if (env.diagrams.some((diagram) => diagram.source === token.content)) return;
  env.diagrams.push({ source: token.content, line: fenceLine(env, token), width: options.width });
}

function classifyComponent(state, token, kind, fail) {
  const name = kind.slice(3);
  const where = `ui:${name}`;
  const data = readComponentData(token, kind, (message, line) => fail(message, where, line));
  if (!Object.hasOwn(UI_KINDS, name)) fail(`Unknown document component: ${name}`, where);
  const units = UI_KINDS[name](data).map((field) => parseField(state, token, data, field));
  return { role: 'ui', kind: name, data, units };
}

function readComponentData(token, kind, fail) {
  let data;
  try {
    data = parseYaml(token.content, { maxAliasCount: 0 });
  } catch (error) {
    const first = error.message.split('\n')[0];
    const line = error.linePos?.[0]?.line;
    return fail(
      `${kind} 데이터를 읽을 수 없습니다: ${first}`,
      line ? (token.map?.[0] ?? 0) + 1 + line : undefined,
    );
  }
  if (!data || typeof data !== 'object') fail(`Invalid ${kind} data`);
  return data;
}

// 안쪽 Markdown 필드를 같은 해석기로 해석해 { path, tokens, env } 단위로 보존한다.
// 값이 없으면 빈 글이다. null은 nullAsEmpty 필드(fineprint)만 빈 글로 보고 나머지는 원본처럼 글자 그대로 둔다.
function parseField(state, token, data, { path, inline = false, nullAsEmpty = false }) {
  const raw = valueAt(data, path);
  const text = raw === undefined || (nullAsEmpty && raw === null) ? '' : String(raw);
  const nested = createEnv(state.env.context, state.env, {
    fenceLine: fenceLine(state.env, token),
  });
  nested.inlineOnly = inline;
  const tokens = inline ? state.md.parseInline(text, nested) : state.md.parse(text, nested);
  return { path, inline, tokens, env: nested };
}
