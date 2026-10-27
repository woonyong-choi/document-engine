// 해석기가 남긴 토큰을 HTML로 바꾸는 출력 규칙. 토큰은 바꾸지 않는다: 속성과 태그는 그리는 동안만 고치고 되돌린다.
// 모양은 테마 구성 요소(render.components)와 디자인 정본(render.kit.ui)이 정한다.
import mathPlugin from '@vscode/markdown-it-katex';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';

import { attemptComponent, callComponent, errorBlock, reportRenderFailure } from './call.js';
import { renderDirective, renderInlineDirective } from './directive-render.js';
import { resolveCodeAlias } from './code-alias.js';
import { UI_RENDERERS } from './ui-components.js';

// 수식은 KaTeX가 HTML과 MathML로 만든다. 믿을 수 없는 명령(\href, \includegraphics 등)은 실행하지 않고, 틀린 수식은 원문을 그대로 보여 준다.
const MATH_OPTIONS = Object.freeze({
  katex,
  throwOnError: false,
  errorColor: 'inherit',
  strict: 'ignore',
  trust: false,
  output: 'htmlAndMathml',
});

/**
 * @returns {MarkdownIt} 출력 규칙만 설치한 렌더러. env.render에 렌더링 상태를 담아 호출한다.
 *   각주·정의 목록·수식 플러그인은 해석기와 같은 버전이며 여기서는 출력 규칙만 쓴다.
 */
export function createRenderer() {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
    .use(footnote)
    .use(deflist)
    .use(mathPlugin.default ?? mathPlugin, MATH_OPTIONS);
  installTextRules(md);
  installStructureRules(md);
  installDirectiveRules(md);
  installFenceRules(md);
  return md;
}

// 토큰의 속성·태그를 임시로 고쳐 그리고 되돌린다. 같은 문서를 다른 테마로 다시 그릴 수 있어야 한다.
function renderChanged(tokens, index, change, draw) {
  const token = tokens[index];
  const { attrs, tag } = token;
  token.attrs = attrs ? attrs.map((pair) => [...pair]) : null;
  try {
    change(token);
    return draw();
  } finally {
    Object.assign(token, { attrs, tag });
  }
}

const withClass = (className) => (token) => token.attrJoin('class', className);

function installTextRules(md) {
  const { rules } = md.renderer;
  const lineOf = (tokens, index, env) => env.fenceLine ?? (tokens[index].map?.[0] ?? 0) + 1;
  const call = (env, name, method, props, tokens, index) =>
    callComponent(env.render, name, method, props, lineOf(tokens, index, env));

  // 열기·닫기 쌍마다 성공 여부를 스택에 둔다. 안쪽 쌍의 실패가 바깥 쌍의 상태를 바꾸지 않고, 실패한 열기의 닫기는 내지 않는다.
  const open = (env, name, props, tokens, index) => {
    const result = attemptComponent(env.render, name, 'open', props, lineOf(tokens, index, env));
    env.render.pairs.push({ name, failed: result.failed });
    return result.html;
  };
  const close = (env, name, tokens, index) => {
    const pair = env.render.pairs.pop();
    return pair.failed ? '' : call(env, name, 'close', {}, tokens, index);
  };

  rules.details_open = (tokens, index, options, env) =>
    open(env, 'details', { open: tokens[index].attrGet('open') !== null }, tokens, index);
  rules.details_close = (tokens, index, options, env) => close(env, 'details', tokens, index);
  rules.summary_open = (tokens, index, options, env) => {
    const pair = env.render.pairs.at(-1);
    if (pair.failed) return '';
    const result = attemptComponent(
      env.render,
      'details',
      'summaryOpen',
      {},
      lineOf(tokens, index, env),
    );
    pair.summaryFailed = result.failed;
    return result.html;
  };
  rules.summary_close = (tokens, index, options, env) => {
    const pair = env.render.pairs.at(-1);
    return pair.failed || pair.summaryFailed
      ? ''
      : call(env, 'details', 'summaryClose', {}, tokens, index);
  };
  rules.table_open = (tokens, index, options, env) => open(env, 'table', {}, tokens, index);
  rules.table_close = (tokens, index, options, env) => close(env, 'table', tokens, index);
  rules.task_label_open = () => '<label>';
  rules.task_label_close = () => '</label>';
  rules.task_checkbox = (tokens, index) =>
    `<input class="task-list-item-checkbox"${tokens[index].meta.checked ? ' checked=""' : ''} disabled="" type="checkbox">`;
  rules.task_cancelled = (tokens, index, options, env) => `${env.render.kit.ui.CancelledTask()} `;
  rules.directive_inline = (tokens, index, options, env) =>
    renderInlineDirective(env.render, tokens[index], lineOf(tokens, index, env));

  const renderInlineAsText = md.renderer.renderInlineAsText.bind(md.renderer);
  md.renderer.renderInlineAsText = (tokens, options, env) =>
    renderInlineAsText(
      tokens.map((token) =>
        token.type === 'directive_inline'
          ? { ...token, type: 'text', content: token.meta.plainText }
          : token,
      ),
      options,
      env,
    );
}

