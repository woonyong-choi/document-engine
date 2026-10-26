# 문서 엔진

| 항목 | 값 |
|---|---|
| 상태 | 구현 |
| 위치 | 저장소 루트 |
| 입력 기준 | 비교 원본 홈페이지 `87af00676f181524d8386c2af39a06554f227325` |

디자인 패키지와 DiagramPlay는 호스트가 고르는 peer 의존성이다. 시험용 commit은 `devDependencies`에 고정한다.

## 요약

원문 Markdown을 구조와 진단으로 바꾸는 해석과, 해석한 구조에 테마를 적용해 HTML을 만드는 출력을 독립 진입점으로 제공한다. 해석기는 HTML·테마·DOM을 알지 못하고, 출력은 해석된 토큰을 그리기만 하며 Markdown이나 YAML을 다시 해석하지 않는다.

## 해결하는 문제

호출 앱이 문서마다 Markdown 문법과 구성 요소 출력을 따로 관리하면 오류 위치와 출력 방식이 달라진다. 엔진은 원문 해석과 테마 출력을 분리하고 자산 조회·파일 저장·화면 연결은 호출자에게 맡긴다.

## 사용 예

### 제목과 문단 출력

저장소 루트에서 예시를 실행한다. 앱에 설치한 패키지를 호출할 때는 import 경로를 `document-engine`으로 바꾼다.

```js
import { documentEngine } from './index.js';

const document = await documentEngine.parseDocument('# 시작\n\n문서 본문입니다.\n', {
  id: 'example.md',
  pageId: 'example',
});
const output = await documentEngine.renderDocument(document);
console.log(output.html);
console.log(output.diagnostics);
```

1. 호출자가 원문 문자열과 문서 식별자를 넘긴다.
2. 엔진이 제목과 문단의 HTML, 빈 진단 목록을 돌려준다.
3. 호출자가 반환된 HTML에 테마의 CSS·runtime을 연결한다.

## 작동 방식

### 진입점

패키지 `exports`는 두 진입점만 연다. 그 밖의 내부 파일(`document-engine/renderer/kit.js` 등)은 패키지 이름으로 import할 수 없다(`ERR_PACKAGE_PATH_NOT_EXPORTED`).

| 진입점 | 내용 |
|---|---|
| `document-engine` | `parseDocument`(비동기), `renderDocument`, `documentEngine`, `compileDiagram`, `compileDiagrams`, `mathAssets`, `MATH_STYLESHEET`, `usesMath`, `ThemeError`, `DEFAULT_THEME_FILES` |
| `document-engine/parser` | `parseDocumentSync`(동기) |

`documentEngine`은 호출자가 `parseDocument(source, { id })`와 `renderDocument(document, { id })`로 부르는 객체다. 루트 `parseDocument`는 문법 확인 함수와 값 목록의 기본값(아이콘 카탈로그, 주소 정책, 폭·카드 모양 목록)을 기본 테마에서 채운 뒤 `parseDocumentSync`를 부르는 비동기 함수다.

`parseDocumentSync`는 테마 없이 동기로 해석한다. 검증 함수와 값 목록은 호출자가 제공하고, 주지 않은 항목은 해석 단계에서 확인하지 않는다. 해석기 폴더는 디자인 패키지·DiagramPlay·렌더러·테마를 import하지 않는다. [parser.test.js](../../test/parser.test.js)의 경계 시험이 여러 줄 import, `export ... from`, 동적 `import()`까지 검사한다.

### 해석 문맥

| 필드 | 뜻 |
|---|---|
| id | 문서 식별자. 비어 있지 않은 문자열이며 없으면 `TypeError`. 진단에 붙는다 |
| pageId | 구성 요소·제목 ID 접두사. `[\w-]+`만 허용한다 |
| assets.exists(name) | 자산 이름이 있는지. 없으면 존재를 확인하지 않는다 |
| icons.has(name) | 아이콘이 카탈로그에 있는지 |
| urls.isSafe(url) | 문서에 쓸 수 있는 주소인지 |
| vocabulary.widths | 폭 옵션 `width`의 값 목록. 루트 `parseDocument`는 디자인 정본 `WIDTHS` |
| vocabulary.cardVariants | `:::cards`의 `variant` 값 목록. 루트 `parseDocument`는 디자인 정본 `CARD_VARIANTS` |

