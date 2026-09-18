# 테스트 실행법

`doc.addPdf` 관련 검증은 두 층으로 되어 있다. 하나는 저장소에 들어간 단위 테스트,
다른 하나는 실제 PDF를 돌려보는 하네스다. 검증 항목이 각각 무엇을 의미하고 현재 결과가
어떤지는 [VERIFICATION.md](VERIFICATION.md)에 있다.

---

## 준비

```sh
npm install
```

node는 `package.json`의 volta 핀(`20.19.4`)이 처리한다. 이 저장소 디렉터리에서 `node -v`가
`v20.19.4`로 나오면 된 것이다. **node 8에서는 테스트가 돌지 않는다** — `jest@29`가
`^14.15.0 || ^16.10.0 || >=18.0.0`을 요구한다.

하네스는 빌드 산출물을 쓰므로 lib/를 고친 뒤에는 빌드를 다시 해야 한다.

```sh
npm run build
```

---

## 1. 단위 테스트

```sh
npx jest unit/pdf_bridge unit/pdf_source unit/pdfs    # 이 기능만
npx jest unit/                                        # 전체 유닛
npx jest unit/pdfs -t "rotated"                        # 이름으로 골라서
```

| 스펙 | 건수 | 대상 |
|---|---|---|
| `tests/unit/pdf_bridge.spec.js` | 15 | pdf-lib 객체 → pdfkit 객체 변환 |
| `tests/unit/pdf_source.spec.js` | 11 | 입력 정규화, 암호화 거부, 박스·회전 기하 |
| `tests/unit/pdfs.spec.js` | 35 | `openPdf`/`placePdf`/`addPdf`, 배치 수학, 캐시, 레이어 |

### 기존 실패 20건에 대하여

`npx jest unit/`을 돌리면 **실패 20건**이 나온다. 이 기능과 무관한, 이전부터 깨져 있던
테스트다. 해당 스펙은 `document`·`markings`·`pdfa1`·`pdfa2`·`pdfa3`·`trailer`·`vector`이고,
대부분 `data[data.length-28]`처럼 출력 청크의 인덱스를 고정해 놓아서 출력이 조금만 달라져도
깨지는 형태다.

기준선을 직접 확인하려면 `lib/document.js`만 되돌려 비교하면 된다.

```sh
git stash push lib/document.js
npx jest unit/ --testPathIgnorePatterns "pdf_bridge" "pdf_source" "pdfs.spec"
git stash pop
```

같은 20건이 나오는 것을 확인할 수 있다. 새로 추가한 세 스펙은 전부 통과한다.

---

## 2. 하네스 — 실제 PDF로 돌리기

모두 `research/addpdf/`에 있고, 빌드된 `js/pdfkit.js`를 통해 실제 API를 호출한다.
`PDFKIT_BUNDLE` 환경변수로 다른 빌드를 지정할 수 있다.

### 2.1 코퍼스 회귀 — `corpus.js`

파일 목록을 받아 전부 배치하고 구조 검증을 돌린다. **변경할 때마다 이걸 돌리는 것이 이
기능의 유지보수 핵심이다.**

```sh
node research/addpdf/corpus.js research/addpdf/corpus.txt
```

목록은 한 줄에 PDF 경로 하나다. 새로 만들려면:

```sh
find /c/Users/harry/Downloads -iname "*.pdf" -size +1k > research/addpdf/corpus.txt
```

실제 생산 파일로 목록을 만들어 두는 것을 권한다. 고객 파일에서 새 예외가 나오면 목록에
추가한다.

### 2.2 프리프레스 수용 검증 — `acceptance.js`

프리프레스 기능을 모두 켠 문서(CMYK OutputIntent + ISO Coated v2 ICC, TrimBox·BleedBox)에
지정한 PDF를 두 번 배치하고, 색 정보까지 원본과 대조한다.

```sh
node research/addpdf/acceptance.js                     # 기본: Altona PDF/X-3
node research/addpdf/acceptance.js <다른파일.pdf>
```

