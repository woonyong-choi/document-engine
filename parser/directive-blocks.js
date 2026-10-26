// 디렉티브 블록과 인라인 표기의 문법 정의. 각 항목이 허용 속성, 놓을 수 있는 자리, 본문 규칙과 의미 준비를 정한다.
// 출력은 renderer/directive-render.js가 같은 이름으로 정의한다. 이 파일은 HTML과 테마를 알지 못한다.
import { TAB_ATTRIBUTES, WIDTH_OPTION } from './directive-syntax.js';

const PLACES = ['root', 'tab'];
const LIST = ['bullet_list', 'ordered_list'];

// 옛 `::::tabs`+`:::tab[이름]` 형식은 선택 줄이 위에 오는 분할 모양이다. 새 `@tab` 형식은 meta.options를 미리 갖는다.
const LEGACY_TABS = Object.freeze({ position: 'top', selector: 'segmented' });

function tabSet(platform) {
  return {
    label: 'optional',
    attrs: TAB_ATTRIBUTES,
    within: ['root'],
    body: { only: ['directive:tab'], min: 1 },
    prepare(meta, children, { fail, reserveId }) {
      reserveId(meta);
      const seen = new Set();
      children.forEach((child, index) => {
        const key = child.meta.label.toLowerCase();
        if (seen.has(key)) fail(`탭 이름이 겹칩니다: ${child.meta.label}`, child.map?.[0] + 1);
        seen.add(key);
        child.meta.index = index;
      });
      meta.panels = children.map((child) => child.meta);
      meta.tabs = children.map((child) => child.meta.label);
      meta.options = platform ? { ...meta.attrs } : { ...LEGACY_TABS, ...meta.attrs };
    },
  };
}

const callout = {
  label: 'optional',
  attrs: {},
  within: PLACES,
  body: { min: 1, except: ['directive'] },
};

export const BLOCKS = Object.freeze({
  __proto__: null,
  tabs: tabSet(false),
  platform: tabSet(true),
  tab: {
    label: 'required',
    attrs: {},
    within: ['tabs', 'platform'],
    body: { min: 1 },
  },
  note: callout,
  warning: callout,
  fineprint: {
    label: 'none',
    attrs: {},
    within: PLACES,
    body: { only: ['paragraph'], min: 1 },
    prepare: (meta, children) => children.forEach((child) => (child.meta = { role: 'fineprint' })),
  },
  steps: {
    label: 'none',
    attrs: {},
    within: PLACES,
    body: { only: LIST, min: 1 },
  },
  qa: {
    label: 'none',
    attrs: {},
    within: PLACES,
    body: { only: ['dl'], min: 1 },
    prepare: (meta, children) =>
      children.forEach((child) => (child.meta = { role: 'definitions' })),
  },
  cards: {
    label: 'none',
    attrs: {
      variant: { type: 'enum', values: 'cardVariants' },
      columns: { type: 'enum', values: ['1', '2'] },
    },
    within: PLACES,
    body: { only: ['directive:card'], min: 1 },
    prepare: (meta, children) =>
      children.forEach((child) => {
        child.meta.variant = meta.attrs.variant;
      }),
  },
  card: {
    leaf: true,
    label: 'none',
    attrs: {
      title: { type: 'text', required: true },
      href: { type: 'url', required: true },
      description: { type: 'text' },
      icon: { type: 'icon' },
    },
    within: ['cards'],
  },
  gallery: {
    label: 'none',
    attrs: { title: { type: 'text' }, width: WIDTH_OPTION },
    within: PLACES,
    body: { only: ['directive:slide'], min: 1 },
    prepare(meta, children, { reserveId }) {
      reserveId(meta);
      meta.slides = children.map((child) => ({
        src: child.meta.attrs.src,
        alt: child.meta.attrs.alt,
        caption: child.meta.attrs.caption,
      }));
    },
  },
  slide: {
    leaf: true,
    label: 'none',
    attrs: {
      src: { type: 'asset', required: true },
      alt: { type: 'text', required: true },
      caption: { type: 'text' },
    },
    within: ['gallery'],
  },
  figure: {
    leaf: true,
    label: 'none',
    attrs: {
      src: { type: 'asset', required: true },
      alt: { type: 'text', required: true },
      caption: { type: 'text' },
      href: { type: 'url' },
      rounded: { type: 'bool' },
      width: WIDTH_OPTION,
    },
    within: PLACES,
  },
  video: {
    leaf: true,
    label: 'none',
    attrs: {
      src: { type: 'asset', required: true },
      poster: { type: 'asset', required: true },
      alt: { type: 'text', required: true },
      caption: { type: 'text' },
      controls: { type: 'bool' },
      frame: { type: 'enum', values: ['none', 'iphone'] },
      width: WIDTH_OPTION,
    },
    within: PLACES,
    check(attrs) {
      if (attrs.controls === false) {
        throw new Error('본문 영상의 재생 조작은 숨길 수 없습니다. controls 옵션을 생략하세요');
      }
    },
  },
});

// 한 줄 안에서 쓰는 `:이름[글]{속성}`. kbd와 menu는 기존 표기를 그대로 둔다.
export const INLINES = Object.freeze({
  __proto__: null,
  kbd: { attrs: {} },
  menu: { attrs: {} },
  icon: { attrs: {}, label: 'icon' },
  tip: { attrs: { text: { type: 'text', required: true } } },
});