function installStructureRules(md) {
  const { rules } = md.renderer;
  const plain = (tokens, index, options, env, self) => self.renderToken(tokens, index, options);
  const classed = (className) => (tokens, index, options, env, self) =>
    renderChanged(tokens, index, withClass(className), () =>
      self.renderToken(tokens, index, options),
    );

  rules.heading_open = (tokens, index, options, env, self) =>
    classed(`app-heading-${tokens[index].tag.slice(1)}`)(tokens, index, options, env, self);
  for (const type of ['th_open', 'td_open']) {
    rules[type] = (tokens, index, options, env, self) => {
      const alignment = tokens[index].attrGet('style');
      if (!alignment) return plain(tokens, index, options, env, self);
      const change = (token) => {
        token.attrs = token.attrs.filter(([key]) => key !== 'style');
        token.attrSet('class', `is-${alignment.split(':')[1]}`);
      };
      return renderChanged(tokens, index, change, () => self.renderToken(tokens, index, options));
    };
  }
  rules.paragraph_open = (tokens, index, options, env, self) => {
    const role = tokens[index].meta?.role;
    if (role === 'fineprint')
      return classed(env.render.kit.ui.FINEPRINT_CLASS)(tokens, index, options, env, self);
    return paragraphAs(role, tokens, index, options, env, self);
  };
  rules.paragraph_close = (tokens, index, options, env, self) =>
    paragraphAs(tokens[index].meta?.role, tokens, index, options, env, self);
  rules.dl_open = (tokens, index, options, env, self) =>
    tokens[index].meta?.role === 'definitions'
      ? classed(env.render.kit.ui.DEFINITIONS_CLASS)(tokens, index, options, env, self)
      : plain(tokens, index, options, env, self);
  rules.list_item_open = (tokens, index, options, env, self) => {
    const task = tokens[index].meta?.task;
    if (!task) return plain(tokens, index, options, env, self);
    const change = (token) =>
      task === 'cancelled'
        ? token.attrJoin('class', 'task-list-item is-cancelled')
        : token.attrSet('class', 'task-list-item');
    return renderChanged(tokens, index, change, () => self.renderToken(tokens, index, options));
  };
  for (const type of ['bullet_list_open', 'ordered_list_open']) {
    rules[type] = (tokens, index, options, env, self) =>
      tokens[index].meta?.containsTask
        ? renderChanged(
            tokens,
            index,
            (token) => token.attrSet('class', 'contains-task-list'),
            () => self.renderToken(tokens, index, options),
          )
        : plain(tokens, index, options, env, self);
  }
}

// 그림으로 표시할 문단은 figure 태그와 공통 그림 클래스로 그린다.
function paragraphAs(role, tokens, index, options, env, self) {
  if (role !== 'figure') return self.renderToken(tokens, index, options);
  const change = (token) => {
    token.tag = 'figure';
    if (token.nesting === 1) token.attrJoin('class', env.render.kit.ui.FIGURE_CLASS);
  };
  return renderChanged(tokens, index, change, () => self.renderToken(tokens, index, options));
}

