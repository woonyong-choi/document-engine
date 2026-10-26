// 디렉티브 블록과 인라인 표기의 출력. 해석기가 남긴 이름·라벨·속성에서 구성 요소 호출 하나로 바꾼다.
import { attemptComponent } from './call.js';

/** 제목을 생략한 :::note와 ui:callout의 제목. */
export const CALLOUT_TITLE = '참고';

const CALLOUTS = Object.freeze({
  note: { tone: '', title: CALLOUT_TITLE },
  warning: { tone: 'warning', title: '주의' },
});

// 장면 선택 줄이 있는 도표를 품은 일반 탭 묶음은 바깥 선택 줄과 구분되도록 생략한 position과 selector만 채운다.
// 명시한 옵션과 platform 묶음은 그대로 둔다.
const SCENE_TABS = Object.freeze({ position: 'top', selector: 'segmented' });

const tabsProps = (meta, withScenes) => ({
  id: meta.id,
  label: meta.label,
  platform: meta.name === 'platform',
  labels: meta.tabs,
  ...(withScenes && meta.name !== 'platform' ? SCENE_TABS : {}),
  ...meta.options,
});

/**
 * 장면이 둘 이상인 도표를 품은 탭 묶음을 렌더 전에 한 번 정한다. 열기와 닫기가 같은 결정을 쓰고 뒤따르는 묶음에는 전해지지 않는다.
 * @param {object[]} tokens 해석한 토큰
 * @param {Map<string, { scenes?: number }> | undefined} diagrams 도표 원문별 컴파일 결과
 * @returns {WeakSet<object>} 대상 묶음의 meta
 */
export function tabsWithScenes(tokens, diagrams) {
  const marked = new WeakSet();
  const open = [];
  for (const token of tokens) {
    if (token.type === 'directive_open' && token.meta.name === 'tabs') open.push(token.meta);
    else if (token.type === 'directive_close' && token.meta === open.at(-1)) open.pop();
    else if (token.type === 'fence' && open.length && token.meta?.role === 'diagram') {
      if (diagrams?.get(token.content)?.scenes > 1) marked.add(open.at(-1));
    }
  }
  return marked;
}

// 이름별 출력. open/close는 블록 앞뒤, render는 본문 없는 블록 하나다. 구성 요소 이름과 입력은 theme/components.js가 정한다.
const BLOCKS = Object.freeze({
  __proto__: null,
  tabs: {
    open: (meta, call, scenes) => call('tabs', 'open', tabsProps(meta, scenes)),
    close: (meta, call, scenes) => call('tabs', 'close', tabsProps(meta, scenes)),
  },
  platform: {
    open: (meta, call) => call('tabs', 'open', tabsProps(meta)),
    close: (meta, call) => call('tabs', 'close', tabsProps(meta)),
  },
  tab: {
    open: (meta, call) => call('tab', 'open', { id: meta.group, index: meta.index }),
    close: (meta, call) => call('tab', 'close', {}),
  },
  note: {
    open: (meta, call) => call('callout', 'open', calloutProps(meta)),
    close: (meta, call) => call('callout', 'close', {}),
  },
  warning: {
    open: (meta, call) => call('callout', 'open', calloutProps(meta)),
    close: (meta, call) => call('callout', 'close', {}),
  },
  fineprint: { open: () => '', close: () => '' },
  steps: {
    open: (meta, call) => call('steps', 'open', {}),
    close: (meta, call) => call('steps', 'close', {}),
  },
  qa: { open: () => '', close: () => '' },
  cards: {
    open: (meta, call) =>
      call('cards', 'open', { variant: meta.attrs.variant, columns: meta.attrs.columns }),
    close: (meta, call) => call('cards', 'close', { variant: meta.attrs.variant }),
  },
  card: {
    render: (meta, call) =>
      call('card', undefined, {
        ...meta.attrs,
        icon: meta.attrs.icon ? `content:${meta.attrs.icon}` : false,
        variant: meta.variant,
      }) + call('cards', 'gap', { variant: meta.variant }),
  },
  gallery: {
    open: (meta, call) =>
      call('gallery', undefined, {
        id: meta.id,
        title: meta.attrs.title,
        width: meta.attrs.width,
        slides: meta.slides,
      }),
    close: () => '',
  },
  slide: { render: () => '' },
  figure: { render: (meta, call) => call('figure', undefined, meta.attrs) },
  video: {
    render: (meta, call) =>
      call('video', undefined, { ...meta.attrs, title: meta.attrs.alt, id: meta.id }),
  },
});

const INLINES = Object.freeze({
  __proto__: null,
  kbd: (meta, call) => call('kbd', undefined, { label: meta.label }),
  menu: (meta, call) => call('menu', undefined, { label: meta.label }),
  icon: (meta, call) => call('icon', undefined, { label: meta.label }),
  tip: (meta, call) =>
    call('tip', undefined, { label: meta.label, text: meta.attrs.text, id: meta.id }),
});

function calloutProps(meta) {
  const callout = CALLOUTS[meta.name];
  return { title: meta.label ?? callout.title, tone: callout.tone };
}

// 호출마다 실패를 따로 센다. 한 블록 안의 호출이 여러 번이어도 앞선 실패를 뒤의 성공이 지우지 않는다.
function callerOf(render, line) {
  const state = { failed: false };
  const call = (name, method, props) => {
    const result = attemptComponent(render, name, method, props, line);
    state.failed ||= result.failed;
    return result.html;
  };
  return { call, state };
}

/**
 * directive_open·directive_close·directive 토큰의 HTML. 여는 호출이 실패한 블록은 닫을 때 아무것도 내지 않는다.
 * @param {object} render 렌더링 상태
 * @param {object} token 디렉티브 토큰
 * @param {number | undefined} line 진단에 붙일 문서 줄
 */
export function renderDirective(render, token, line) {
  const { meta } = token;
  const { call, state } = callerOf(render, line);
  const scenes = render.sceneTabs?.has(meta) ?? false;
  if (token.type === 'directive_close') {
    return render.failedOpens.has(meta) ? '' : BLOCKS[meta.name].close(meta, call, scenes);
  }
  const output = BLOCKS[meta.name][token.type === 'directive_open' ? 'open' : 'render'](
    meta,
    call,
    scenes,
  );
  if (token.type === 'directive_open' && state.failed) render.failedOpens.add(meta);
  return output;
}

export function renderInlineDirective(render, token, line) {
  return INLINES[token.meta.name](token.meta, callerOf(render, line).call);
}