호스트의 파일 시스템 객체는 전달하지 않는다. 원문 문자열은 바꾸지 않는다.

### 문법

엔진은 현재 문법만 받는다. 옛 이름과 옛 형식을 바꿔 읽는 호환 경로는 두지 않으며, 옛 입력은 현재 문법의 일반 진단으로 돌려준다.

| 문법 | 형식 | 옛 입력의 처리 |
|---|---|---|
| 블록 | `:::이름[라벨]{속성}` 또는 `:::이름 속성` … `:::` | 네 콜론 이상(`::::tabs`)은 `블록 줄 형식이 잘못되었습니다` |
| 리프 | `::이름{속성}` 또는 `::이름 속성` | 없음 |
| 탭 묶음 | `:::tabs`·`:::platform` 옵션, `@tab 라벨` 줄, `:::end` | `:::tab[이름]` 블록은 `알 수 없는 블록입니다` |
| 옵션 | `key=값`, 값 없는 참거짓 이름(`rounded`, `controls`) | `box`, `top`, `w-narrow`, `selector-segmented`, `centered` 같은 약칭·붙임 옵션은 `허용하지 않는 속성입니다` |
| 도표 펜스 | ` ```diagramplay width=… name=… ` | ` ```thinkflow `·` ```torso `는 일반 코드 펜스 |

[output.test.js](../../test/output.test.js)의 `old_tab_sets_and_old_options_are_ordinary_syntax_errors`, `old_diagram_fence_names_are_plain_code_and_their_options_are_code_options`와 [diagram.test.js](../../test/diagram.test.js)의 `compileDiagram_does_not_rewrite_old_thinkflow_or_torso_headers`가 검사한다.

### 해석 결과

`tokens`와 `env`는 기존 markdown-it 토큰을 그대로 쓰며 병렬 AST를 만들지 않는다. 토큰의 `map`이 원문 줄 범위다.

| 필드 | 뜻 |
|---|---|
| metadata.headings | `{ id, title, level, line }` 목록. 중첩 구성 요소 안의 제목은 구성 요소 줄을 가리킨다 |
| metadata.diagrams | 도표 원문과 줄·폭. 도표 생성은 렌더러 밖에서 한다 |
| metadata.links | `{ kind, target, line }` 목록. `kind`는 `link` 또는 `image`, `target`은 원문 대상 |
| diagnostics | 해석 진단. `{ document, severity, stage, message, line, directive, nestedLine? }` |

링크 정보는 인라인 링크·이미지, 중첩 구성 요소의 Markdown 필드와 각주에서 모은다. `card`·`figure` 디렉티브와 `ui:feature`·`ui:figure`·`ui:cards`·`ui:figure-grid`의 `href`도 포함한다. 일반 본문의 줄은 링크가 있는 줄이다. 구성 요소와 그 안쪽 Markdown 필드의 줄은 펜스 시작 줄이다. 대상의 존재 여부는 호출자가 확인한다.

문법 오류는 던지지 않고 진단으로 돌려준다. 오류 블록은 오류 토큰 하나로 바뀌고 문서의 나머지는 유지한다. 닫는 줄을 찾지 못한 블록은 여는 줄만 오류로 처리하므로 뒤따르는 줄에서 추가 진단이 생길 수 있다.

진단 줄은 실제 위치를 가리킨다. 인라인 표기의 오류는 문단 시작 줄에 오류 앞의 줄바꿈 수를 더한 줄이다. 문단 바로 다음 줄의 `:::`·`:::end`·형식이 틀린 블록 줄도 문단에 흡수하지 않고 진단한다. 줄 첫머리의 `::글::`처럼 같은 줄에서 닫히는 강조는 블록이 아니라 문단이다.

`ui:` 구성 요소의 필드 형식은 해석 단계에서 검사한다. 명세(`parser/ui-fences.js`의 `UI_KINDS`)는 필드마다 글(문자열·숫자·참거짓·null), 항목 목록, 글 목록 중 하나를 정한다. 형식이 틀리면 `body: 글이어야 합니다`처럼 필드 경로가 있는 진단을 그 필드가 있는 줄에 남기고 구성 요소는 오류 블록이 된다. 출력 단계에서 JavaScript 오류 문구나 `[object Object]`가 나오지 않는다.

문서 안 DOM id는 유일하다. 구성 요소 번호(`component-<pageId|page>-N`)는 한 줄 필드 안의 구성 요소까지 문서 전체에서 한 번씩만 쓴다. 제목 id는 모든 구성 요소 번호를 정한 뒤 붙이며, 구성 요소 id나 그 파생 id(`-tip`, `-tab-0` 등)와 겹치면 `heading-`을 앞에 붙인다.

작업 항목 표식 `[x]`·`[ ]`·`[~]`는 같은 이름의 참조 정의(`[x]: 주소`)가 있어도 링크가 아니라 작업 상태다.

### 출력 결과

| 필드 | 뜻 |
|---|---|
| html | 본문 HTML |
| headings | 해석 결과의 제목 목록 |
| diagnostics | 해석 진단과 출력 진단. 출력 진단은 `stage: render`, `component`, 문서 줄 `line`을 사용하며 `directive`는 없음. 들여쓴 코드 블록도 줄을 붙인다 |
| assets | 구성 요소가 자산 조회로 사용한 `{ name, url }` 목록 |
| runtime | 필요한 정본 runtime 파일 이름(`document.js`, `video.js` 등) |
| math | 수식이 있으면 true. KaTeX 스타일·글꼴은 `mathAssets()` |
| diagrams | `{ source, line, status: embedded, pending, failed }` |
| theme | 적용한 테마 이름. 테마를 주지 않으면 `default`, 이름 없는 교체 테마는 `custom` |

출력 문맥에서 호스트 전용 값을 받는다. 엔진에는 특정 사이트의 자산 이름이나 언어 별칭을 두지 않는다.

| 출력 문맥 | 뜻 |
|---|---|
| deviceOverlay | 기기 틀(`frame=iphone` 영상, `ui:device`, `ui:demos`) 위에 겹칠 그림의 자산 이름. 없으면 겹치지 않는다. 홈페이지는 `bezel-iphone6-overlay.svg` |
| codeAliases | `{ 이름: { language, label? } }`. 펜스 첫 낱말이 이름과 같으면 `language`로 강조하고 `label`을 표시한다. 홈페이지는 `run-python` 같은 실행용 펜스를 `Python · 실행 미지원`으로 넘긴다 |

구성 요소의 자산 주소는 출력 문맥의 `assets.url(name)`으로 조회하고, 함수가 없으면 `/assets/<name>`을 쓴다. 디자인 패키지의 URL 정책(https·mailto·`/` 경로·`#`)을 통과한 주소만 기록하며 출력할 때 속성에 맞게 한 번만 이스케이프한다. 선택적으로 전달하는 `assets.size(name)`은 양의 정수 한 쌍 또는 크기를 모를 때 `undefined`를 반환한다. 결과를 조립할 때 주소를 다시 조회하지 않는다.

