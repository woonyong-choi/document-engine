import { LineCounter, parseDocument as parseYamlDocument } from 'yaml';

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

// 필드 형식. text는 글(문자열·숫자·참거짓·null), items는 객체 목록, texts는 글 목록이다.
// 명세에 없는 필드는 검사하지 않는다(구성 요소 출력이 읽지 않는다).
const TEXT = 'text';
const items = (fields = {}, required = false) => ({ type: 'items', fields, required });
const ITEM_BODY = { body: TEXT };

/**
 * ui: 구성 요소 명세. fields는 해석 단계에서 검사하는 필드 형식, bodies는 안쪽 Markdown 필드 목록이다.
 * inline 필드는 문단 없이 한 줄 안에서 해석한다.
 */
const UI_KINDS = Object.freeze({
  __proto__: null,
  group: { fields: { title: TEXT, body: TEXT }, bodies: () => [{ path: 'body' }] },
  feature: {
    fields: {
      icon: TEXT,
      title: TEXT,
      description: TEXT,
      href: TEXT,
      link: TEXT,
      tone: TEXT,
      body: TEXT,
      left: TEXT,
      right: TEXT,
      leftTitle: TEXT,
      rightTitle: TEXT,
    },
    bodies: () => [{ path: 'body' }],
  },
  'syntax-examples': { fields: { items: items(ITEM_BODY, true) }, bodies: itemBodies },
  'feature-list': { fields: { items: items(ITEM_BODY, true) }, bodies: itemBodies },
  device: { fields: { src: TEXT, poster: TEXT, title: TEXT }, bodies: () => [] },
  demos: {
    fields: { items: items({ ...ITEM_BODY, title: TEXT, src: TEXT }, true), after: TEXT },
    bodies: (data) => [...itemBodies(data), ...(data.after ? [{ path: 'after' }] : [])],
  },
  'feature-pair': {
    fields: { items: items(ITEM_BODY, true), media: TEXT },
    bodies: (data) => [...itemBodies(data), { path: 'media' }],
  },
  callout: { fields: { title: TEXT, tone: TEXT, body: TEXT }, bodies: () => [{ path: 'body' }] },
  details: { fields: { title: TEXT, body: TEXT }, bodies: () => [{ path: 'body' }] },
  figure: { fields: {}, bodies: () => [] },
  fineprint: {
    fields: { body: TEXT },
    bodies: () => [{ path: 'body', inline: true, nullAsEmpty: true }],
  },
  'figure-grid': { fields: { items: items() }, bodies: () => [] },
  video: { fields: { src: TEXT, poster: TEXT, title: TEXT, caption: TEXT }, bodies: () => [] },
  gallery: { fields: { title: TEXT, slides: items() }, bodies: () => [] },
  cards: { fields: { variant: TEXT, items: items({}, true) }, bodies: () => [] },
  definitions: {
    fields: { items: items({ ...ITEM_BODY, term: TEXT }, true) },
    bodies: itemBodies,
  },
  speech: { fields: { body: TEXT }, bodies: () => [] },
  keys: { fields: { label: TEXT, keys: { type: 'texts', required: true } }, bodies: () => [] },
  tooltip: { fields: { label: TEXT, description: TEXT }, bodies: () => [{ path: 'description' }] },
});

const isText = (value) => value === null || typeof value !== 'object';
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// 명세대로 데이터를 검사한다. 틀린 필드는 그 필드의 경로와 함께 fail(message, path)로 알린다.
function checkFields(data, fields, fail, prefix = '') {
  for (const [key, rule] of Object.entries(fields)) {
    const path = `${prefix}${key}`;
    const value = data[key];
    if (value === undefined) {
      if (rule.required) fail(`필수 필드가 없습니다: ${path}`);
    } else if (rule === TEXT) {
      if (!isText(value)) fail(`${path}: 글이어야 합니다`, path);
    } else {
      checkList(value, rule, fail, path);
    }
  }
}

function checkList(value, rule, fail, path) {
  const texts = rule.type === 'texts';
  if (!Array.isArray(value)) fail(`${path}: ${texts ? '글 목록' : '항목 목록'}이어야 합니다`, path);
  value.forEach((item, index) => {
    const at = `${path}.${index}`;
    if (texts) {
      if (!isText(item)) fail(`${at}: 글이어야 합니다`, at);
      return;
    }
    if (!isRecord(item)) fail(`${at}: 항목(이름: 값 묶음)이어야 합니다`, at);
    checkFields(item, rule.fields, fail, `${at}.`);
  });
}

