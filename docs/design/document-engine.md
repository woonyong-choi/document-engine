# 문서 엔진

| 항목 | 값 |
|---|---|
| 상태 | 구현 |
| 위치 | 저장소 루트 |
| 입력 기준 | 비교 원본 홈페이지 87af00676f181524d8386c2af39a06554f227325. 디자인 정본과 ThinkFlow는 호스트가 고르는 peer 의존성이며 시험용 commit은 `devDependencies`에 있다 |

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

`documentEngine`은 호출자가 `parseDocument(source, { id })`와 `renderDocument(document, { id })`로 부르는 객체다. 문법 확인 함수의 기본값(아이콘 카탈로그, 주소 정책)은 기본 테마에서 채운다.

독립 해석기는 `parser/parse-document.js`의 `parseDocument`로 가져온다. 동기 함수이며 검증 함수는 호출자가 제공한다. 패키지 루트의 `parseDocument`와 `documentEngine.parseDocument`는 기본 테마의 검증 함수를 보충하는 비동기 연결 함수다.

### 해석 문맥

| 필드 | 뜻 |
|---|---|
| id | 문서 식별자. 진단에 붙는다 |
| pageId | 구성 요소·제목 ID 접두사. `[\w-]+`만 허용한다 |
| assets.exists(name) | 자산 이름이 있는지. 없으면 존재를 확인하지 않는다 |
| icons.has(name) | 아이콘이 카탈로그에 있는지 |
| urls.isSafe(url) | 문서에 쓸 수 있는 주소인지 |

호스트의 파일 시스템 객체는 전달하지 않는다. 원문 문자열은 바꾸지 않는다.

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

### 출력 결과

| 필드 | 뜻 |
|---|---|
| html | 본문 HTML |
| headings | 해석 결과의 제목 목록 |
| diagnostics | 해석 진단과 출력 진단. 출력 진단은 `stage: render`와 `component`를 사용하며 `directive`는 없음 |
| assets | 문서가 쓴 자산 `{ name, url }`. 주소는 `assets.url(name)`, 없으면 `/assets/<name>`. 주소는 디자인 정본의 URL 정책(https·mailto·`/` 경로·`#`)을 통과해야 쓰고 기록하며 출력할 때 속성에 맞게 한 번만 이스케이프한다. 크기는 양의 정수 한 쌍이어야 한다. 주소를 얻는 데 성공한 자산만 기록하고 결과 조립에서 다시 조회하지 않는다 |
| runtime | 필요한 정본 runtime 파일 이름(`document.js`, `video.js` 등) |
| math | 수식이 있으면 true. KaTeX 스타일·글꼴은 `mathAssets()` |
| diagrams | `{ source, line, status: embedded, pending, failed }` |

`diagramplay` 펜스를 권장하며 기존 `thinkflow`와 `torso` 펜스도 같은 도표 분기로 해석한다. 세 펜스는 `width`와 `name=<이름>`을 받는다. 이름은 영문 소문자·숫자와 가운데 하이픈으로 쓰며, 유효성은 시험에 고정한 DiagramPlay의 `findBlocks`와 대조한다. 다른 속성과 잘못된 이름은 위치가 있는 진단으로 돌려준다.

`compileDiagram`은 첫 의미 줄의 독립된 `thinkflow` 또는 `torso` 선언만 `diagramplay`로 바꿔 단일 렌더러에 전달한다. 빈 줄, BOM, 공백, `#` 주석을 건너뛰되 구 선언 뒤에는 공백이나 주석만 허용한다. 본문·라벨·잘못된 시작 선언은 바꾸지 않는다. token.content, metadata, 중복 제거 기준과 결과 Map key는 원문을 유지한다. 공개 `toHtml`의 `source` 옵션으로 입력 원문을 전달하므로 문법 복사와 canonical HTML 다운로드도 같은 원문을 담는다. 컴파일 모형과 시간표는 수정하지 않는다.

지원 아이콘은 호스트의 전체 디자인 카탈로그가 정한다. 지원하지 않는 이름은 원문을 보존한 채 실패 진단으로 남긴다. 렌더 진단의 component는 입력 펜스 이름을 유지하며, 컴파일하지 않은 도표는 읽을 수 있는 코드로 남는다.

검증한 `name`은 펜스 토큰의 `meta.options`에 보존한다. 도표 원문·수집 정보·출력·경로에는 쓰지 않는다. 이름이 달라도 원문이 같으면 도표를 한 번만 만든다. 이름을 이용한 생성 SVG와 장면 표식의 전처리는 홈페이지 어댑터가 맡는다.

