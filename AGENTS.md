# 말씀 자료실 (malsseum)

주일·수요 말씀을 모아 보는 페이지. <https://patrickdfg.github.io/malsseum/> 로 올라간다.
원래 `sayeon` 저장소의 `malsseum/` 아래 있었는데, 음성이 커져서(약 570MB)
2026-09-14 에 이 저장소로 떼어 냈다. 두 저장소는 같은 호스트(patrickdfg.github.io)라
브라우저가 보기엔 같은 출처다 — 그래서 설정·암호·검색이 그대로 이어진다.

## 대화 규칙
- **시작할 때 먼저 `git pull`**, 끝낼 때 **커밋하고 푸시**. (집·사무실 두 대에서 쓴다)

## 구조
- `index.html` — 말씀 뷰어 (탭에서 성령사연 `/sayeon/`, 월명동 `/sayeon/stones/` 로 간다)
- `malsseum.json.enc` — 잠긴 원고. `audio/*.mp3` + `audio/sync.json` — 음성과 문단 시간표
- `crypt.js`·`settings.js`·`analytics*.js` — sayeon 과 같은 파일(자기완결로 복사해 둠)
- `crypt.json`·`check.enc` — sayeon 과 **같은 소금**이라 같은 암호(7125)로 풀린다

## 원고와 사진은 잠겨 있다
- `.enc` 만 올린다. 브라우저는 `crypt.js`, 도구는 `tools/crypt.py` 로 푼다.
- 도구를 돌릴 때는 환경변수 `SAYEON_PASS`(=7125), 깃허브 일꾼은 저장소 비밀값
  `SAYEON_PASS` 에서 받는다. **이 저장소에도 그 비밀값을 넣어야** 자동 게시가 된다.

## 말씀 추가하기
1. HWP 원고 → `python tools/import_malsseum_hwp.py <파일> --no <번호> --write` (SAYEON_PASS 필요)
2. 현수 음성: `malsseum-tts-request.json` 에 `{"numbers":[...]}` 올리거나 Actions 에서 돌린다.
   한 편 끝날 때마다 저장되고, 이미 만든 편은 건너뛴다.
3. 큰 육성 녹음은 `.upload/` 로 조각내 올리면 `assemble-upload.yml` 이 합치고
   25MB 넘으면 48kbps 모노로 줄인다.

## 편 번호(no)
- 화면은 날짜(`short`, 월/일) 순으로 정렬한다. `no` 는 안 보이는 고유 번호일 뿐.
- 8~9월 육성 13편이 no 1~12·33, 1~7월 TTS 54편이 no 100~153.

## HTML 을 파이썬으로 고치면 끝나고 문법 검사(node --check)를 하자.