`acceptance-out.pdf`를 남긴다.

### 2.3 레이어 보존 — `check-layers.js`

레이어가 있는 PDF를 배치하고 원본과 출력의 레이어 구조를 대조한다.

```sh
node research/addpdf/check-layers.js <layered.pdf>     # layers-out.pdf를 남긴다
```

레이어가 있는 파일만 골라 돌리려면:

```sh
while read -r p; do f="${p/#\/c\//C:/}";
  [ -f "$f" ] && grep -aq "/OCProperties" "$f" && echo "$f";
done < research/addpdf/corpus.txt > layered.txt

while read -r f; do
  node research/addpdf/check-layers.js "$f" | tail -1
done < layered.txt
```

### 2.4 레이어 구조만 보기 — `inspect-layers.js`

원본이든 산출물이든 레이어 구성을 그대로 출력한다. 문제를 좁힐 때 쓴다.

```sh
node research/addpdf/inspect-layers.js <file.pdf> [pageIndex]
```

### 2.5 교차 검증 — `crosscheck.js`

우리가 쓴 파일을 pdf-lib으로 되읽는다. `Invalid object ref` 경고가 하나라도 나오면 우리가
잘못 쓴 것이다. 문자열이 Name으로 새어나가는 종류의 버그가 여기서 즉시 드러난다.

```sh
node research/addpdf/crosscheck.js research/addpdf/acceptance-out.pdf
```

### 2.6 시각 확인용 1:1 샘플 — `sample-1to1.js`

원본 박스 크기와 같은 시트에 1:1로 배치한다. 원본과 나란히 열어 비교하기 위한 것이다.

```sh
node research/addpdf/sample-1to1.js <file.pdf> [media|crop|trim|bleed|art]
```

### 2.7 프로토타입 하네스 — `prototype/`

방식 비교 단계에서 쓴 코드다. `prototype/bridge.js`는 `lib/`의 구현이 아니라 당시의
참조 구현이므로, 지금 회귀 검증에는 위의 `corpus.js`를 쓴다. 프로토타입의 한계는
[prototype/README.md](prototype/README.md)에 적어 두었다.

---

## 3. 산출물

하네스가 만드는 PDF와 목록 파일은 `.gitignore`에 들어 있다. 저장소에는 커밋되지 않는다.

| 파일 | 만드는 명령 |
|---|---|
| `acceptance-out.pdf` | `acceptance.js` |
| `sample-1to1.pdf` | `sample-1to1.js` |
| `layers-out.pdf` · `sample-layers.pdf` | `check-layers.js` |
| `corpus-results.json` | `corpus.js` |
| `corpus.txt` | 직접 만든다 |

---

## 4. 테스트를 추가할 때

- 실패를 먼저 확인한다. 통과하는 테스트를 나중에 붙이면 그 테스트가 무엇을 잡는지 알 수 없다.
- 픽스처는 코드로 만든다. 단위 테스트의 레이어·회전·TrimBox 샘플은 모두 pdf-lib으로 즉석
  생성하므로 외부 파일에 의존하지 않는다. 저장소 밖 경로를 참조하는 테스트는 만들지 않는다.
- 배치 수학은 출력 연산자로 검증한다. `compress: false`로 문서를 만들면 content 스트림이
  평문이라 `q\n0.5 0 0 -0.5 40 456 cm\n/Fx1 Do\nQ`처럼 그대로 대조할 수 있다.
- 기대값을 계산할 때 반올림된 중간값을 쓰지 않는다. pdfkit은 소수 6자리로 반올림하므로
  정확한 산식으로 계산한 뒤 마지막에 한 번만 반올림해야 어긋나지 않는다.
- `jest`는 jsdom 환경이라 node의 `Buffer`와 환경의 `Uint8Array`가 서로 다른 클래스다.
  pdf-lib에 바이트를 넘길 때는 테스트 안에서
  `new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)`로 변환한다.
