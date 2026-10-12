# 동글랜드 시세 자동 수집

디스코드 `#연금술사-변동상점`, `#요리사-변동상점` 알림을 3시간마다 자동으로 모아서
룬 계산기 · 요리사 계산기 맨 위에 **지금 가격 + 30일 추이**를 보여 줍니다.

```
상점알리미 → (채널 팔로우) → 내 디스코드 서버 → GitHub Actions(3시간마다) → data/prices.json → 사이트
```

| 폴더 | 내용 |
|---|---|
| `collector/` | 디스코드에서 메시지를 가져와 해석하는 파이썬 프로그램 + 테스트 |
| `collector/config.json` | 읽어 올 디스코드 채널 ID |
| `data/raw/` | 상점 알림 원문 (월별, 지우지 않음) |
| `data/prices.json` | 사이트가 불러가는 정리본 (원문에서 매번 새로 만듦) |
| `site/` | EdgeOne에 올리는 사이트 (`index.html` 룬 · `cook.html` 요리 · `tracker.js` 공용 그래프) |

## 처음 설정

1. **내 디스코드 서버**를 만들고 글 채널 `연금-시세`, `요리-시세`를 만든다.
2. 동글랜드 `#연금술사-변동상점` → 아래 **팔로우** → 내 서버 `#연금-시세`. 요리사도 같은 방법으로 `#요리-시세`에 연결한다.
3. <https://discord.com/developers/applications> → **New Application** → **Bot** 탭
   - **Reset Token**으로 토큰을 복사한다 (한 번만 보임, **채팅이나 파일에 절대 붙여넣지 않기**)
   - **MESSAGE CONTENT INTENT** 켜고 저장
   - **OAuth2 → URL Generator**: scope `bot`, 권한 `View Channels` + `Read Message History` → 나온 주소로 내 서버에 초대
4. 이 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   이름 `DISCORD_BOT_TOKEN`, 값은 3번 토큰
5. (채널 ID는 필요 없음 — 봇이 들어간 서버의 모든 글 채널을 읽고, 메시지 내용으로 연금·요리를 구분합니다)
6. **Actions → 시세 수집 → Run workflow**로 한 번 돌려 본다. 초록 체크가 뜨고 `data/raw/`에 새 줄이 생기면 성공.

## 사이트 올리기 (EdgeOne)

`site/` 폴더 안의 세 파일을 그대로 올리면 됩니다. 시세는 사이트가 열릴 때 GitHub에서 불러오므로
**시세가 바뀔 때마다 다시 올릴 필요는 없고**, 계산기 코드를 고쳤을 때만 올립니다.

## 확인

```
python -m unittest discover -s collector   # 해석기 테스트
python collector/collect.py                # 토큰 없이 실행하면 prices.json 만 다시 만듦
```
