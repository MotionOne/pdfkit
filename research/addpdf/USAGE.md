# doc.addPdf 사용법

외부 PDF의 한 페이지를 현재 pdfkit 페이지 위에 그린다. 원본은 Form XObject로 이식되므로
별색·ICC·폰트·이미지가 바이트 단위로 그대로 실린다. 래스터화하지 않는다.

설계 배경과 실측 근거는 [IMPLEMENTATION.md](IMPLEMENTATION.md), 검증 항목과 결과는
[VERIFICATION.md](VERIFICATION.md)에 있다.

---

## 메서드 세 개

```js
const handle = await doc.openPdf(src, opts);   // 파싱 — PDF 하나당 한 번
doc.placePdf(handle, x, y, opts);              // 배치 — 동기, 원하는 만큼 반복
await doc.addPdf(src, x, y, opts);             // 위 둘의 편의 래퍼
```

파싱만 비동기다. pdf-lib의 파서가 이벤트 루프를 양보하기 때문이고, 배치는 동기이므로
기존 `doc.image()` 호출 흐름 사이에 그대로 끼워 넣을 수 있다.

`src`로 받는 것: 파일 경로 · `Buffer` · `Uint8Array` · `ArrayBuffer` · `data:` URL.
`doc.image()`와 같은 입력 집합이다.

---

## 좌표

`x`, `y`는 **배치 박스의 좌상단**이고 단위는 pt(1/72인치)다. `doc.image()`와 완전히 같다.

```
 (0,0) ─────────────────────────────▶ x
   │
   │      (x, y) ┌───────────────┐   ← y는 페이지 위쪽 기준
   │             │  배치된 PDF   │ h
   │             └───────────────┘
   │                     w
   ▼ y
```

- 좌표를 생략하면 `options.x`/`options.y`를, 그것도 없으면 현재 `doc.x`/`doc.y`를 쓴다
- `y`를 생략해 `doc.y`가 쓰인 경우에만 `doc.y += h`로 커서가 내려간다

---

## 옵션

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `width`, `height` | — | 배치 크기(pt). 하나만 주면 종횡비 유지, 둘 다 주면 늘림 |
| `scale` | — | 배율 |
| `fit: [w,h]` | — | 박스 안에 들어가도록 축소 |
| `cover: [w,h]` | — | 박스를 덮도록 확대 |
| `align` | — | `'center'` \| `'right'` — `fit`/`cover` 안에서 |
| `valign` | — | `'center'` \| `'bottom'` — `fit`/`cover` 안에서 |
| `page` | `0` | 소스 PDF의 페이지 인덱스 (0부터) |
| `box` | `'crop'` | `'media'` \| `'crop'` \| `'trim'` \| `'bleed'` \| `'art'` |
| `pdf_id` | — | 캐시 키. `doc.image()`의 `img_id`와 같은 역할 |

### 크기를 안 주면 1:1

크기 옵션을 하나도 주지 않으면 **원본 박스 크기 그대로(100%)** 배치한다. 이미지와 다른
지점이다. PDF는 pt 단위 실측 크기를 갖고 있어서 조판에서 가장 자주 쓰는 기본값이 1:1이다.

```js
doc.placePdf(art, 0, 0);                   // 원본 크기 그대로
doc.placePdf(art, 0, 0, { width: 283.46 }); // 100mm 폭으로
doc.placePdf(art, 0, 0, { scale: 0.5 });    // 50%
```

### box는 배치 기준 사각형을 고른다

| box | 쓰는 상황 |
|---|---|
| `'trim'` | **조판.** 재단 후 크기 기준으로 앉힌다 |
| `'bleed'` | 블리드를 포함해 앉힌다 |
| `'crop'` | 기본값. 화면에 보이는 영역 |
| `'media'` | 용지 전체 |

요청한 박스가 원본에 없으면 MediaBox로 떨어진다. 뷰어와 같은 동작이다.

```js
const art = await doc.openPdf('artwork.pdf');
art.size(0, 'media');   // { width: 1250.55103, height: 901.88995 }
art.size(0, 'trim');    // { width: 1190.55103, height: 841.88995 }  ← 블리드 30pt 제외
```

---

## 핸들

```js
const art = await doc.openPdf('artwork.pdf');

art.pageCount          // 4
art.size(0, 'trim')    // { width, height } — pt, 원본 /Rotate가 반영된 값
art.rotation(0)        // 90 — 원본 /Rotate
```