function installDirectiveRules(md) {
  const { rules } = md.renderer;
  const render = (tokens, index, options, env) => {
    const line = env.fenceLine ?? (tokens[index].map?.[0] ?? 0) + 1;
    return renderDirective(env.render, tokens[index], line);
  };
  for (const type of ['directive_open', 'directive_close', 'directive']) rules[type] = render;
  rules.directive_error = (tokens, index, options, env) => {
    const { render: state } = env;
    const { meta, content } = tokens[index];
    const { ui } = state.kit;
    const where = meta.line ? ` (${meta.line}줄)` : '';
    return errorBlock(state, `${meta.message}${where}`) + `<pre>${ui.escape(content)}</pre>`;
  };
}

function installFenceRules(md) {
  const { rules } = md.renderer;
  const defaultImage = rules.image;
  rules.image = (tokens, index, options, env, self) =>
    renderChanged(
      tokens,
      index,
      (token) => {
        token.attrSet('loading', 'lazy');
        token.attrSet('decoding', 'async');
        const src = token.attrGet('src');
        const size = env.render.kit.imageSize(
          src?.startsWith('/assets/') ? src.split('/').at(-1) : src,
        );
        if (size) {
          token.attrSet('width', size[0]);
          token.attrSet('height', size[1]);
        }
      },
      () => defaultImage(tokens, index, options, env, self),
    );
  rules.code_block = (tokens, index, options, env) => {
    const { render } = env;
    const code = `<code class="language-plaintext">${render.kit.escape(tokens[index].content)}</code>`;
    const line = env.fenceLine ?? (tokens[index].map?.[0] ?? 0) + 1;
    return callComponent(
      render,
      'code',
      undefined,
      { code, language: render.highlighter.codeLanguage().label },
      line,
    );
  };
  rules.fence = (tokens, index, options, env) => {
    const token = tokens[index];
    const line = env.fenceLine ?? (token.map?.[0] ?? 0) + 1;
    try {
      return renderFence(token, env, line);
    } catch (error) {
      return reportRenderFailure(env.render, error, {
        component: token.meta?.kind ? `ui:${token.meta.kind}` : 'fence',
        line,
      });
    }
  };
}

function renderFence(token, env, line) {
  const { render } = env;
  const meta = token.meta ?? { role: 'code', options: {} };
  if (meta.role === 'error') return errorBlock(render, meta.message);
  if (meta.role === 'diagram') {
    const diagram = render.context.diagrams?.get(token.content);
    if (diagram?.error) {
      return reportRenderFailure(render, new Error(diagram.error), {
        component: token.info.trim().split(/\s/)[0],
        line,
      });
    }
    if (diagram) {
      const { width } = meta.options;
      return String(render.kit.ui.DiagramEmbed({ ...diagram, ...(width ? { width } : {}) }));
    }
  }
  if (meta.role === 'ui') return renderComponent(token, env, line);
  const alias = resolveCodeAlias(token.info, render.context.codeAliases);
  const language = render.highlighter.codeLanguage(alias.info);
  const { id } = language;
  const label = alias.label ?? language.label;
  const code = `<code class="language-${id}">${render.highlighter.highlightCode(token.content, id, render.kit.ui)}</code>`;
  return callComponent(render, 'code', undefined, { code, language: label, ...meta.options }, line);
}

function renderComponent(token, env, line) {
  const { render } = env;
  const { meta } = token;
  const html = new Map(meta.units.map((unit) => [unit.path, render.renderUnit(unit)]));
  const rc = {
    id: meta.id,
    html: (path) => html.get(path) ?? '',
    call: (name, method, props) => callComponent(render, name, method, props, line),
    attempt: (name, method, props) => attemptComponent(render, name, method, props, line),
    kit: render.kit,
  };
  return String(UI_RENDERERS[meta.kind](meta.data, rc));
}
