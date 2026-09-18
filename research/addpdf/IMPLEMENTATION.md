# doc.addPdf 구현 스펙 — pdf-lib 파서 + pdfkit writer

외부 PDF 1페이지를 현재 pdfkit 페이지에 Form XObject로 배치하는 기능. 파싱은 pdf-lib에
맡기고 최종 파일은 지금처럼 pdfkit이 쓴다.

세 가지 방식을 각각 구현해 로컬 PDF 60개로 비교한 뒤 이 방식으로 확정했다. 비교 결과와
근거는 [팀 공유 문서](https://claude.ai/code/artifact/cd6a55cc-0d34-4789-b745-5942c30573e5)에
있다. 이 문서는 확정된 방식 하나만 다룬다.

- 실측 커버리지: 60개 중 59개 (실패 1건은 암호화 PDF, 명시적 에러로 거부)
- 프로토타입: [prototype/](prototype/) — 브리지 120줄로 41/42 통과, 코드가 그대로 남아 있다

---

## 1. 범위

| | |
|---|---|
| 하는 것 | 외부 PDF의 한 페이지를 현재 페이지의 지정 위치·크기에 배치 |
| 하는 것 | 같은 PDF를 여러 위치·여러 페이지에 반복 배치 (XObject 1개 공유) |
| 하는 것 | 원본의 색공간·폰트·이미지를 바이트 단위로 그대로 이식 |
| 안 하는 것 | 페이지 병합(외부 PDF를 새 페이지로 이어붙이기) |
| 안 하는 것 | 암호화 PDF 복호화 (감지해서 거부까지만) |
| 안 하는 것 | 원본 주석·링크·AcroForm 이식 (Form XObject로는 넘어가지 않음) |

---

## 2. API 계약

pdf-lib 파싱이 비동기라서 파싱과 배치를 분리한다. 배치 호출부는 `doc.image()`와 같은
감각으로 유지한다.

```js
await doc.openPdf(src, opts)      // -> PdfHandle   (비동기, PDF 하나당 한 번)
doc.placePdf(handle, x, y, opts)  // -> this        (동기, 반복 호출)
await doc.addPdf(src, x, y, opts) // -> this        (위 둘의 편의 래퍼)
```

`src`: 파일 경로 · `Buffer` · `Uint8Array` · `ArrayBuffer` · `data:` URL
(`PDFImage.open`과 같은 입력 집합).

### 좌표 규약

`x`, `y`는 **배치 박스의 좌상단**이고 단위는 pt(1/72인치)다. pdfkit이 페이지 CTM을
뒤집어 쓰기 때문에 `doc.image()`와 완전히 같다.

```
 (0,0) ─────────────────────────────▶ x
   │
   │      (x, y) ┌───────────────┐   ← y는 페이지 위쪽 기준
   │             │  배치된 PDF   │ h
   │             └───────────────┘
   │                     w
   ▼ y
```

- 인자를 생략하면 `options.x`/`options.y` → 그것도 없으면 `doc.x`/`doc.y`
- `y`를 생략해 `doc.y`가 쓰인 경우에만 `doc.y += h` (이것도 `image()`와 같은 규칙)

### placePdf 옵션

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `width`, `height` | — | 배치 크기(pt). 하나만 주면 종횡비 유지 |
| `scale` | — | 배율 |
| `fit: [w,h]` | — | 박스 안에 맞춤 |
| `cover: [w,h]` | — | 박스를 채움 |
| `align` | — | `'center'` \| `'right'` (fit/cover 안에서) |
| `valign` | — | `'center'` \| `'bottom'` (fit/cover 안에서) |
| `page` | `0` | 소스 PDF의 페이지 인덱스 (0부터) |
| `box` | `'crop'` | `'media'` \| `'crop'` \| `'trim'` \| `'bleed'` \| `'art'` |
| `pdf_id` | — | 캐시 키. 포크의 `img_id` 패턴과 동일 |

크기 옵션을 **아무것도 주지 않으면 원본 박스 크기 그대로(1:1, 100%)** 배치한다. PDF는
pt 단위 실측 크기를 갖고 있고 조판에서 가장 자주 쓰는 기본값이기 때문이다. (이미지는
픽셀 크기가 기본값이라 다르다.)

조판에서는 보통 `box: 'trim'`을 쓴다. 재단선 기준으로 앉혀야 하기 때문이다.

### PdfHandle

```js
handle.pageCount            // 4
handle.size(page, box)      // { width, height }  — pt, /Rotate 반영된 값
handle.rotation(page)       // 90                 — 원본 /Rotate
```

핸들은 **그 pdfkit 문서에 묶인다.** 임베드된 Form XObject가 해당 문서의 객체이기 때문이다.
다른 `PDFDocument` 인스턴스에 재사용하면 안 된다.

### 호출 예

```js
const art = await doc.openPdf(job.artworkPath);

for (const slot of sheet.slots) {
  doc.placePdf(art, slot.x, slot.y, {
    page: slot.pageIndex,
    box: 'trim',
    width: slot.w,
    align: 'center'
  });
}
```

---

## 3. 통합 방법

### 3.1 의존성 · 빌드 설정

```jsonc
// package.json — devDependencies가 아니라 dependencies
"dependencies": {
  "crypto-js": "^4.0.0",
  "fontkit": "^1.8.1",
  "linebreak": "^1.0.2",
  "png-js": "^1.0.0",
  "pdf-lib": "^1.17.1"
}
```

```js
// rollup.config.js:5 — external 배열에 추가
const external = ['stream','fs','zlib','fontkit','events','linebreak',
                  'png-js','crypto-js','saslprep', 'pdf-lib'];
```

rollup은 `external`을 인라인하지 않으므로 `js/pdfkit.js`에는 `require('pdf-lib')` 한 줄만
남는다. `fontkit`·`png-js`와 같은 처리다.

### 3.2 번들 경로

```
lib/*.js  ──rollup──▶  js/pdfkit.js            (require('pdf-lib') 로 남음)
                            │
                       browserify ──▶ js/pdfkit.standalone.js   ← pdf-lib이 인라인됨
                            │
                        copy.bat ──▶ edicus-prepress/src/app/library/pdfkit/
                            │
                            ▼
        doc2pdf.ts:39, output2pdf.ts:12, print2pdf.ts:12, doc-render/type/pdf-kit.ts:7
                  require("../library/pdfkit/pdfkit.standalone.js")
```

앱의 4개 호출부 전부 standalone을 쓰고 `pdfkit.js` 라인은 주석 처리돼 있으므로
**앱의 package.json · webpack 설정 · copy.bat은 손댈 필요가 없다.** browserify가 pdfkit의
node_modules에서 pdf-lib을 찾아 번들에 넣는다.

브라우저 안전성은 확인했다. pdf-lib의 cjs 빌드는 ES5 CommonJS이고 `fs`·`path`를 실제로
쓰지 않는다(검색되는 `readFileSync`는 전부 JSDoc 예시 주석). browserify와 `brfs` 트랜스폼
모두 문제 없다.

### 3.3 번들 크기

| 임포트 | 실제 로드되는 JS |
|---|---|
| `from 'pdf-lib'` | 1,235KB (173 모듈) |
| `from 'pdf-lib/cjs/core'` | 824KB (`api` 레이어 미로드) |
| 파서 모듈만 딥 임포트 | 683KB (upng 제외) |

현재 standalone이 2.62MB(비압축)이므로 공개 API 기준 약 3.8MB가 된다. 앱 프로덕션 빌드는
uglify를 거치므로 최종 증가분은 min 기준 약 525KB다.

**공개 API(`from 'pdf-lib'`)로 시작한다.** `cjs/core`와 딥 임포트는 셋 다 동작을 확인했지만
pdf-lib 내부 경로에 의존해서 버전 올릴 때 깨진다. 번들 크기가 문제가 되면 그때 내린다.

### 3.4 파일 구조

기존 이미지 경로의 구조를 그대로 따른다.

| 새 파일 | 대응하는 기존 파일 | 역할 |
|---|---|---|
| `lib/pdf_source.js` | `lib/image.js` | 입력 정규화, pdf-lib 로드, 핸들 생성 |
| `lib/pdf_bridge.js` | — | pdf-lib 객체 → pdfkit ref 복사 |
| `lib/mixins/pdfs.js` | `lib/mixins/images.js` | `openPdf`/`placePdf`/`addPdf`, 배치 수학 |

```js
// lib/document.js — 두 줄 추가
import PdfsMixin from './mixins/pdfs';
mixin(PdfsMixin);
// constructor 안: this.initPdfs();   →  this._pdfRegistry = {}; this._pdfCount = 0;
```

### 3.5 pdf-lib 인스턴스는 반드시 하나

브리지가 `o instanceof PDFName` 같은 판별로 객체 종류를 가른다. pdf-lib이 두 번
로드되면(standalone 번들 안 + 앱 webpack 번들) 클래스가 서로 달라져 **모든 판별이 조용히
실패**한다.

- 규칙: 파싱은 pdfkit 안에서만 한다. 앱은 경로나 `Buffer`/`Uint8Array`만 넘기고 pdf-lib
  객체를 직접 만들어 넘기지 않는다.
- 앱이 나중에 pdf-lib을 직접 쓰게 되면 주입으로 하나만 공유한다:
  `PDFDocument.usePdfLib(pdfLib)`를 두고 lib/ 쪽은 주입된 참조의 클래스로만 판별.

현재 edicus-prepress의 package.json에는 pdf-lib이 없어 충돌 여지가 없다.

---

## 4. 내부 설계

### 4.1 파싱

```js
const srcDoc = await PDFDocument.load(bytes, { updateMetadata: false });
if (srcDoc.isEncrypted) throw new Error('encrypted PDF is not supported');
```

`PDFDocument.load`는 기본적으로 암호화 문서에서 `EncryptedPDFError`를 던진다.
`ignoreEncryption: true`를 쓰면 로드는 되지만 스트림이 복호화되지 않아 **열리지 않는 PDF가
조용히 나온다.** 절대 켜지 말 것.

페이지 속성 상속은 pdf-lib이 처리한다: `page.node.Resources()`, `node.MediaBox()`,
`node.CropBox()`는 페이지 트리를 거슬러 올라가 상속값을 찾아준다.

### 4.2 객체 그래프 복사 (브리지)

pdf-lib 객체를 pdfkit의 `doc.ref()`로 옮긴다. 검증된 구현은
[prototype/bridge.js](prototype/bridge.js)에 있고 120줄이다.

| pdf-lib | pdfkit으로 넘길 값 |
|---|---|
| `PDFName` | JS 문자열 (`asString().slice(1)` — 앞 `/` 제거) |
| `PDFNumber` | `asNumber()` |
| `PDFBool` | `asBoolean()` |
| `PDFNull` | `null` — **싱글턴이므로 `o === PDFNull`로 비교** |
| `PDFString` / `PDFHexString` | 사전 직렬화 토큰 (`toString()` 결과를 그대로) |
| `PDFArray` | `asArray().map(copy)` |
| `PDFDict` | 평범한 JS 객체 (키는 `/` 뗀 이름) |
| `PDFRef` | 매핑된 pdfkit `PDFReference` (memoize) |
| `PDFRawStream` | pdfkit ref + `.contents` 원본 바이트 그대로 |

브리지가 짧은 이유는 pdf-lib 객체가 스스로 직렬화되기 때문이다. `PDFString`·`PDFHexString`은
`toString()`이 이미 유효한 PDF 토큰을 내어서 이스케이프 코드가 필요 없고,
`PDFRawStream.contents`는 여전히 인코딩된 원본 바이트다.

순환 참조 대비: ref를 먼저 만들어 맵에 등록한 뒤 내용을 채운다.

### 4.3 Form XObject 생성

```js
const form = doc.ref({
  Type: 'XObject', Subtype: 'Form', FormType: 1,
  BBox: [x0, y0, x1, y1],              // 선택된 box, 원본 좌표 그대로
  Matrix: [1, 0, 0, 1, -x0, -y0],      // BBox 원점을 0,0으로 당김 (+ /Rotate 회전)
  Resources: copiedResourcesRef,
  Group: copiedGroupOrUndefined        // 투명도 그룹이 있으면 반드시 복사
});
form.end(concatenatedContent);
```

- `/Contents`가 배열이면 각 스트림을 디코딩해 개행으로 이어붙인다. 하나의 연산자가 스트림
  경계에 걸칠 수 있어 압축 상태로는 이어붙일 수 없다.
- `/Contents`가 단일 스트림이면 `/Filter`와 함께 원본 바이트를 그대로 넘겨도 된다.
- `/Group`을 빼먹으면 투명도·블렌딩이 깨진다. 코퍼스 60개 중 24개가 `/Group`을 갖고 있었다.

### 4.4 배치

```js
const sx = w / boxW, sy = h / boxH;
doc.page.xobjects[label] = form;
doc.save();
doc.transform(sx, 0, 0, -sy, x, y + h);   // 페이지 CTM의 뒤집기를 되돌린다
doc.addContent(`/${label} Do`);
doc.restore();
```

Form XObject는 이미지와 달리 단위 정사각형이 아니라 자기 BBox 좌표계에서 그려진다. 그래서
배율이 `w/boxW`가 된다. 위 행렬을 쓰면 form의 (0,0)이 배치 박스의 좌하단, (boxW, boxH)가
우상단으로 간다.

### 4.5 캐시

`doc.image()`의 `_imageRegistry` 패턴을 따른다.

- 핸들 캐시 키: `pdf_id ?? src 경로`
- 임베드 캐시 키: `(핸들, page, box)` — 같은 페이지를 다른 박스로 두 번 놓을 수 있다
- XObject는 한 번만 만들고, 각 페이지의 `page.xobjects`에 이름만 추가한다

캐시가 없으면 같은 PDF를 N번 놓을 때 출력이 N배로 커진다.

---

## 5. 반드시 지켜야 할 writer 규약 세 가지

셋 다 실측으로 확인했고, 어기면 예외 없이 조용히 깨진다.

### 5.1 `/Filter`는 `doc.ref()` 호출 시점에 넘긴다

[lib/reference.js:17](../../lib/reference.js#L17)의
`this.compress = this.document.compress && !this.data.Filter`가 **생성자에서 한 번만**
계산된다. ref를 만든 뒤에 `ref.data.Filter`를 넣으면 이미 압축된 바이트를 또 deflate한다.
실측: 37바이트 원본이 46바이트가 되고 inflate 실패.

```js
// 올바른 순서
const data = {};
if (srcDict.get(PDFName.of('Filter'))) data.Filter = copy(filter);  // ref 만들기 전에
const ref = doc.ref(data);
// 나머지 키는 같은 객체를 나중에 채워도 된다 (ref.data === data)
```

### 5.2 만든 ref는 전부 `end()` 한다

하나라도 빠지면 `_waiting`이 0으로 돌아오지 않아
[lib/document.js:389](../../lib/document.js#L389)의 `_finalize()`가 돌지 않는다. 실측:
`_waiting=1`, `_ended=true` 상태로 스트림이 `end` 이벤트를 내지 않고 xref도 `%%EOF`도 없는
미완성 파일이 남는다. **파싱 에러 경로에서 ref를 정리하지 않으면 문서 생성이 영구히 멈춘다.**

배치 도중 예외가 나면 그때까지 만든 ref를 모두 `end()`하고 다시 던지는 구조로 감싼다.

### 5.3 standalone 번들에서는 node Buffer가 인식되지 않는다

번들의 `Buffer.isBuffer`는 `b._isBuffer === true`를 요구하지만 node 네이티브 Buffer에는 그
속성이 없다. 그러면 `PDFObject.convert`가 마지막 분기로 떨어져 **PDF 문자열이 Name으로
새어나간다.** 실측으로 원본의 `/CharSet (/period/space)`가 출력에서
`/CharSet /period/space`가 되었다.

- 구현은 `lib/` 안에 둔다 (번들 내부의 Buffer를 쓰게 된다).
- 문자열은 Buffer 판별에 의존하지 말고 **사전 직렬화한 토큰**으로 내보낸다.
  `PDFAbstractReference`를 상속한 작은 래퍼 클래스의 `toString()`이 `(...)` 또는 `<hex>`를
  반환하게 하면 Buffer 정체성과 무관하게 안전하다.

이 함정은 산출물을 pdf-lib으로 열어보면 바로 드러난다. 수정 전 산출물은
`Invalid object ref` 경고를 17건 냈고 수정 후에는 0건이었다.

---

## 6. 프리프레스 처리 항목

로컬 PDF 60개에서 측정한 실제 출현 빈도와 함께.

| 항목 | 빈도 | 해야 할 일 |
|---|---|---|
| `/Rotate` | 11/60 | **핸들 크기와 Form Matrix 양쪽에** 반영. 프로토타입은 크기만 바꿨고 Matrix에 회전을 굽지 않았다 — 구현 시 채울 부분 |
| `/Group` (투명도) | 24/60 | Form dict로 복사 |
| `/OCProperties` (레이어) | 13/60 | 카탈로그 레벨이므로 대상 문서의 `/OCProperties`에 병합. 빼면 렌더링이 틀어질 수 있다 |
| `/TrimBox`·`/BleedBox` | 12·10/60 | `box` 옵션으로 선택 가능하게. 원본 박스 자체는 이식되지 않는다(정상) |
| `/OutputIntents` | 17/60 | 원본 것은 버린다. 출력 문서의 것이 유효해야 한다 |
| Separation·DeviceN | 6·4/60 | 리소스 그래프로 자동 이식됨. 별도 처리 불필요 |
| ICCBased | 33/60 | 같음 |
| 암호화 | 1/60 | 감지해서 명시적 에러 |

색 정보 이식은 검증했다. Altona `altona_visual_1v2a_x3.pdf`(PDF/X-3) 1페이지를 배치한 뒤
원본과 출력의 객체 사전을 비교한 결과 ICCBased 7·Separation 6·DeviceN 3·DeviceCMYK 28·
Indexed 4가 전부 일치했다.

---

## 7. 구현 체크리스트

- [x] `package.json` — `pdf-lib` 의존성 추가, volta 핀 `20.19.4`
- [x] `rollup.config.js:5` — `external`에 `'pdf-lib'` 추가
- [x] `lib/pdf_source.js` — 입력 정규화, `PDFDocument.load`, 암호화 거부, 핸들
- [x] `lib/pdf_bridge.js` — 객체 그래프 복사 (4.2 표 그대로), 사전 직렬화 문자열 래퍼
- [x] `lib/pdf_embedder.js` — Form XObject 생성, 회전, 콘텐츠 결합, OCG 병합
- [x] `lib/mixins/pdfs.js` — `openPdf`/`placePdf`/`addPdf`, 배치 수학, 캐시
- [x] `lib/document.js` — mixin 등록 + `initPdfs()`
- [x] `/Rotate`를 Form Matrix에 반영 (0·90·180·270 각각 테스트)
- [x] `/Group` 복사
- [x] `/OCProperties` 병합 — 이름·기본 상퇜·패넬 순서·RBGroups
- [x] 에러 경로에서 ref 정리 (5.2)
- [x] 단위 테스트 52건 — `tests/unit/pdf_bridge.spec.js`, `pdf_source.spec.js`, `pdfs.spec.js`
- [x] 코퍼스 회귀 하네스 — `research/addpdf/corpus.js`, 실제 PDF 60개 중 59 성공
- [x] `npm run build` 통과, standalone 2.73MB → 3.81MB
- [ ] Electron 렌더러에서 실제 로드 확인 (앱 빌드 필요)
- [ ] Acrobat 또는 생산 RIP에서 시각 확인 (8.5)

구현 중에 드러난 것: 간접 객체의 값이 딕셔너리가 아닐 때(문자열·이름·배열) `Object.assign`으로
펼치면 원본의 `/Name (Watermark)`가 `/token /(Watermark)`로 변형된다. 복사 분기는 **원본
타입 기준**으로 판단해야 하며, `PDFDict`만 병합 대상이다. 코퍼스 회귀가 잡아낸 버그다.

---

## 8. 검증

### 8.1 구조 검증 (자동)

출력 PDF마다 다음을 확인한다. [prototype/verify.js](prototype/verify.js)가 이걸 한다.

1. xref 오프셋 전부가 `N 0 obj`를 가리킨다
2. `/Root`에서 객체 그래프가 전수 해석된다 (dangling ref 0건)
3. 모든 스트림의 `/Length`가 실제 바이트 수와 일치한다
4. 배치된 XObject가 `/Subtype /Form`이고 BBox·Resources를 갖는다
5. 페이지 content 스트림이 `/<label> Do`를 호출한다
6. 네이티브 pdfkit 콘텐츠가 함께 남아 있다
7. 복사된 스트림이 원본과 바이트 단위로 같다 (재인코딩 0)
8. PDF 문자열이 Name으로 새어나가지 않았다 (5.3)

### 8.2 코퍼스 회귀 (자동)

[corpus.js](corpus.js)가 파일 목록을 받아 실제 `doc.addPdf`로 전부 배치하고 8.1을 돌린다.

```sh
node research/addpdf/corpus.js research/addpdf/corpus.txt
```

구현 완료 시점의 기준선:

| 항목 | 값 |
|---|---|
| 실제 PDF 60개 | **59 성공 / 1 실패** |
| 유일한 실패 | 암호화 PDF, 설계대로 명시적 거부 |
| 파일당 소요 | 중앙값 33ms, 최대 2,153ms |
| 복사된 스트림 | 23,692개 |

[acceptance.js](acceptance.js)는 Altona `altona_visual_1v2a_x3.pdf`(11.7MB, PDF/X-3)를
프리프레스 기능을 켠 문서에 두 번 배치하고 색 정보까지 대조한다. 기준선: openPdf 107ms,
전체 128ms, 피크 RSS 94MB, 11개 검사 전부 통과.

**코퍼스를 고정해 매 변경마다 돌리는 것이 이 기능의 유지보수 핵심이다.** 고객 파일에서 새
예외가 나오면 코퍼스에 추가한다.

### 8.3 레이어 보존 (자동)

[check-layers.js](check-layers.js)가 레이어가 있는 PDF를 배치하고 원본과 출력의 레이어
구조를 대조한다. 검사 항목: 레이어 등록 수, 이름, 기본 표시 상태(ON/OFF), 패널 순서,
그리고 그리기 연산자가 선택하는 레이어.

```sh
node research/addpdf/check-layers.js <layered.pdf>   # layers-out.pdf도 함께 생성
node research/addpdf/inspect-layers.js <file.pdf>    # 구조만 출력
```

기준선: 코퍼스 60개 중 레이어가 있는 **13개 전부 통과**. 실제 생산 파일의
`디자인뒷면`·`칼선뒷면`·`디자인`·`칼선` 4개 레이어와 `CMYK`·`Cut` 2개 레이어가
이름·상태·순서까지 그대로 넘어온다.

이 검사가 잡아낸 것이 둘 있다.

- `/D/Order`를 `/OCGs` 순서로 재구성하면 **레이어 패널 순서가 뒤바뀐다.** 실제 파일에
  `/OCGs`와 역순인 `/Order`가 있었다. Order는 중첩과 그룹 제목을 가질 수 있으므로 원본
  구조를 그대로 복사해야 한다. `/RBGroups`(상호 배타 레이어)도 같다.
- 원본에 `/Order`가 없으면 만들어 넣지 않는다.

### 8.4 교차 검증

산출물을 pdf-lib으로 다시 열어 경고 0건을 확인한다. 5.3의 문자열 누출을 즉시 잡아낸다.

### 8.5 아직 없는 것 — 시각 확인

지금까지의 검증은 전부 구조·바이트 단위다. 이 머신에는 Ghostscript 델리게이트가 없어
ImageMagick으로 PDF를 래스터화할 수 없었다. **Acrobat이나 생산 RIP에서 샘플 산출물을 한 번
열어봐야 한다.** 특히 `/Rotate`가 있는 파일과 투명도 `/Group`이 있는 파일.

---

## 9. 미결 사항

- **암호화 PDF**: 명시적 에러로 반려할지, 복호화를 붙일지. 고객 업로드 파일을 받는
  파이프라인이면 복호화가 필요해질 가능성이 크다. pdf-lib은 복호화를 지원하지 않으므로
  직접 구현하거나(`crypto-js`는 이미 의존성) 다른 경로가 필요하다.
- **멀티페이지·다수 배치**: 한 주문에 시트 수십 장을 거는 조판이라면 캐시 설계와 피크
  메모리를 다시 재야 한다. 이번 측정은 파일당 1페이지 기준이다.
- **pdf-lib 유지보수 상황**: 1.17.1이 2021년 11월 이후 마지막 릴리스다. MIT이므로 버그를
  만나면 직접 고쳐 쓰는 것을 가정해야 한다.