일반 Markdown 이미지의 주소는 원문을 사용하므로 `assets.url`로 바꾸거나 반환값 `assets`에 모으지 않는다. 해당 이미지에도 `assets.size`로 크기를 제공할 수 있다. 일반 Markdown의 링크·이미지 대상은 해석 결과의 `metadata.links`에서 확인한다. `::figure`의 `src` 같은 구성 요소 이미지 필드는 이 목록에 없으므로 해석된 토큰의 속성과 출력의 `assets`도 따로 확인한다. `assets`는 사용한 주소 목록이지 파일 존재 확인 결과가 아니며, 실제 존재 여부는 호스트가 해석 문맥의 `assets.exists` 등으로 검사한다. 이 구분은 [자산 조회 도구](../../renderer/kit.js)와 [이미지 출력 규칙](../../renderer/markdown-rules.js)에 있다.

도표는 `diagramplay` 펜스 하나로 쓴다. 다른 이름(`thinkflow`, `torso` 등)의 펜스는 도표가 아니라 일반 코드이며 코드 옵션(`width`, `filename`)만 받는다. `diagramplay` 펜스는 `width`와 `name=<이름>`을 받는다. 이름은 영문 소문자·숫자와 가운데 하이픈으로 쓰며, 유효성은 시험에 고정한 DiagramPlay의 공개 CLI `diagramplay md --check --json` 결과와 대조한다. 다른 속성과 잘못된 이름은 위치가 있는 진단으로 돌려준다.

