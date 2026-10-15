// markdown-it에 문서 문법을 설치한다. 문법 규칙과 의미 토큰만 만들고 HTML 출력 규칙은 설치하지 않는다.
// 출력 규칙은 renderer/markdown-rules.js가 같은 토큰 이름으로 설치한다.
import mathPlugin from '@vscode/markdown-it-katex';
import MarkdownIt from 'markdown-it';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';

import { installDirectives } from './directives.js';
import { installFences } from './ui-fences.js';

const BACKSLASH = String.fromCharCode(92);
const FENCE_MARKER = /^(`{3,}|~{3,})/;
const DETAILS_OPEN = /^<details(\s+open)?>\s*$/i;
const DETAILS_SUMMARY = /^<summary>([^<>\n]+)<\/summary>\s*$/i;
const DETAILS_CLOSE = /^<\/details>\s*$/i;
const TASK_MARKERS = Object.freeze([
  ['[ ] ', 'todo'],
  ['[x] ', 'done'],
  ['[X] ', 'done'],
  ['[~] ', 'cancelled'],
]);

/** @returns {MarkdownIt} 문서 문법을 설치한 해석기. 문서마다 env를 달리해 재사용한다. */
export function createParser() {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
    .use(footnote)
    .use(deflist)
    .use(mathPlugin.default ?? mathPlugin);
  installDirectives(md);
  md.inline.ruler.before('emphasis', 'highlight', markRule('::'));
  md.inline.ruler.before('emphasis', 'equals-highlight', markRule('=='));
  md.inline.ruler.before('emphasis', 'subscript', scriptRule('~', 'sub'));
  md.inline.ruler.before('emphasis', 'superscript', scriptRule('^', 'sup'));
  md.block.ruler.before('html_block', 'details', detailsBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.after('inline', 'task-items', taskItems);
  md.core.ruler.after('inline', 'standalone-figure', standaloneFigure);
  installFences(md);
  return md;
}

// 닫는 표식의 위치. 역슬래시로 이스케이프한 표식은 건너뛴다. 없으면 -1이다.
function findClosingMarker(src, from, marker) {
  let end = from;
  while ((end = src.indexOf(marker, end)) !== -1) {
    let escapes = 0;
    for (let at = end - 1; at >= 0 && src[at] === BACKSLASH; at -= 1) escapes += 1;
    if (escapes % 2 === 0) return end;
    end += marker.length;
  }
  return -1;
}

// 같은 낱말 표식 `::강조::`, `==강조==`로 mark를 만든다. 공백으로 시작하거나 끝나는 표식은 글자 그대로 둔다.
function markRule(marker) {
  return (state, silent) => {
    const start = state.pos;
    const first = state.src[start + marker.length] ?? ' ';
    if (
      state.src.slice(start, start + marker.length) !== marker ||
      /\s/.test(first) ||
      first === marker[0]
    ) {
      return false;
    }
    const end = findClosingMarker(state.src, start + marker.length, marker);
    if (
      end < 0 ||
      /\s/.test(state.src[end - 1]) ||
      state.src.slice(start + marker.length, end).includes('\n')
    ) {
      return false;
    }
    if (!silent)
      pushWrapped(state, 'mark_open', 'mark', state.src.slice(start + marker.length, end));
    state.pos = end + marker.length;
    return true;
  };
}

// 열기 토큰, 안쪽 인라인, 닫기 토큰을 차례로 밀어 넣는다. 안쪽 글은 인라인 규칙으로 다시 해석한다.
function pushWrapped(state, openType, tag, inner) {
  state.push(openType, tag, 1);
  const children = [];
  state.md.inline.parse(inner, state.md, state.env, children);
  state.tokens.push(...children);
  state.push(openType.replace(/_open$/, '_close'), tag, -1);
}

// `H~2~O`, `x^2^`: 공백 없는 짧은 낱말만 아래·위 첨자로 만든다. `~~취소선~~`과 `^[각주]`는 건드리지 않는다.
function scriptRule(marker, tag) {
  return (state, silent) => {
    const { src, pos: start } = state;
    if (src[start] !== marker || src[start + 1] === marker || src[start + 1] === '[') return false;
    let end = start + 1;
    while (end < src.length && src[end] !== marker) {
      if (/\s/.test(src[end])) return false;
      end += src[end] === BACKSLASH ? 2 : 1;
    }
    if (end >= src.length || end === start + 1) return false;
    if (!silent) pushWrapped(state, `${tag}_open`, tag, src.slice(start + 1, end));
    state.pos = end + 1;
    return true;
  };
}

const textOf = (state, index) =>
  state.src.slice(state.bMarks[index] + state.tShift[index], state.eMarks[index]);

// `<details>`의 열림과 닫힘 줄 사이를 찾는다. 코드 펜스와 들여쓴 코드 안의 줄은 건너뛴다. 못 찾으면 endLine을 돌려준다.
function findDetailsClose(state, startLine, endLine) {
  const scan = { depth: 1, fence: null };
  for (let close = startLine + 1; close < endLine; close += 1) {
    if (scanDetailsLine(state, close, scan)) return close;
  }
  return endLine;
}

// 한 줄을 검사해 짝이 맞는 닫는 줄이면 true다. 펜스 상태와 중첩 깊이는 scan에 이어 둔다.
function scanDetailsLine(state, line, scan) {
  const text = textOf(state, line);
  const indented = state.sCount[line] - state.blkIndent >= 4;
  const marker = indented ? undefined : FENCE_MARKER.exec(text)?.[1];
  if (scan.fence) {
    const closes = marker && marker[0] === scan.fence[0] && marker.length >= scan.fence.length;
    if (closes && text.slice(marker.length).trim() === '') scan.fence = null;
    return false;
  }
  if (indented) return false;
  if (marker) {
    scan.fence = marker;
  } else if (DETAILS_OPEN.test(text)) {
    scan.depth += 1;
  } else if (DETAILS_CLOSE.test(text)) {
    scan.depth -= 1;
  }
  return scan.depth === 0;
}

// `<details>`의 open과 태그 없는 `<summary>`의 Markdown을 허용하며 나머지 HTML은 글자로 둔다.
function detailsBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const opening = DETAILS_OPEN.exec(textOf(state, startLine));
  if (!opening) return false;
  const close = findDetailsClose(state, startLine, endLine);
  if (close >= endLine) return false;
  if (silent) return true;
  const summary = DETAILS_SUMMARY.exec(textOf(state, startLine + 1));
  const open = state.push('details_open', 'details', 1);
  open.map = [startLine, close];
  if (opening[1]) open.attrSet('open', '');
  if (summary) {
    state.push('summary_open', 'summary', 1);
    const inline = state.push('inline', '', 0);
    inline.content = summary[1].trim();
    inline.children = [];
    // 요약 줄(원문의 다음 줄)의 위치. 안쪽 인라인 오류가 이 줄을 가리킨다.
    inline.map = [startLine + 1, startLine + 2];
    state.push('summary_close', 'summary', -1);
  }
  const [oldMax, oldParent] = [state.lineMax, state.parentType];
  state.parentType = 'details';
  state.lineMax = close;
  state.md.block.tokenize(state, startLine + (summary ? 2 : 1), close);
  state.lineMax = oldMax;
  state.parentType = oldParent;
  state.push('details_close', 'details', -1);
  state.line = close + 1;
  return true;
}

function taskStateOf(content) {
  return TASK_MARKERS.find(([marker]) => content.startsWith(marker))?.[1];
}

const isTaskItem = (tokens, index) =>
  tokens[index].type === 'inline' &&
  tokens[index - 1].type === 'paragraph_open' &&
  tokens[index - 2].type === 'list_item_open';

// 목록 항목의 앞머리 `[ ] `, `[x] `, `[~] `를 작업 상태로 바꾼다. 체크 상자·라벨·취소 표시의 HTML은 출력 단계가 만든다.
function taskItems(state) {
  const { tokens } = state;
  for (let index = 2; index < tokens.length; index += 1) {
    if (!isTaskItem(tokens, index)) continue;
    const task = taskStateOf(tokens[index].content);
    if (task === undefined) continue;
    markTaskItem(state, tokens, index, task);
  }
}

function markTaskItem(state, tokens, index, task) {
  const inline = tokens[index];
  const item = tokens[index - 2];
  item.meta = { task };
  if (task === 'cancelled') {
    inline.content = inline.content.slice(4);
    inline.children[0].content = inline.children[0].content.slice(4);
    inline.children.unshift(newToken(state, 'task_cancelled', 0));
    return;
  }
  // 마커의 앞 세 글자만 지우므로 본문은 공백으로 시작한다. 체크 상자 뒤 간격이 된다.
  inline.content = inline.content.slice(3);
  inline.children[0].content = inline.children[0].content.slice(3);
  const checkbox = newToken(state, 'task_checkbox', 0);
  checkbox.meta = { checked: task === 'done' };
  inline.children.unshift(newToken(state, 'task_label_open', 1), checkbox);
  inline.children.push(newToken(state, 'task_label_close', -1));
  const parent = findParentList(tokens, index - 2);
  if (parent >= 0) tokens[parent].meta = { ...tokens[parent].meta, containsTask: true };
}

function newToken(state, type, nesting) {
  return new state.Token(type, '', nesting);
}

function findParentList(tokens, index) {
  const level = tokens[index].level - 1;
  for (let at = index - 1; at >= 0; at -= 1) {
    if (tokens[at].level === level) return at;
  }
  return -1;
}

// 문서 최상위에서 이미지 하나(또는 링크로 감싼 이미지 하나)만 있는 문단은 그림으로 표시할 문단이라고 표시한다.
function standaloneFigure(state) {
  if (state.env.nested) return;
  const { tokens } = state;
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const [open, inline, close] = [tokens[index], tokens[index + 1], tokens[index + 2]];
    const standalone =
      open.type === 'paragraph_open' &&
      open.level === 0 &&
      !open.hidden &&
      inline.type === 'inline' &&
      close.type === 'paragraph_close';
    if (!standalone) continue;
    const kinds = inline.children.map((child) => child.type).join();
    if (kinds === 'image' || kinds === 'link_open,image,link_close') {
      open.meta = { role: 'figure' };
      close.meta = { role: 'figure' };
    }
  }
}
