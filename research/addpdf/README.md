# doc.addPdf — 외부 PDF 페이지 배치

외부 PDF의 한 페이지를 현재 pdfkit 페이지에 Form XObject로 배치하는 기능. 파싱은 pdf-lib이
맡고 최종 파일은 지금처럼 pdfkit이 쓴다. 래스터화하지 않으므로 별색·ICC·폰트·이미지가
바이트 단위로 그대로 실린다.

| 문서 | 읽는 사람 |
|---|---|
| [USAGE.md](USAGE.md) | 이 API를 호출할 사람 — 메서드, 좌표 규약, 옵션, 실전 예시 |
| [TESTING.md](TESTING.md) | 코드를 고칠 사람 — 단위 테스트와 하네스 실행법 |
| [VERIFICATION.md](VERIFICATION.md) | 리뷰할 사람 — 테스트 샘플, 검증 항목의 의미, 실측 결과 |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | 설계를 확인할 사람 — 방식 선정 근거, 내부 구조, 지켜야 할 제약 |

세 가지 구현 방식을 각각 만들어 로컬 PDF 60개로 비교한 결과와 선택 근거는
[팀 공유 문서](https://claude.ai/code/artifact/cd6a55cc-0d34-4789-b745-5942c30573e5)에 있다.

## 빠른 시작

```js
const art = await doc.openPdf('artwork.pdf');
doc.placePdf(art, 20, 40, { box: 'trim', width: 260 });
```

## 현재 상태

- 단위 테스트 61건 통과, 기존 테스트 회귀 0건
- 실제 PDF 60개 중 59개 성공 (암호화 1건은 설계대로 거부)
- 레이어가 있는 파일 13개 전부 레이어 구조 유지
- 남은 확인: Acrobat/RIP 시각 확인, Electron 렌더러 로드 ([VERIFICATION.md](VERIFICATION.md) 5절)
