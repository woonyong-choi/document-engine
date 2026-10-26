// markdown-it에 `:::` 블록과 `:이름[글]{속성}` 인라인 표기를 더한다. 정의는 directive-blocks.js에 있다.
// 해석만 한다. HTML을 만들거나 테마를 부르지 않고 이름·라벨·속성·본문 상태를 토큰에 남긴다.
import { BLOCKS, INLINES } from './directive-blocks.js';
import {
  MAX_DEPTH,
  attributeEnd,
  classifyLine,
  parseLabel,
  parseOptions,
  parseTabLine,
  parseTabOptions,
} from './directive-syntax.js';
import { DirectiveError, reportSyntaxError } from './diagnostics.js';
import { findMarkEnd } from './inline-marks.js';
import { reserveId } from './units.js';

// 목록이나 인용 안에서는 닫는 줄의 위치를 들여쓰기로 판단할 수 없어 쓰지 못한다.
const PARENT_TYPES = new Set(['root', 'directive', 'details']);
const KIND_NAMES = {
  paragraph: '문단',
  bullet_list: '목록',
  ordered_list: '순서 목록',
  dl: '정의 목록',
};
const INLINE_START = /^:([a-z]+)\[([^\]\n]+)\]/;
const FENCE_MARKER = /^(`{3,}|~{3,})/;

const lineAt = (state, index) =>
  state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]);
const childKey = (token) =>
  token.type.startsWith('directive')
    ? `directive:${token.meta.name}`
    : token.type.replace(/_open$/, '');
const describe = (key) =>
  key.startsWith('directive:') ? `:::${key.slice(10)}` : (KIND_NAMES[key] ?? key);
const failer =
  (env, line, name) =>
  (message, at = line, who = name) => {
    throw new DirectiveError(message, { page: env.pageId, line: at, name: who });
  };

export function installDirectives(md) {
  md.block.ruler.before('fence', 'directive', directiveBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.inline.ruler.before('emphasis', 'interface-label', directiveInline);
  md.core.ruler.at('inline', parseInlineContent);
}

// 속성 값 검사. 호출자가 확인 함수를 주지 않은 항목은 해석 단계에서 확인하지 않는다(출력 단계가 다시 거부한다).
function checksOf(env) {
  const { assets, icons, urls } = env.context;
  return {
    asset(value) {
      if (!/^[\w.-]+$/.test(value)) return '파일 이름만 쓸 수 있습니다';
      return assets?.exists && !assets.exists(value) ? `없는 자산입니다: ${value}` : '';
    },
    url: (value) =>
      urls?.isSafe && !urls.isSafe(value)
        ? 'https://, mailto:, /로 시작하는 사이트 경로, #만 쓸 수 있습니다'
        : '',
    icon: (value) => (icons?.has && !icons.has(value) ? `없는 아이콘입니다: ${value}` : ''),
  };
}

// `::글::`처럼 같은 줄에서 닫히는 강조로 시작하는 줄은 블록이 아니라 문단이다. 강조 규칙(markdown.js)과 같은 조건을 쓴다.
function isInlineMark(found, text) {
  return found.kind === 'leaf' && found.flat && findMarkEnd(text, 0, '::') > 0;
}

// 다음 비어 있지 않은 줄의 글자. 없으면 빈 문자열이다.
function nextContent(state, from, end) {
  for (let at = from; at < end; at += 1) {
    const text = lineAt(state, at);
    if (text.trim()) return text;
  }
  return '';
}

// tabs와 platform은 공백 옵션이나 다음 @tab 줄로 새 문법을 판별한다.
function isTabsForm(state, at, end, line) {
  if (line.kind !== 'open' || !['tabs', 'platform'].includes(line.name) || line.colons !== 3)
    return false;
  return line.flat || parseTabLine(nextContent(state, at + 1, end)) !== null;
}

const closesFence = (marker, fence, text) =>
  marker &&
  marker[0] === fence[0] &&
  marker.length >= fence.length &&
  text.slice(marker.length).trim() === '';

// 여는 줄에서 닫는 줄을 찾는다. 코드 펜스 안의 줄은 건너뛰고, 열린 블록은 스택으로 짝을 맞춘다.
// 탭 묶음 바로 아래의 @tab 줄 위치도 돌려준다. :::end는 가장 안쪽 블록을 닫는다.
function findClose(state, start, end, opener, fail) {
  const scan = { stack: [{ ...opener, line: start + 1 }], marks: [], fence: null };
  for (let at = start + 1; at < end; at += 1) {
    const result = scanLine(state, at, end, scan, opener, fail);
    if (result) return result;
  }
  const top = scan.stack.at(-1);
  return fail(
    top.closer === 'end'
      ? '닫는 :::end 줄이 없습니다'
      : `닫는 ${':'.repeat(top.colons)} 줄이 없습니다`,
    top.line,
    top.name,
  );
}

function scanLine(state, at, end, scan, opener, fail) {
  const text = lineAt(state, at);
  const marker = FENCE_MARKER.exec(text)?.[1];
  if (scan.fence) {
    if (closesFence(marker, scan.fence, text)) scan.fence = null;
    return undefined;
  }
  if (state.sCount[at] - state.blkIndent >= 4) return undefined;
  if (marker) {
    scan.fence = marker;
    return undefined;
  }
  if (scan.stack.length === 1 && opener.closer === 'end') {
    const tab = parseTabLine(text);
    if (tab) {
      scan.marks.push({ line: at, label: tab.label });
      return undefined;
    }
  }
  const line = classifyLine(text);
  if (line.kind === 'invalid') {
    fail(
      '블록 줄 형식이 잘못되었습니다. :::이름 옵션 또는 닫는 :::end를 쓰세요',
      at + 1,
      line.name,
    );
  }
  if (line.kind === 'open') {
    const closer = isTabsForm(state, at, end, line) ? 'end' : 'bare';
    scan.stack.push({ ...line, closer, line: at + 1 });
    return undefined;
  }
  return closeLine(line, at, scan, fail);
}

function closeLine(line, at, scan, fail) {
  if (line.kind === 'close') {
    const top = scan.stack.at(-1);
    if (top.closer === 'end')
      fail(`${top.line}줄의 :tabs 묶음은 :::end 로 닫아야 합니다`, at + 1, top.name);
    if (line.colons !== top.colons) {
      fail(
        `닫는 줄의 콜론 수(${line.colons})가 ${top.line}줄의 :${top.name} 여는 줄(${top.colons})과 다릅니다`,
        at + 1,
        top.name,
      );
    }
  } else if (line.kind !== 'end') {
    return undefined;
  }
  scan.stack.pop();
  return scan.stack.length ? undefined : { close: at, marks: scan.marks };
}

function saveState(state) {
  const { tokens, level, blkIndent, parentType, lineMax } = state;
  return { count: tokens.length, level, blkIndent, parentType, lineMax };
}

function restoreState(state, saved) {
  state.tokens.length = saved.count;
  Object.assign(state, {
    level: saved.level,
    blkIndent: saved.blkIndent,
    parentType: saved.parentType,
    lineMax: saved.lineMax,
  });
}

function directiveBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const text = lineAt(state, startLine);
  const found = classifyLine(text);
  if (found.kind === 'text' || isInlineMark(found, text)) return false;
  // 문단 바로 다음 줄의 닫는 줄·형식이 틀린 줄도 문단을 끊고 진단한다. 글자로 흡수하지 않는다.
  if (silent) return true;
  const scope = { end: startLine + 1 };
  const saved = saveState(state);
  const depth = state.env.directiveStack?.length ?? 0;
  try {
    return parseDirective(state, startLine, endLine, found, scope);
  } catch (error) {
    if (!(error instanceof DirectiveError)) throw error;
    restoreState(state, saved);
    state.env.directiveStack?.splice(depth);
    return recover(state, startLine, scope, error);
  }
}

// 오류가 난 블록을 진단으로 기록하고 오류 토큰 하나로 바꾼다. 닫는 줄을 못 찾았으면 여는 줄만 소비한다.
function recover(state, startLine, scope, error) {
  reportSyntaxError(state.env, error);
  const token = state.push('directive_error', '', 0);
  token.block = true;
  token.map = [startLine, scope.end];
  token.meta = { message: error.detail, line: error.line, directive: error.directive };
  token.content = state.getLines(startLine, scope.end, state.blkIndent, false);
  state.line = scope.end;
  return true;
}

function parseDirective(state, startLine, endLine, found, scope) {
  const fail = failer(state.env, startLine + 1, found.name);
  if (found.kind === 'end') fail('여는 블록 없이 :::end 가 있습니다');
  if (isTabsForm(state, startLine, endLine, found))
    return tabsBlock(state, startLine, endLine, found, fail, scope);
  if (found.kind === 'close') fail('여는 줄 없이 닫는 줄이 있습니다');
  if (found.kind === 'invalid')
    fail('블록 줄 형식이 잘못되었습니다. :::이름 옵션 또는 닫는 :::end를 쓰세요');
  if (!PARENT_TYPES.has(state.parentType)) fail('목록이나 인용 안에서는 블록을 쓸 수 없습니다');
  const spec = Object.hasOwn(BLOCKS, found.name) ? BLOCKS[found.name] : null;
  if (!spec) fail(`알 수 없는 블록입니다. 사용할 수 있는 이름: ${Object.keys(BLOCKS).join(', ')}`);
  if ((found.kind === 'leaf') !== Boolean(spec.leaf)) {
    fail(
      spec.leaf
        ? '본문이 없는 블록입니다. ::이름 옵션 한 줄로 쓰세요'
        : '본문이 있는 블록입니다. :::이름 … :::end 로 쓰세요',
    );
  }
  const stack = (state.env.directiveStack ??= []);
  const parent = stack.at(-1)?.name ?? 'root';
  if (!spec.leaf && stack.length >= MAX_DEPTH)
    fail(`블록 중첩은 ${MAX_DEPTH}단계까지 쓸 수 있습니다`);
  checkPlace(spec, parent, fail);
  const meta = readMeta(state, found, spec, fail);
  if (spec.leaf) return pushLeaf(state, startLine, meta);
  return pushBlock(state, startLine, endLine, { found, spec, meta, fail, scope });
}

function checkPlace(spec, parent, fail) {
  if (spec.within.includes(parent)) return;
  const here = parent === 'root' ? '문서 바로 아래' : `:::${parent} 안`;
  const allowed = spec.within
    .map((name) => (name === 'root' ? '문서 바로 아래' : `:::${name}`))
    .join(', ');
  fail(`${here}에서는 쓸 수 없습니다. 쓸 수 있는 곳: ${allowed}`);
}

function readMeta(state, found, spec, fail) {
  const label = parseLabel(found.label, fail);
  if (spec.label === 'none' && label !== undefined) fail('라벨을 받지 않는 블록입니다');
  if (spec.label === 'required' && label === undefined)
    fail('라벨이 필요합니다. 예: :::tab[macOS]');
  const attrs = parseOptions(found.source, spec.attrs, fail, checksOf(state.env));
  try {
    spec.check?.(attrs);
  } catch (error) {
    fail(error.message);
  }
  return { name: found.name, label, attrs };
}

function pushLeaf(state, startLine, meta) {
  const token = state.push('directive', '', 0);
  Object.assign(token, { meta, block: true, map: [startLine, startLine + 1] });
  state.line = startLine + 1;
  return true;
}

function pushBlock(state, startLine, endLine, { found, spec, meta, fail, scope }) {
  const { close } = findClose(state, startLine, endLine, { ...found, closer: 'bare' }, fail);
  scope.end = close + 1;
  const open = state.push('directive_open', '', 1);
  Object.assign(open, { meta, block: true, map: [startLine, close] });
  const first = state.tokens.length;
  tokenizeBody(state, startLine + 1, close, found.name);
  const direct = state.tokens
    .slice(first)
    .filter((token) => token.level === open.level + 1 && token.nesting !== -1);
  // 이미 진단으로 기록한 안쪽 오류 블록은 본문 규칙 검사와 의미 준비에서 뺀다. 같은 오류를 다시 보고하지 않는다.
  const children = direct.filter((token) => token.type !== 'directive_error');
  checkBody(spec, children, fail, direct.length > children.length);
  spec.prepare?.(meta, children, { fail, reserveId: (target) => reserveId(state.env, target) });
  Object.assign(state.push('directive_close', '', -1), { meta, block: true });
  state.line = close + 1;
  return true;
}

// 닫는 줄까지의 본문을 일반 블록으로 해석한다. 중첩 깊이와 부모 종류는 끝나면 반드시 되돌린다.
function tokenizeBody(state, from, close, name, tabStops) {
  const stack = state.env.directiveStack;
  const [oldMax, oldParent] = [state.lineMax, state.parentType];
  stack.push({ name });
  state.parentType = 'directive';
  state.lineMax = tabStops?.stop ?? close;
  try {
    state.md.block.tokenize(state, from, tabStops?.stop ?? close);
  } finally {
    state.lineMax = oldMax;
    state.parentType = oldParent;
    stack.pop();
  }
}

function checkBody(spec, children, fail, hasFailedChild) {
  const { only, except, min } = spec.body;
  if (min && !children.length && !hasFailedChild) fail('본문이 비었습니다');
  for (const child of children) {
    const key = childKey(child);
    const line = (child.map?.[0] ?? 0) + 1;
    if (only && !only.includes(key)) {
      fail(
        `여기에는 ${only.map(describe).join(', ')}만 둘 수 있습니다. ${describe(key)}는 쓸 수 없습니다`,
        line,
      );
    }
    if (except?.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
      fail(`여기에는 ${describe(key)}를 둘 수 없습니다`, line);
    }
  }
}

// `@tab` 줄로 나뉜 탭 묶음을 같은 탭 토큰(directive_open/close)으로 바꾼다. 선택 방식과 틀은 meta.options에 둔다.
function tabsBlock(state, startLine, endLine, found, fail, scope) {
  if (!PARENT_TYPES.has(state.parentType)) fail('목록이나 인용 안에서는 블록을 쓸 수 없습니다');
  const stack = (state.env.directiveStack ??= []);
  const parent = stack.at(-1)?.name ?? 'root';
  if (stack.length >= MAX_DEPTH) fail(`블록 중첩은 ${MAX_DEPTH}단계까지 쓸 수 있습니다`);
  if (!BLOCKS[found.name].within.includes(parent)) {
    const here = parent === 'root' ? '문서 바로 아래' : `:::${parent} 안`;
    fail(`${here}에서는 쓸 수 없습니다. 쓸 수 있는 곳: 문서 바로 아래`);
  }
  // 쓰지 않은 옵션은 테마 구성 요소의 기본값이다.
  const options = parseTabOptions(found.source ?? '', fail);
  const { close, marks } = findClose(state, startLine, endLine, { ...found, closer: 'end' }, fail);
  scope.end = close + 1;
  if (!marks.length) fail('@tab 줄이 하나도 없습니다. 예: @tab 변경 전');
  for (let at = startLine + 1; at < marks[0].line; at += 1) {
    if (lineAt(state, at).trim()) fail('첫 @tab 줄 앞에는 본문을 둘 수 없습니다', at + 1);
  }
  const labels = tabLabels(marks, options, fail);
  const meta = {
    name: found.name,
    label: parseLabel(found.label, fail),
    attrs: {},
    options,
    tabs: labels,
    panels: [],
  };
  reserveId(state.env, meta);
  const open = state.push('directive_open', '', 1);
  Object.assign(open, { meta, block: true, map: [startLine, close] });
  pushTabPanels(state, { meta, marks, close, labels, fail });
  Object.assign(state.push('directive_close', '', -1), { meta, block: true });
  state.line = close + 1;
  return true;
}

function tabLabels(marks, options, fail) {
  const numbers = options.selector === 'numbers';
  const seen = new Set();
  return marks.map((mark) => {
    const label =
      mark.label === undefined
        ? undefined
        : parseLabel(mark.label, (message) => fail(message, mark.line + 1));
    if (label === undefined) {
      if (!numbers) {
        fail(
          '@tab 라벨이 필요합니다. 예: @tab 변경 전 (라벨을 생략할 수 있는 것은 numbers뿐입니다)',
          mark.line + 1,
        );
      }
      return undefined;
    }
    if (seen.has(label.toLowerCase())) fail(`탭 이름이 겹칩니다: ${label}`, mark.line + 1);
    seen.add(label.toLowerCase());
    return label;
  });
}

function pushTabPanels(state, { meta, marks, close, labels, fail }) {
  const stack = state.env.directiveStack;
  const [oldMax, oldParent] = [state.lineMax, state.parentType];
  stack.push({ name: meta.name });
  state.parentType = 'directive';
  try {
    marks.forEach((mark, index) => {
      const stop = index + 1 < marks.length ? marks[index + 1].line : close;
      const body = Array.from({ length: stop - mark.line - 1 }, (_, at) =>
        lineAt(state, mark.line + 1 + at),
      );
      if (!body.some((text) => text.trim())) fail('탭 본문이 비었습니다', mark.line + 1);
      const tabMeta = { name: 'tab', label: labels[index], attrs: {}, index };
      meta.panels.push(tabMeta);
      const tabOpen = state.push('directive_open', '', 1);
      Object.assign(tabOpen, { meta: tabMeta, block: true, map: [mark.line, stop] });
      tokenizeBody(state, mark.line + 1, close, 'tab', { stop });
      Object.assign(state.push('directive_close', '', -1), { meta: tabMeta, block: true });
    });
  } finally {
    state.lineMax = oldMax;
    state.parentType = oldParent;
    stack.pop();
  }
}

function directiveInline(state, silent) {
  if (state.src.charCodeAt(state.pos) !== 0x3a) return false;
  const match = INLINE_START.exec(state.src.slice(state.pos));
  if (!match || !Object.hasOwn(INLINES, match[1])) return false;
  const [name, label] = [match[1], match[2]];
  const spec = INLINES[name];
  // 줄은 해석을 감싼 쪽(parseInlineContent)이 오류 위치(offset)에서 센다.
  const fail = (message) => {
    const error = new DirectiveError(message, { page: state.env.pageId, name });
    error.offset = state.pos;
    throw error;
  };
  const checks = checksOf(state.env);
  let end = state.pos + match[0].length;
  let attrs = Object.create(null);
  if (Object.keys(spec.attrs).length) {
    let source = '';
    if (state.src[end] === '{') {
      const close = attributeEnd(state.src, end);
      if (close < 0) fail('{ 속성이 닫히지 않았습니다');
      source = state.src.slice(end + 1, close - 1);
      end = close;
    }
    attrs = parseOptions(source, spec.attrs, fail, checks);
  }
  if (spec.label === 'icon' && checks.icon(label)) fail(checks.icon(label));
  if (!silent) {
    const token = state.push('directive_inline', '', 0);
    token.meta = { name, label, attrs, plainText: label };
    if (name === 'tip') reserveId(state.env, token.meta);
  }
  state.pos = end;
  return true;
}

// 인라인 오류에 줄 번호를 붙이기 위해 기본 inline 규칙을 같은 동작에 오류 기록만 더해 바꾼다.
// 줄은 인라인 토큰의 시작 줄에 오류 위치 앞의 줄바꿈 수를 더한 값이다.
function parseInlineContent(state) {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    try {
      state.md.inline.parse(token.content, state.md, state.env, token.children);
    } catch (error) {
      if (!(error instanceof DirectiveError)) throw error;
      reportSyntaxError(state.env, locateInline(error, token));
      const text = new state.Token('text', '', 0);
      text.content = token.content;
      token.children = [text];
    }
  }
}

function locateInline(error, token) {
  if (error.line || !token.map) return error;
  const before = token.content.slice(0, error.offset ?? 0);
  const breaks = before.split('\n').length - 1;
  return new DirectiveError(error.detail, {
    page: error.page,
    line: token.map[0] + 1 + breaks,
    name: error.directive,
  });
}