각주 ID는 `pageId`를 접두사로 해(`fn-<pageId>-1`, `fnref-<pageId>-1`) 한 피드의 여러 문서가 겹치지 않으며, `pageId`가 없으면 접두사가 없다. 구성 요소 안 각주는 구성 요소 번호를 따른다.

같은 문서를 다시 그리거나 다른 테마로 그려도 문서 토큰은 바뀌지 않는다. 아이콘 SVG ID(`icon-N-`)는 디자인 정본이 프로세스 전체 카운터로 만들므로 호출 이력에 따라 숫자가 달라진다. 출력 문자열은 호출마다 달라질 수 있다. 시험에서는 아이콘 ID를 정규화해 구조를 비교한다.

### 구성 요소 교체

테마는 스타일뿐 아니라 구성 요소 출력 함수를 교체한다. 교체 함수는 `(props, kit)`을 받아 HTML 문자열 또는 `kit.ui.isTrusted`가 인정하는 값을 돌려준다. 엔진은 반환값을 문자열로 바꿔 출력한다. props는 JSON으로 표현할 수 있는 값만 갖는다. 호출마다 props를 깊게 복사해 넘긴다. 함수가 props를 바꿔도 해석된 문서와 다음 출력은 변하지 않는다.

| 이름 | 형태 | props |
|---|---|---|
| tabs, tab, callout, steps, cards, details, table | open·close(cards는 gap, details는 summaryOpen·summaryClose 추가) | 이름별 속성 |
| card, gallery, figure, video, code | 단일 함수 | 이름별 속성 |
| kbd, menu, icon, tip | 단일 함수 | label, text, id |

같은 이름을 `:::` 블록과 `ui:` 코드 펜스가 함께 쓴다. 지원하지 않는 이름과 함수 아닌 값은 `ThemeError`로 거부하며 기본 출력으로 대신하지 않는다. 호출이 실패하거나 문자열·trusted 값 이외의 값을 돌려주면 그 자리에 오류 블록을 내고 `stage`가 `render`인 진단을 남긴다.

열기 호출이 실패하면 해당 쌍의 닫기는 호출하지 않는다. 이 규칙은 `:::` 블록, `ui:` 구성 요소와 일반 `details`·`table`에 적용한다. 쌍마다 성공 여부를 따로 저장하므로 안쪽 쌍의 실패는 바깥 쌍의 닫기를 막지 않는다. 함수가 던진 값이 Error가 아니어도(문자열, null, 객체) 진단 문구 하나로 바꾸고 다음 토큰의 렌더링을 계속한다.

교체 함수를 호출자 권한으로 실행하는 로더는 엔진에 없다. 호출자는 신뢰할 수 없는 교체 함수를 어댑터로 감싸 `components`로 넘긴다. 어댑터는 격리 실행기에서 교체 함수를 동기 호출한다. 어댑터는 `props`를 JSON 문자열로만 전달하고 HTML 문자열을 반환한다.

### 기본 테마

기본 테마는 호스트 앱이 설치한 `@woonyong-choi/design-tokens` 패키지다. 엔진은 디자인 파일을 가져오거나 복사하지 않고 빌드 단계도 없다. 어느 디자인 commit을 쓸지는 호스트가 정한다.

- 구성 요소와 아이콘은 `@woonyong-choi/design-tokens/ui/index.mjs`, `ui/build/icons.mjs`, `ui/svg.mjs`, `ui/manifest.mjs`에서 불러온다.
- 해석기가 쓰는 폭 값은 정본 구성 요소의 `WIDTHS` 하나다(`ui/components.mjs`). 해석기는 이 값 목록만 읽고 HTML을 만들지 않는다.
- 다크 모드는 문서 루트의 `data-theme` 또는 시스템 설정으로 정본 CSS가 처리한다. HTML은 모드와 무관하다.
- 호스트는 `DEFAULT_THEME_FILES`로 tokens.css, styles.css, ui/runtime을 문서 화면에 연결한다. `root`는 설치된 디자인 패키지의 `dist/` 폴더다.

### 호스트의 책임

