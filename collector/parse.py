"""상점알리미 메시지 한 개를 읽어서 품목별 가격으로 바꾸는 해석기.

메시지 모양(연금술사):
    [화염저항룬 180~270]          ← 묶음 제목 + 가격 범위
    🧪[룬 ㅣ 화염저항] | 269 → 193  ← 품목 | 직전값 → 지금값

메시지 모양(요리사):
    🍳[고로케] | 15 → 14            ← 묶음 제목이 없는 품목도 있음
    [1차 요리 48~62]
    🍳[아스파라거스 샐러드] | 61 → 60
"""
import re

# 묶음 제목: [이름 숫자~숫자] — 줄 전체가 이 모양일 때만
GROUP_RE = re.compile(r"^\[\s*([^\]|]+?)\s+(\d+)\s*~\s*(\d+)\s*\]$")
# 품목 줄: [이름] | 숫자 → 숫자  (화살표는 →, ->, > 모두 허용)
ITEM_RE = re.compile(r"\[\s*([^\]]+?)\s*\]\s*\|\s*(\d+)\s*(?:→|->|>)\s*(\d+)")
# "룬 ㅣ 화염저항" 처럼 앞에 붙은 분류 표시를 떼어낼 때 쓰는 구분자
SEP_RE = re.compile(r"\s*[ㅣ|]\s*")
TIER_RE = re.compile(r"(\d+)\s*차")


def clean_name(raw):
    """'룬 ㅣ 화염저항' → '화염저항', '고로케' → '고로케'."""
    parts = [p for p in SEP_RE.split(raw.strip()) if p]
    return parts[-1].strip() if parts else raw.strip()


def parse_message(text):
    """메시지 글자를 받아 품목 목록을 돌려준다. 못 읽으면 빈 목록.

    돌려주는 항목 하나: {key, group, tier, lo, hi, prev, price}
    """
    items = []
    group = None  # 지금 읽고 있는 묶음 {name, lo, hi, tier}
    group_count = 0
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        g = GROUP_RE.match(line)
        if g:
            group_count += 1
            name = g.group(1).strip()
            t = TIER_RE.search(name)
            group = {
                "name": name,
                "lo": int(g.group(2)),
                "hi": int(g.group(3)),
                # "1차 요리"처럼 차수가 적혀 있으면 그걸, 아니면 나온 순서(룬은 1~5차 순서로 나옴)
                "tier": int(t.group(1)) if t else group_count,
            }
            continue
        m = ITEM_RE.search(line)
        if m:
            items.append({
                "key": clean_name(m.group(1)),
                "group": group["name"] if group else None,
                "tier": group["tier"] if group else 0,
                "lo": group["lo"] if group else None,
                "hi": group["hi"] if group else None,
                "prev": int(m.group(2)),
                "price": int(m.group(3)),
            })
    return items


RUNE_RE = re.compile(r"\[\s*룬\s*[ㅣ|]")


def shop_of(text):
    """메시지가 어느 상점 알림인지: 'alch'(룬이 있음) · 'cook'(그 외 시세) · None(시세 아님)."""
    if not parse_message(text):
        return None
    return "alch" if RUNE_RE.search(text) else "cook"