`compileDiagram`은 원문을 바꾸지 않고 DiagramPlay에 그대로 넘긴다. 첫 의미 줄이 `diagramplay`가 아니면 DiagramPlay가 `missing-preamble` 오류로 거절한다. token.content, metadata, 중복 제거 기준과 결과 Map key는 원문을 유지한다. 공개 `toHtml`의 `source` 옵션으로 입력 원문을 전달하므로 문법 복사와 canonical HTML 다운로드도 같은 원문을 담는다. 컴파일 모형과 시간표는 수정하지 않는다.

지원 아이콘은 호스트의 전체 디자인 카탈로그가 정한다. 지원하지 않는 이름은 원문을 보존한 채 실패 진단으로 남긴다. 렌더 진단의 component는 입력 펜스 이름을 유지하며, 컴파일하지 않은 도표는 읽을 수 있는 코드로 남는다.

검증한 `name`은 펜스 토큰의 `meta.options`에 보존한다. 도표 원문·수집 정보·출력·경로에는 쓰지 않는다. 이름이 달라도 원문이 같으면 도표를 한 번만 만든다. 이름을 이용한 생성 SVG와 장면 표식의 전처리는 홈페이지 어댑터가 맡는다.

도표 컴파일 결과의 `scenes`는 DiagramPlay 시간표의 단계 수다. 이 값이 둘 이상인 도표를 품은 일반 `:::tabs`에서 렌더러는 생략한 `position`을 `top`, `selector`를 `segmented`로 채운다. 명시한 옵션과 `platform` 묶음은 바꾸지 않으며 원문을 다시 읽어 단계를 세지 않는다. 이 처리는 호스트가 아니라 [렌더러](../../renderer/directive-render.js)의 책임이며, [renderer.test.js](../../test/renderer.test.js)의 `tabs_holding_a_multi_scene_diagram_fill_only_omitted_position_and_selector`와 `platform_tabs_and_later_tab_sets_ignore_the_scene_decision`이 검사한다.

각주 ID는 `pageId`를 접두사로 해(`fn-<pageId>-1`, `fnref-<pageId>-1`) 한 피드의 여러 문서가 겹치지 않으며, `pageId`가 없으면 접두사가 없다. 구성 요소 안 각주는 구성 요소 번호를 따른다.

같은 문서를 다시 그리거나 다른 테마로 그려도 문서 토큰은 바뀌지 않는다. 아이콘 SVG ID(`icon-N-`)는 디자인 정본이 프로세스 전체 카운터로 만들므로 호출 이력에 따라 숫자가 달라진다. 출력 문자열은 호출마다 달라질 수 있다. 시험에서는 아이콘 ID를 정규화해 구조를 비교한다.

### 코드 강조

코드 펜스의 언어 이름·별칭·표시 이름은 highlight.js 언어 목록 하나가 기준이다. 같은 이름(또는 별칭)의 TextMate 문법이 shiki에 있으면 shiki로, 없으면 highlight.js로 분석한다. 두 분석기의 결과는 같은 구문 역할(`ui.SyntaxToken`, `ui.syntaxClass`)로 출력한다. 목록에 없는 언어와 `text`·`plaintext`는 강조하지 않는다.

TextMate 문법은 `renderDocument`가 문서와 `ui:` 구성 요소 안의 펜스 언어를 모아 그 문법만 불러온다. 한 번 불러온 문법은 프로세스 안에서 다시 쓴다.

코드 블록 하나의 TextMate 분석 시간은 `HIGHLIGHT_TIME_LIMIT_MS`(500ms)로 제한한다. shiki가 한 줄에 쓰는 기본 제한과 같은 값을 블록 전체에 적용한다. 제한을 넘거나 한 줄이라도 분석이 중간에 멈추면 그 블록은 강조 없이 escape한 원문으로 출력하고 진단은 남기지 않는다. 같은 문서의 다른 블록은 계속 강조한다. [output.test.js](../../test/output.test.js)의 `a_code_block_over_the_highlight_time_limit_is_output_as_escaped_source`가 4만 줄 블록으로 검사한다.

### 구성 요소 교체

테마는 스타일뿐 아니라 구성 요소 출력 함수를 교체한다. 교체 함수는 `(props, kit)`을 받아 HTML 문자열 또는 `kit.ui.isTrusted`가 인정하는 값을 돌려준다. 엔진은 반환값을 문자열로 바꿔 출력한다. props는 JSON으로 표현할 수 있는 값만 갖는다. 호출마다 props를 깊게 복사해 넘긴다. 함수가 props를 바꿔도 해석된 문서와 다음 출력은 변하지 않는다.