핸들은 **그 문서에 묶인다.** 임베드된 Form XObject가 해당 pdfkit 문서의 객체이기 때문이다.
다른 `PDFDocument` 인스턴스에 재사용하면 안 된다. 문서를 새로 만들면 다시 `openPdf`한다.

---

## 실전 예시

### 한 장 배치

```js
const doc = new PDFDocument({ size: [595.28, 841.89], margin: 0 });
doc.pipe(fs.createWriteStream('out.pdf'));

const art = await doc.openPdf(job.artworkPath);
doc.placePdf(art, 20, 40, { box: 'trim', width: 260 });

doc.end();
```

### 한 시트에 여러 장 (임포지션)

같은 PDF를 여러 번 놓아도 Form XObject는 **하나만** 만들어 공유한다. 출력 크기가 장수에
비례해 커지지 않는다.

```js
const art = await doc.openPdf(job.artworkPath);

for (const slot of sheet.slots) {
  doc.placePdf(art, slot.x, slot.y, {
    box: 'trim',
    width: slot.w,
    align: 'center'
  });
}
```

### 멀티페이지 원본

```js
const art = await doc.openPdf('booklet.pdf');

for (let page = 0; page < art.pageCount; page++) {
  if (page > 0) doc.addPage();
  doc.placePdf(art, 0, 0, { page, box: 'trim' });
}
```

### 경로 없이 버퍼로

```js
const bytes = await downloadArtwork(url);
await doc.addPdf(bytes, 20, 40, { pdf_id: job.id, width: 260 });
```

`pdf_id`를 주면 같은 버퍼를 다시 넘겨도 재파싱하지 않는다. 경로로 열 때는 경로가 키가 된다.

---

## 같이 넘어오는 것과 안 넘어오는 것

| | |
|---|---|
| 넘어옴 | 별색(Separation)·DeviceN·ICCBased·DeviceCMYK·Indexed 색공간 |
| 넘어옴 | 임베드 폰트, 이미지, 셰이딩, ExtGState — 원본 바이트 그대로 |
| 넘어옴 | 투명도 그룹(`/Group`) — 블렌딩이 유지된다 |
| 넘어옴 | 레이어(OCG) — 이름·기본 표시 상태·패널 순서·상호배타 그룹까지 |
| 넘어옴 | 원본 페이지의 `/Rotate` — Form Matrix에 반영된다 |
| 안 넘어옴 | 주석·링크·AcroForm 필드 (Form XObject의 한계) |
| 안 넘어옴 | 원본의 `/OutputIntents`·`/TrimBox` — **우리 문서의 것이 유효하다** |

원본의 출력 인텐트를 버리는 것은 의도된 동작이다. 남의 원고를 우리 시트에 앉히는 상황에서
유효한 것은 우리 문서의 출력 조건이다.

---

## 에러

| 상황 | 결과 |
|---|---|
| 암호화 PDF | `Cannot place an encrypted PDF. Remove the encryption first.` |
| PDF가 아닌 입력 | pdf-lib의 파싱 에러가 그대로 올라온다 |
| 페이지 인덱스 초과 | `page 99 is out of range, the PDF has 4 page(s)` |
| 알 수 없는 box 이름 | `unknown box foo` |

배치 중 예외가 나도 문서는 정상적으로 끝낼 수 있다. 실패 경로에서 할당된 객체를 정리하기
때문이다. 이 처리가 없으면 `doc.end()`가 영구히 완료되지 않는다.

---

## 주의사항 세 가지

1. **`openPdf`/`addPdf`는 반드시 `await`한다.** `doc.end()` 이후에 객체가 할당되면 문서가
   완성되지 않는다.
2. **핸들을 문서 간에 재사용하지 않는다.** 위의 "핸들" 절 참고.
3. **앱에서는 파싱을 pdfkit에 맡긴다.** 앱이 pdf-lib을 직접 로드해 객체를 만들어 넘기면
   클래스 판별이 조용히 실패한다(같은 클래스가 두 번 로드되기 때문). 경로나 버퍼만 넘긴다.

---

## 빌드와 배포

앱 쪽 변경은 필요 없다. 기존 절차 그대로다.

```sh
npm install        # pdf-lib 포함 (node 20, package.json의 volta 핀이 처리)
npm run build      # js/pdfkit.js + js/pdfkit.standalone.js
copy.bat           # edicus-prepress로 복사
```

`pdfkit.standalone.js`가 2.73MB에서 3.81MB로 늘어난다(비압축). 앱 프로덕션 빌드는 uglify를
거치므로 최종 증가분은 min 기준 약 525KB다.
