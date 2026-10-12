"""디스코드에서 새 시세 알림을 가져와 data/ 폴더에 쌓는 프로그램.

GitHub Actions가 3시간마다 이 파일을 실행한다.
1) 디스코드 채널에서 지난번 이후 새 메시지만 가져와 data/raw/YYYY-MM.jsonl 에 원문 그대로 덧붙임
2) 원문 전체를 다시 읽어 사이트용 data/prices.json 을 새로 만듦
   (해석 규칙을 고치면 과거 기록에도 바로 반영되도록 매번 원문에서 다시 만든다)

봇 토큰은 환경변수 DISCORD_BOT_TOKEN 으로만 받는다. (코드나 파일에 절대 적지 않음)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse import parse_message, shop_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT = ROOT / "data" / "prices.json"
CONFIG = json.loads((ROOT / "collector" / "config.json").read_text(encoding="utf-8"))

KST = timezone(timedelta(hours=9))
KEEP_DAYS = 90          # prices.json 에 담을 기간 (원문 raw 는 전부 보관)
SLOT_HOURS = 3          # 상점은 0·3·6·…·21시(한국 시간)에 갱신
API = "https://discord.com/api/v10"


# ---------- 디스코드 ----------
def discord_get(path, token):
    """디스코드 API에 GET 요청. 너무 자주 부르면(429) 기다렸다 다시 시도."""
    req = urllib.request.Request(API + path, headers={
        "Authorization": "Bot " + token,
        "User-Agent": "DiscordBot (https://github.com/kpar03004-droid/dongle, 1.0)",
    })
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = float(json.loads(e.read().decode() or "{}").get("retry_after", 2))
                time.sleep(wait + 0.5)
                continue
            raise
    raise RuntimeError("디스코드가 계속 너무 많은 요청이라고 합니다: " + path)


def fetch_new(channel_id, after_id, token):
    """after_id 이후 메시지를 오래된 순으로 전부 가져온다. 처음이면 최근 300개."""
    got = []
    if after_id:
        cursor = after_id
        while True:
            page = discord_get(f"/channels/{channel_id}/messages?limit=100&after={cursor}", token)
            if not page:
                break
            got.extend(page)
            cursor = max(page, key=lambda m: int(m["id"]))["id"]
            if len(page) < 100:
                break
    else:
        before = None
        for _ in range(3):
            q = "?limit=100" + (f"&before={before}" if before else "")
            page = discord_get(f"/channels/{channel_id}/messages{q}", token)
            if not page:
                break
            got.extend(page)
            before = min(page, key=lambda m: int(m["id"]))["id"]
            if len(page) < 100:
                break
    got.sort(key=lambda m: int(m["id"]))
    return got


def text_channels(token):
    """봇이 들어가 있는 서버의 글 채널을 전부 찾는다.
    채널 이름은 상관없음 — 어느 상점 알림인지는 메시지 내용으로 구분한다."""
    found = []
    for guild in discord_get("/users/@me/guilds", token):
        for ch in discord_get(f"/guilds/{guild['id']}/channels", token):
            if ch.get("type") in (0, 5):  # 글 채널 · 공지 채널
                found.append(ch)
                print(f"채널: {guild['name']} #{ch['name']}")
    return found


# ---------- 원문 보관 ----------
def load_raw():
    rows = []
    for f in sorted(RAW_DIR.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def append_raw(rows):
    for row in rows:
        month = row["ts"][:7]
        with open(RAW_DIR / f"{month}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


# ---------- prices.json 만들기 ----------
def to_slot(ts_iso):
    """메시지 시각을 가장 가까운 갱신 시각(3시간 단위, 한국 시간)으로 맞춘다."""
    dt = datetime.fromisoformat(ts_iso).astimezone(KST)
    start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    slots = round((dt - start).total_seconds() / 3600 / SLOT_HOURS)
    return int((start + timedelta(hours=slots * SLOT_HOURS)).timestamp())


def build(rows):
    cutoff = time.time() - KEEP_DAYS * 86400
    shops = {}
    for row in sorted(rows, key=lambda r: r["ts"]):
        items = parse_message(row["content"])
        if not items:
            continue  # 팔로우 안내 같은 시세 아닌 메시지
        slot = to_slot(row["ts"])
        if slot < cutoff:
            continue
        shop = shops.setdefault(row["shop"], {"items": {}, "snaps": {}})
        snap = shop["snaps"].setdefault(slot, {})
        for it in items:
            # 품목 정보는 가장 최근 메시지 기준으로 덮어씀 (범위가 바뀌어도 따라감)
            shop["items"][it["key"]] = {k: it[k] for k in ("key", "group", "tier", "lo", "hi")}
            snap[it["key"]] = it["price"]
            # 직전값(prev)도 기록: 수집이 한 번 빠졌을 때 이전 칸을 채울 수 있음
            # 직전값이 0이면 상점이 초기화된 뒤 첫 알림이라 기록하지 않음
            if it["prev"] > 0:
                prev_slot = slot - SLOT_HOURS * 3600
                prev_snap = shop["snaps"].setdefault(prev_slot, {})
                prev_snap.setdefault(it["key"], it["prev"])
    out = {"version": 1, "updated": int(time.time()), "slot_hours": SLOT_HOURS, "shops": {}}
    for name, shop in shops.items():
        out["shops"][name] = {
            "label": CONFIG["channels"].get(name, {}).get("label", name),
            "items": list(shop["items"].values()),
            "snaps": [[t, shop["snaps"][t]] for t in sorted(shop["snaps"]) if t >= cutoff],
        }
    return out


def collect_once(token, channels, rows, known):
    """채널마다 지난번 이후 새 시세 알림을 가져와 rows 에 더하고, 새로 생긴 줄을 돌려준다."""
    new_rows = []
    for ch in channels:
        last = max((int(r["id"]) for r in rows if r.get("ch") == ch["id"]), default=None)
        try:
            msgs = fetch_new(ch["id"], str(last) if last else None, token)
        except urllib.error.HTTPError as e:
            print(f"  #{ch['name']} 읽기 실패 ({e.code}) — 봇에게 이 채널 보기 권한이 없을 수 있어요")
            continue
        if msgs:
            # 진단용: 읽은 메시지 수 · 내용이 있는 수 · 임베드 수 · 마지막 메시지 앞부분
            with_text = sum(1 for m in msgs if m.get("content"))
            with_embed = sum(1 for m in msgs if m.get("embeds"))
            last_m = msgs[-1]
            print(f"  #{ch['name']}: 메시지 {len(msgs)}개 (내용 있음 {with_text} · 임베드 {with_embed}) "
                  f"마지막 {last_m['timestamp'][:16]} type={last_m.get('type')} "
                  f"내용={(last_m.get('content') or '')[:30]!r}")
        for m in msgs:
            shop = shop_of(m.get("content") or "")
            if m["id"] in known or not shop:
                continue
            known.add(m["id"])
            new_rows.append({"id": m["id"], "ch": ch["id"], "shop": shop, "ts": m["timestamp"], "content": m["content"]})
    append_raw(new_rows)
    rows += new_rows
    return new_rows


def main():
    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    wait = "--wait" in sys.argv   # 다음 갱신까지 기다렸다가 알림이 올라오면 바로 가져오는 모드
    rows = load_raw()
    if token:
        known = {r["id"] for r in rows}
        channels = text_channels(token)
        new_rows = collect_once(token, channels, rows, known)
        if wait and not new_rows:
            # 새 알림이 올라올 때까지 10초마다 확인 (최대 3시간 20분).
            # 알림이 오면 다른 상점 알림도 20초 더 확인하고 끝냄 → 저장 후 다음 실행이 이어서 기다림.
            # 상점 알림 시각이 정확히 3시간 간격이 아니어도 놓치지 않게 '정시'에 의존하지 않는다.
            start = time.time()
            print("새 알림을 기다립니다 (10초마다 확인)")
            while time.time() - start < 200 * 60:
                time.sleep(10)
                got = collect_once(token, channels, rows, known)
                if got:
                    new_rows += got
                    print(f"{datetime.now(KST):%H:%M:%S} 알림 받음 → 20초 더 확인하고 저장")
                    for _ in range(2):
                        time.sleep(10)
                        new_rows += collect_once(token, channels, rows, known)
                    break
        for shop in CONFIG["channels"]:
            print(f"[{shop}] 새 시세 알림 {sum(1 for r in new_rows if r['shop'] == shop)}개")
    else:
        print("DISCORD_BOT_TOKEN 없음 → 수집은 건너뛰고 prices.json 만 다시 만듭니다")
    out = build(rows)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for name, s in out["shops"].items():
        print(f"[{name}] 품목 {len(s['items'])}개 · 기록 {len(s['snaps'])}칸")


if __name__ == "__main__":
    main()