props의 값은 두 종류다. 원문 글은 escape하지 않은 문자열이라 교체 함수가 `kit.escape`(속성·본문)와 `kit.safeUrl`(주소)로 처리해야 한다. HTML은 엔진이 이미 만든 안전한 조각이라 그대로 출력한다. 표에 없는 props(`id`, `index`, `variant`, `width` 같은 식별자·선택 값)도 원문 글처럼 다룬다.

| 이름 | 형태 | 원문 글 props | HTML props |
|---|---|---|---|
| tabs | open·close | label, labels | 없음 |
| tab | open·close | 없음 | 없음 |
| callout | open·close | title | 없음 |
| steps, table | open·close | 없음 | 없음 |
| cards | open·close·gap | 없음 | 없음 |
| details | open·close·summaryOpen·summaryClose | 없음 | 없음 |
| card | 단일 함수 | title, description, href, icon | 없음 |
| gallery | 단일 함수 | title, slides[].alt·caption·label·src | 없음 |
| figure | 단일 함수 | alt, caption, href, src | 없음 |
| video | 단일 함수 | title, caption, src, poster | 없음 |
| code | 단일 함수 | language, filename | code |
| kbd, menu, icon | 단일 함수 | label | 없음 |
| tip | 단일 함수 | label, text | 없음 |

같은 이름을 `:::` 블록과 `ui:` 코드 펜스가 함께 쓴다. `ui:` 구성 요소 가운데 위 이름을 부르는 것만 교체 테마를 따른다. 나머지는 디자인 정본 구성 요소로 바로 그린다.

| ui: 구성 요소 | 교체 테마 이름 |
|---|---|
| callout | callout |
| details | details |
| tabs, platform | tabs, tab |
| cards | card, cards(`split`이 없을 때) |
| figure, figure-grid | figure |
| video | video |
| gallery | gallery |
| group, feature, syntax-examples, feature-list, device, demos, feature-pair, fineprint, definitions, speech, keys, tooltip | 없음(교체 불가) |
 지원하지 않는 이름과 함수 아닌 값은 `ThemeError`로 거부하며 기본 출력으로 대신하지 않는다. 호출이 실패하거나 문자열·trusted 값 이외의 값을 돌려주면 그 자리에 오류 블록을 내고 `stage`가 `render`인 진단을 남긴다.

열기 호출이 실패하면 해당 쌍의 닫기는 호출하지 않는다. 이 규칙은 `:::` 블록, `ui:` 구성 요소와 일반 `details`·`table`에 적용한다. 쌍마다 성공 여부를 따로 저장하므로 안쪽 쌍의 실패는 바깥 쌍의 닫기를 막지 않는다. 함수가 던진 값이 Error가 아니어도(문자열, null, 객체) 진단 문구 하나로 바꾸고 다음 토큰의 렌더링을 계속한다.

교체 함수를 호출자 권한으로 실행하는 로더는 엔진에 없다. 호출자는 신뢰할 수 없는 교체 함수를 어댑터로 감싸 `components`로 넘긴다. 어댑터는 격리 실행기에서 교체 함수를 동기 호출한다. 어댑터는 `props`를 JSON 문자열로만 전달하고 HTML 문자열을 반환한다.

### 기본 테마

기본 테마는 호스트 앱이 설치한 `@woonyong-choi/design-tokens` 패키지다. 엔진은 디자인 파일을 가져오거나 복사하지 않고 빌드 단계도 없다. 어느 디자인 commit을 쓸지는 호스트가 정한다.

- 구성 요소·아이콘·SVG는 디자인 패키지의 이름 있는 export `@woonyong-choi/design-tokens/components`, `/icons`, `/svg`에서 불러온다. runtime 목록은 이름 있는 export가 없어 `ui/manifest.mjs`를 `./*` 경로로 읽는다.
- 폭과 카드 모양 값 목록은 정본 구성 요소의 `WIDTHS`, `CARD_VARIANTS` 하나다. 루트 `parseDocument`가 이 값을 해석 문맥 `vocabulary`로 넘기고, 출력 단계의 검사도 같은 정본 구성 요소가 한다. 해석기는 디자인 모듈을 import하지 않는다.
- 제목을 생략한 `:::note`와 `ui:callout`의 제목은 같은 `참고`다.
- 다크 모드는 문서 루트의 `data-theme` 또는 시스템 설정으로 정본 CSS가 처리한다. HTML은 모드와 무관하다.
- 호스트는 `DEFAULT_THEME_FILES`로 tokens.css, styles.css, ui/runtime을 문서 화면에 연결한다. `root`는 설치된 디자인 패키지의 `dist/` 폴더다.