소개 문단 중복 제거, 프로젝트 첫 H1·기존 ThinkFlow SVG 처리, 태그·공개 여부·날짜·발행 경로, 개인 도메인, image-sizes.json과 content 폴더 읽기, 출력 파일 배치, 검색·댓글·footer는 공통 엔진에 없다. 홈페이지 어댑터가 `assets`로 조회·주소·크기를 넘기고 `diagrams`를 만들어 전달한다. 도표 컴파일 결과의 `scenes`(DiagramPlay 시간표 단계 수)가 둘 이상인 도표를 품은 일반 `:::tabs`는 생략한 `position`을 `top`, `selector`를 `segmented`로 채우며(명시한 옵션과 `platform`은 그대로) 원문을 다시 읽어 세지 않는다. 프로젝트 도표 SVG·장면 표식 줄은 홈페이지 어댑터가 소유한다.

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
| `diagramplay` | `peerDependencies` `^0.2.0`, 시험용 `devDependencies` 고정 commit | 도표는 호스트가 고른 렌더러로 만든다 |

peer 범위는 설치된 패키지의 `version`과 비교한다. Git으로 설치한 패키지도 이 값을 가지므로 호스트가 고른 commit 하나를 엔진과 DiagramPlay가 함께 읽는다. `compileDiagram`은 엔진과 DiagramPlay가 같은 디자인 패키지 위치를 읽는지 확인하고 다르면 도표를 거절한다.

`files`는 `index.js`, `parser/`, `renderer/`, `theme/`만 허용하고 npm이 항상 담는 `package.json`, `README.md`, `LICENSE`가 더해진다. 시험, 설계 문서, 설정 파일, `node_modules`와 개인 경로는 들어가지 않으며 `test/package.test.js`가 `npm pack --dry-run` 목록으로 허용 범위와 담긴 코드의 상대 import 완결성, peer 선언을 검사한다. npm 레지스트리에는 발행하지 않는다.

### 검증

고정 홈페이지의 `createMarkdown`을 같은 입력·합성 자산으로 실행해 HTML, 제목 목록, 오류의 메시지·줄·구성 이름을 비교한다. HTML 비교에서는 모든 SVG의 내용을 제거하고 아이콘 ID 번호를 처음 나온 순서로 정규화한다. 제목 비교에서는 줄 정보를 제외한다. 이 비교는 SVG 그림의 내용과 화면의 시각적 동일성을 검증하지 않는다. `HOMEPAGE_SOURCE`는 홈페이지 작업본을 가리키며, 시험은 HEAD가 고정 commit이고 추적 파일이 깨끗한지 확인한 뒤 그 자리의 `src/markdown.mjs`를 읽기 전용으로 불러온다(사본을 만들지 않는다). 원본이 읽는 `config/image-sizes.json`과 `content/assets` 존재 확인만 시험 경계에서 합성 값으로 바꾼다. 환경변수가 없으면 비교 시험은 건너뛴다고 표시한다. 의도한 차이는 두 가지다.

- 원본이 줄을 붙이지 못하는 `<summary>` 안 인라인 오류에 요약 줄을 붙인다.
- 아이콘 유효성은 SVG 출력 대신 카탈로그 확인이므로 SVG ID 카운터 소비 횟수가 다르다.

### 요구사항

| 요구사항 | 검증 계획 |
|---|---|
| 해석기는 HTML·테마·DOM을 사용하지 않는다 | [parser.test.js](../../test/parser.test.js)의 `parser_sources_do_not_import_the_renderer_theme_or_output_libraries` |
| 해석과 출력이 원문·문서 토큰을 바꾸지 않는다 | [parser.test.js](../../test/parser.test.js)의 `the_source_string_is_never_modified_by_parsing`, [renderer.test.js](../../test/renderer.test.js)의 `render_does_not_change_the_document_and_repeats_the_same_output` |
| 테마 교체 함수의 실패를 문서 위치가 있는 진단으로 돌려준다 | [renderer.test.js](../../test/renderer.test.js)의 `a_failing_replacement_is_a_located_diagnostic_and_shows_an_error_block` |
| 실행에 필요한 파일만 배포 목록에 담는다 | [package.test.js](../../test/package.test.js)의 `pack_contains_only_what_the_engine_runs_on` |

## 단점

- 사용자 구성 요소 교체의 제한된 실행 환경, 미리보기 frame과 자산 CSP는 엔진이 아니라 호출자가 연결한다.
- front matter는 처리하지 않는다. 호스트나 어댑터가 본문과 분리해 넘긴다.
- 작업 항목은 HTML 대신 상태를 가진 토큰으로 해석한다. `markdown-it-task-lists`의 HTML 토큰과 모듈 전역 상태는 사용하지 않는다.
- Git 의존성의 잠금 파일에는 `git+ssh` 주소가 남는다. 설치 환경에서 해당 GitHub 주소를 받을 수 있어야 한다.