export function installFences(md) {
  md.core.ruler.push('fence-semantics', fenceSemantics);
}

/** `a.items.0.body` 같은 경로로 구성 요소 데이터의 값을 읽는다. */
function valueAt(data, path) {
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
  if (/^diagramplay(?:\s|$)/.test(kind)) {
    if (env.context.features?.diagrams === false) {
      fail(
        'DiagramPlay 도표가 꺼져 있습니다. 호스트 설정의 features.diagrams를 켜야 쓸 수 있습니다',
        'diagramplay',
      );
    }
    const checks = { vocabulary: env.context.vocabulary };
    const options = parseOptions(optionSource, DIAGRAM_ATTRIBUTES, fail, checks);
    if (options.name !== undefined && !BLOCK_NAME.test(options.name)) {
      fail('name은 영문 소문자·숫자와 가운데 하이픈(-)만 쓸 수 있습니다 (예: name=flow-1)');
    }
    recordDiagram(env, token, options);
    return { role: 'diagram', options };
  }
  if (kind.startsWith('ui:')) return classifyComponent(state, token, kind, fail);
  const options = parseOptions(optionSource, CODE_ATTRIBUTES, fail, {
    vocabulary: env.context.vocabulary,
  });
  return { role: 'code', options };
}

// 같은 원문은 한 번만 만든다. 도표 생성은 렌더러 밖의 worker가 맡으므로 원문과 줄만 모은다.
function recordDiagram(env, token, options) {
  if (env.diagrams.some((diagram) => diagram.source === token.content)) return;
  env.diagrams.push({ source: token.content, line: fenceLine(env, token), width: options.width });
}

function classifyComponent(state, token, kind, fail) {
  const name = kind.slice(3);
  const where = `ui:${name}`;
  const start = (token.map?.[0] ?? 0) + 1;
  const { data, lineOf } = readComponentData(token, kind, (message, line) =>
    fail(message, where, line === undefined ? undefined : start + line),
  );
  if (!Object.hasOwn(UI_KINDS, name)) fail(`Unknown document component: ${name}`, where);
  const spec = UI_KINDS[name];
  checkFields(data, spec.fields, (message, path) => {
    const line = path === undefined ? undefined : lineOf(path);
    fail(message, where, line === undefined ? start : start + line);
  });
  const units = spec.bodies(data).map((field) => parseField(state, token, data, field));
  return { role: 'ui', kind: name, data, units };
}

// YAML을 읽어 데이터와 필드 경로의 줄(펜스 안 1부터)을 돌려준다. 실패는 fail(message, 펜스 안 줄)로 알린다.
function readComponentData(token, kind, fail) {
  const lineCounter = new LineCounter();
  const document = parseYamlDocument(token.content, { lineCounter, maxAliasCount: 0 });
  const [error] = document.errors;
  if (error) {
    const first = error.message.split('\n')[0];
    return fail(`${kind} 데이터를 읽을 수 없습니다: ${first}`, error.linePos?.[0]?.line);
  }
  let data;
  try {
    data = document.toJS({ maxAliasCount: 0 });
  } catch (failure) {
    return fail(`${kind} 데이터를 읽을 수 없습니다: ${failure.message.split('\n')[0]}`);
  }
  if (!data || typeof data !== 'object') fail(`Invalid ${kind} data`);
  const lineOf = (path) => {
    const node = document.getIn(path.split('.'), true);
    return node?.range ? lineCounter.linePos(node.range[0]).line : undefined;
  };
  return { data, lineOf };
}

// 안쪽 Markdown 필드를 같은 해석기로 해석해 { path, tokens, env } 단위로 보존한다.
// 값이 없으면 빈 글이다. null은 nullAsEmpty 필드(fineprint)만 빈 글로 보고 나머지는 원본처럼 글자 그대로 둔다.
function parseField(state, token, data, { path, inline = false, nullAsEmpty = false }) {
  const raw = valueAt(data, path);
  const text = raw === undefined || (nullAsEmpty && raw === null) ? '' : String(raw);
  const nested = createEnv(state.env.context, state.env, {
    fenceLine: fenceLine(state.env, token),
  });
  const tokens = inline ? state.md.parseInline(text, nested) : state.md.parse(text, nested);
  return { path, inline, tokens, env: nested };
}