### 호스트의 책임

자산 조회·파일 저장·화면 연결은 호스트가 맡는다. 홈페이지 어댑터는 `assets`로 조회·주소·크기를 넘기고, 도표 컴파일 결과를 원문별 Map인 `diagrams`로 전달한다. 컴파일한 도표의 HTML 파일을 저장하고 제공하는 일도 호스트의 책임이다.

소개 문단 중복 제거, 프로젝트 첫 H1 처리, 태그·공개 여부·날짜·발행 경로, 개인 도메인, `image-sizes.json`과 `content` 폴더 읽기, 출력 파일 배치, 검색·댓글·footer는 공통 엔진에 없다. 프로젝트 도표 SVG·장면 표식 줄의 전처리도 홈페이지 어댑터가 소유한다.

### 배포 파일

저장소 루트가 패키지다. 생성물이 없으므로 소비자는 고정 commit을 Git 의존성으로 설치한다. `prepare`·`prepack` 같은 설치 스크립트는 없다.

```json
{
  "devDependencies": {
    "@woonyong-choi/design-tokens": "github:woonyong-choi/design-tokens#<commit>",
    "diagramplay": "github:woonyong-choi/diagramplay#<commit>",
    "document-engine": "github:woonyong-choi/document-engine#<commit>"
  }
}
```

| 의존성 | 선언 | 이유 |
|---|---|---|
| `@woonyong-choi/design-tokens` | `peerDependencies` `^0.2.0`, 시험용 `devDependencies` 고정 commit | 기본 테마는 호스트가 준 디자인을 쓴다 |
| `diagramplay` | 선택 `peerDependencies` `^0.3.0`(`peerDependenciesMeta.optional`), 시험용 `devDependencies` 고정 commit | 도표는 호스트가 고른 렌더러로 만든다. 설치하지 않은 호스트도 문서 해석·출력은 쓸 수 있고, `compileDiagram`은 설치할 패키지를 알려 주는 오류를 던진다 |
| `katex` | `dependencies` `0.19.0`, `overrides` `katex: 0.19.0` | `@vscode/markdown-it-katex` 1.1.2는 `katex ^0.16.4`를 선언한다. 강제가 없으면 0.16.47이 따로 설치되어 수식 출력과 스타일·글꼴(`mathAssets`)의 KaTeX 판이 갈리고, 0.16 판의 보안 권고(GHSA-238p-pmpm-9mq7)가 남는다. katex의 `commander`는 강제하지 않고 katex 선언(`^15`)을 따른다 |

peer 범위는 설치된 패키지의 `version`과 비교한다. Git으로 설치한 패키지도 이 값을 가지므로 호스트가 고른 commit 하나를 엔진과 DiagramPlay가 함께 읽는다. `compileDiagram`은 엔진과 DiagramPlay가 같은 디자인 패키지 위치를 읽는지 확인하고 다르면 도표를 거절한다.

`files`는 `index.js`, `parser/`, `renderer/`, `theme/`만 허용하고 npm이 항상 담는 `package.json`, `README.md`, `LICENSE`가 더해진다. 시험, 설계 문서, 설정 파일, `node_modules`와 개인 경로는 들어가지 않으며 `test/package.test.js`가 `npm pack --dry-run` 목록으로 허용 범위와 담긴 코드의 상대 import 완결성, peer 선언, 쓰지 않는 의존성이 없음을 검사한다. npm 레지스트리에는 발행하지 않는다.

### 검증

