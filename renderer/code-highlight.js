// 언어 문법의 scope를 공통 구문 역할로 연결한다. 색과 HTML은 테마 구성 요소가 정한다.
// 문법 분석기는 처음 렌더링할 때 한 번 불러온다.
let loading;

const LANGUAGE_NAME = /^[\w+#.-]+$/;
const PLAIN = Object.freeze({ id: 'plaintext', label: 'Plain text' });
const PLAIN_NAMES = new Set(['plaintext', 'text', 'txt']);

// IntelliJ Language Defaults의 역할을 따른다. 판별하지 못한 심볼의 타입·소유자는 추측하지 않는다.
const SCOPES = Object.freeze([
  [/^(?:comment|punctuation\.definition\.comment)(?:\.|$)/, 'comment'],
  [
    /^(?:support\.type\.property-name|punctuation\.support\.type\.property-name|entity\.other\.attribute-name|entity\.name\.tag\.yaml|support\.variable\.property)(?:\.|$)/,
    'property',
  ],
  [/^(?:variable\.(?:other\.)?(?:object\.)?property|meta\.attribute\.python)(?:\.|$)/, 'property'],
  [/^variable\.parameter(?:\.|$)/, 'parameter'],
  [
    /^(?:entity\.name\.(?:function|command)|support\.function|meta\.function-call\.generic\.python)(?:\.|$)/,
    'function',
  ],
  [
    /^(?:entity\.name\.(?:type|class|namespace)|support\.(?:type|class)|storage\.type\.(?:(?:primitive|generic|object|array)\.)?java)(?:\.|$)/,
    'type',
  ],
  [
    /^(?:entity\.name\.annotation|storage\.type\.annotation|meta\.annotation\.identifier)(?:\.|$)/,
    'annotation',
  ],
  [/^(?:keyword\.operator|keyword\.control\.ternary\.java)(?:\.|$)/, 'operator'],
  [/^storage\.modifier\.import\.java$/, undefined],
  [
    /^(?:keyword|storage|constant\.language|variable\.language|entity\.name\.tag)(?:\.|$)/,
    'keyword',
  ],
  [/^constant\.numeric(?:\.|$)/, 'number'],
  [/^(?:constant\.character\.escape|punctuation\.definition\.string|string)(?:\.|$)/, 'string'],
  [/^(?:constant|variable\.other\.constant)(?:\.|$)/, 'constant'],
  [/^variable(?:\.|$)/, 'variable'],
  [/^punctuation(?:\.|$)/, 'punctuation'],
]);

const FALLBACK_ROLES = Object.freeze({
  keyword: 'keyword',
  literal: 'keyword',
  string: 'string',
  regexp: 'string',
  number: 'number',
  symbol: 'constant',
  bullet: 'punctuation',
  title: 'function',
  section: 'function',
  name: 'keyword',
  attr: 'property',
  attribute: 'property',
  built_in: 'function',
  type: 'type',
  class: 'type',
  'selector-tag': 'type',
  'selector-class': 'type',
  'selector-id': 'property',
  variable: 'variable',
  'template-variable': 'variable',
  params: 'parameter',
  comment: 'comment',
  quote: 'comment',
  meta: 'annotation',
  operator: 'operator',
  punctuation: 'punctuation',
});

// 승인 원문의 실행용 펜스는 언어와 원문만 표시한다.
const RUN_ALIASES = Object.freeze({
  'run-python': 'python',
  'run-c': 'c',
  'run-javascript': 'javascript',
  'run-sql': 'sql',
  'run-shell': 'bash',
  'run-web': 'html',
});

/** @returns {Promise<{ codeLanguage(info?: string): { id: string, label: string }, highlightCode(source: string, language: string, ui: object): string }>} */
export function loadHighlighter() {
  loading ??= createEngine();
  return loading;
}

async function createEngine() {
  const [{ default: hljs }, { bundledLanguages, createHighlighter }] = await Promise.all([
    import('highlight.js'),
    import('shiki'),
  ]);
  const languages = collectLanguages(hljs, bundledLanguages);
  const highlighter = await createHighlighter({
    langs: [
      ...new Set([...languages.values()].map((language) => language.grammar).filter(Boolean)),
    ],
    themes: [{ name: 'syntax-roles', settings: [] }],
  });
  return {
    codeLanguage(info = '') {
      const word = info.trim().split(/\s+/)[0].toLowerCase();
      const language = LANGUAGE_NAME.test(word) ? languages.get(word) : undefined;
      return language ? { id: language.id, label: language.label } : PLAIN;
    },
    highlightCode(source, language, ui) {
      const grammar = languages.get(language)?.grammar;
      if (grammar) return textMateCode(highlighter, source, grammar, ui);
      if (PLAIN_NAMES.has(language) || !languages.has(language)) return ui.escape(source);
      // TextMate에 없는 기존 언어도 지원한다. 두 분석기의 출력은 같은 역할과 CSS를 사용한다.
      return hljs
        .highlight(source, { language, ignoreIllegals: true })
        .value.replace(/class="([^"]+)"/g, (_, classes) => {
          const names = classes.split(' ');
          const role = names.includes('class_')
            ? 'type'
            : FALLBACK_ROLES[names[0].replace(/^hljs-/, '')];
          return role ? `class="${ui.syntaxClass(role)}"` : '';
        });
    },
  };
}

function collectLanguages(hljs, bundledLanguages) {
  const languages = new Map();
  for (const language of hljs.listLanguages()) {
    const definition = hljs.getLanguage(language);
    const names = [language, ...(definition.aliases ?? [])];
    const grammar = names.find((name) => bundledLanguages[name]);
    for (const id of names) {
      languages.set(id, {
        id,
        label: definition.name ?? language,
        grammar: bundledLanguages[id] ? id : grammar,
      });
    }
  }
  for (const [alias, name] of Object.entries(RUN_ALIASES)) {
    const language = languages.get(name);
    languages.set(alias, { ...language, label: `${language.label} · 실행 미지원` });
  }
  return languages;
}

function textMateCode(highlighter, source, lang, ui) {
  // 두 분석 단계가 시간 제한으로 서로 다르게 잘리지 않게 한다.
  const lines = highlighter.codeToTokensBase(source, {
    lang,
    theme: 'syntax-roles',
    includeExplanation: 'scopeName',
    tokenizeTimeLimit: 0,
  });
  let end = 0;
  const parts = [];
  const append = (text, role) => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous && previous.role === role) previous.text += text;
    else parts.push({ text, role });
  };
  for (const token of lines.flat()) {
    append(source.slice(end, token.offset));
    for (const part of token.explanation ?? [{ content: token.content, scopes: [] }]) {
      append(part.content, roleOf(part.scopes));
    }
    end = token.offset + token.content.length;
  }
  append(source.slice(end));
  return parts.map((part) => String(ui.SyntaxToken(part))).join('');
}

function roleOf(scopes) {
  const names = scopes.map((scope) => scope.scopeName);
  const javaField =
    names.includes('variable.other.definition.java') &&
    names.includes('meta.class.body.java') &&
    !names.includes('meta.method.body.java');
  if (javaField) return 'property';
  for (const { scopeName } of scopes.toReversed()) {
    const match = SCOPES.find(([pattern]) => pattern.test(scopeName));
    if (match) return match[1];
  }
  return undefined;
}
