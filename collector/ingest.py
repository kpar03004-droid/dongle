"""PC 유저스크립트(pc/dongle-alert.user.js)가 보낸 상점 알림을 받아 data/ 에 저장한다.

GitHub Actions 의 repository_dispatch(shop-alert) 이벤트로 실행된다.
    python collector/ingest.py <이벤트 JSON 파일 경로>
보낸 내용은 그대로 믿지 않고, 형식이 맞는 상점 알림만 받는다.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect  # noqa: E402
from parse import shop_of  # noqa: E402

MAX_ALERTS = 100       # 한 번에 받는 알림 수 상한
MAX_LEN = 4000         # 알림 한 개 글자 수 상한


def accept(alerts, rows):
    """형식이 맞고 처음 보는 알림만 골라 raw 줄로 만든다."""
    known = {r["id"] for r in rows}
    new = []
    for a in alerts[:MAX_ALERTS]:
        if not isinstance(a, dict):
            continue
        mid = str(a.get("id", ""))
        content = str(a.get("content", ""))[:MAX_LEN]
        if not mid.isdigit() or mid in known:
            continue
        shop = shop_of(content)
        if not shop:
            continue
        # 시각은 디스코드 메시지 ID(스노플레이크)에서 직접 계산 → 보낸 쪽 시계를 믿지 않음
        ts = datetime.fromtimestamp(((int(mid) >> 22) + 1420070400000) / 1000, timezone.utc).isoformat()
        known.add(mid)
        new.append({"id": mid, "shop": shop, "ts": ts, "content": content, "src": "pc"})
    return new


def main():
    event = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    alerts = (event.get("client_payload") or {}).get("alerts") or []
    rows = collect.load_raw()
    new = accept(alerts if isinstance(alerts, list) else [], rows)
    collect.append_raw(new)
    rows += new
    out = collect.build(rows)
    collect.OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"받은 알림 {len(alerts)}개 중 새로 저장 {len(new)}개")
    for r in new:
        print(f"  [{r['shop']}] {r['ts'][:16]}")


if __name__ == "__main__":
    main()