고정 홈페이지의 `createMarkdown`을 같은 입력·합성 자산으로 실행해 HTML, 제목 목록, 오류의 메시지·줄·구성 이름을 비교한다. HTML 비교에서는 모든 SVG의 내용을 제거하고 아이콘 ID 번호를 처음 나온 순서로 정규화한다. 제목 비교에서는 줄 정보를 제외한다. 이 비교는 SVG 그림의 내용과 화면의 시각적 동일성을 검증하지 않는다. `HOMEPAGE_SOURCE`는 홈페이지 작업본을 가리키며, 시험은 HEAD가 고정 commit이고 추적 파일이 깨끗한지 확인한 뒤 그 자리의 `src/markdown.mjs`를 읽기 전용으로 불러온다(사본을 만들지 않는다). 원본이 읽는 `config/image-sizes.json`과 `content/assets` 존재 확인만 시험 경계에서 합성 값으로 바꾼다. 환경변수가 없으면 비교 시험은 건너뛴다고 표시한다. 의도한 차이는 세 가지다.

- 원본이 줄을 붙이지 못하는 `<summary>` 안 인라인 오류에 요약 줄을 붙인다.
- 아이콘 유효성은 SVG 출력 대신 카탈로그 확인이므로 SVG ID 카운터 소비 횟수가 다르다.
- 엔진은 옛 문법을 받지 않는다. 원본이 받던 옛 문법의 입력은 비교 대상에서 빼고 `ENGINE_ERROR_CASES`로 엔진 진단만 확인한다.

원본 비교와 별개로 오류 사례 시험은 홈페이지 원본 없이 CI에서 실행한다. [output.test.js](../../test/output.test.js)는 `ERROR_CASES`마다 첫 진단을 `본문 N줄 :이름: 내용` 형식으로 조립해 기대 정규식과 비교하고(`error_case_is_a_located_diagnostic_<이름>`), `UI_ERROR_CASES`와 `UI_SYNTAX_ERRORS`의 진단 문구도 기대 정규식으로 검사한다(`ui_error_case_is_a_diagnostic_<이름>`, `ui_syntax_error_is_one_parse_diagnostic_<이름>`). 원문 HTML과 위험한 주소의 처리는 `raw_html_and_unsafe_urls_never_reach_the_output_as_markup`이 출력에 `<script`, `javascript:` 같은 주소의 `href`·`src`, 이벤트 속성이 없는지 직접 확인한다.

### 요구사항

| 요구사항 | 검증 계획 |
|---|---|
| 해석기는 HTML·테마·DOM·디자인 모듈을 사용하지 않는다 | [parser.test.js](../../test/parser.test.js)의 `parser_sources_do_not_import_the_renderer_theme_design_or_output_libraries` |
| 공개 진입점만 import할 수 있다 | [package.test.js](../../test/package.test.js)의 `only_the_root_and_parser_entry_points_are_importable_by_package_name` |
| 해석과 출력이 원문·문서 토큰을 바꾸지 않는다 | [parser.test.js](../../test/parser.test.js)의 `the_source_string_is_never_modified_by_parsing`, [renderer.test.js](../../test/renderer.test.js)의 `render_does_not_change_the_document_and_repeats_the_same_output` |
| 테마 교체 함수의 실패를 문서 위치가 있는 진단으로 돌려준다 | [renderer.test.js](../../test/renderer.test.js)의 `a_failing_replacement_is_a_located_diagnostic_and_shows_an_error_block` |
| 문법 오류는 원본 없이도 위치가 있는 진단으로 검사한다 | [output.test.js](../../test/output.test.js)의 `error_case_is_a_located_diagnostic_<이름>`, `ui_error_case_is_a_diagnostic_<이름>` |
| 원문 HTML과 위험한 주소는 출력 표식이 되지 않는다 | [output.test.js](../../test/output.test.js)의 `raw_html_and_unsafe_urls_never_reach_the_output_as_markup` |
| 실행에 필요한 파일만 배포 목록에 담는다 | [package.test.js](../../test/package.test.js)의 `pack_contains_only_what_the_engine_runs_on` |

## 단점

- 사용자 구성 요소 교체의 제한된 실행 환경, 미리보기 frame과 자산 CSP는 엔진이 아니라 호출자가 연결한다.
- front matter는 처리하지 않는다. 호스트나 어댑터가 본문과 분리해 넘긴다.
- 작업 항목은 HTML 대신 상태를 가진 토큰으로 해석한다. HTML 토큰과 모듈 전역 상태를 만드는 작업 목록 플러그인은 쓰지 않는다.
- Git 의존성의 잠금 파일에는 `git+ssh` 주소가 남는다. 설치 환경에서 해당 GitHub 주소를 받을 수 있어야 한다.
