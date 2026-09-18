# prototype — 검증된 참조 구현과 회귀 하네스

[../IMPLEMENTATION.md](../IMPLEMENTATION.md)의 근거가 된 코드다. 프로덕션 코드가 아니고,
`lib/` 구현을 옮길 때의 참조와 회귀 테스트용이다.

| 파일 | 역할 |
|---|---|
| `bridge.js` | **pdf-lib 객체 → pdfkit ref 복사 + Form XObject 생성.** 스펙 4.2~4.4의 참조 구현 |
| `verify.js` | 한 파일을 배치하고 구조 검증 8항목(스펙 8.1)을 돌린다 |
| `batch.js` | 파일 목록을 받아 전부 배치하고 verify와 같은 검사를 돌린다 |
| `miniparse.js` | 검증 전용 최소 PDF 리더. **출력을 독립적으로 되읽기 위한 것**이고 구현에는 쓰지 않는다 |
| `pdfkit-bundle.js` | 어떤 pdfkit 빌드로 돌릴지 결정 |

## 준비

```sh
npm install pdf-lib          # 저장소 루트에서
npm run build                # js/pdfkit.js 생성 (또는 PDFKIT_BUNDLE로 기존 번들 지정)
```

`pdfkit-bundle.js`는 `js/pdfkit.js` → `js/pdfkit.standalone.js` →
`../edicus-prepress/src/app/library/pdfkit/pdfkit.standalone.js` 순으로 찾는다.
`PDFKIT_BUNDLE` 환경변수로 직접 지정할 수 있다.

## 실행

```sh
# 한 파일 검증
node verify.js ../../../examples/kitchen-sink.pdf

# 코퍼스 회귀 — 한 줄에 PDF 경로 하나씩 적은 목록 파일
node batch.js corpus.txt
```

`batch.js`가 내는 기준선은 스펙 8.2에 적어두었다. 코퍼스는 각자 로컬 PDF로 만들어 쓰고,
고객 파일에서 새 예외가 나오면 목록에 추가한다.

## 알려진 한계

- `/Rotate`를 Form Matrix에 굽지 않는다 — 크기만 바꿔치기한다 (스펙 6 참조)
- `/OCProperties` 병합을 하지 않는다
- 문자열을 `Map`의 `toString()` 오버라이드로 내보내는 편법을 쓴다. 번들의 Buffer 판별을
  우회하려는 것인데, 실제 구현에서는 `PDFAbstractReference`를 상속한 래퍼 클래스로
  바꿔야 한다 (스펙 5.3)
- 페이지 인덱스가 0 고정이고 `box` 옵션이 없다 (항상 CropBox ∩ MediaBox)
