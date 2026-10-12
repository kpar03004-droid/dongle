"""해석기·정리 테스트.  실행: python -m unittest discover collector"""
import json
import unittest
from unittest import mock
from pathlib import Path

from parse import parse_message, shop_of
import collect
import ingest

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "2026-10.jsonl"
ROWS = [json.loads(l) for l in RAW.read_text(encoding="utf-8").splitlines() if l.strip()]


class ParseTest(unittest.TestCase):
    def test_runes(self):
        items = parse_message(ROWS[0]["content"])
        self.assertEqual([i["key"] for i in items], ["화염저항", "호흡", "신속", "성급", "힘"])
        self.assertEqual(items[0], {"key": "화염저항", "group": "화염저항룬", "tier": 1,
                                    "lo": 180, "hi": 270, "prev": 269, "price": 193})
        self.assertEqual(items[4]["tier"], 5)

    def test_cook(self):
        items = parse_message(ROWS[1]["content"])
        self.assertEqual(len(items), 17)
        self.assertEqual(items[0], {"key": "고로케", "group": None, "tier": 0,
                                    "lo": None, "hi": None, "prev": 15, "price": 14})
        last = items[-1]
        self.assertEqual((last["key"], last["tier"], last["lo"], last["hi"], last["price"]),
                         ("갈릭 포크 크로켓", 4, 191, 248, 248))

    def test_paste_variants(self):
        # 화살표 '->', 구분자 '|' 도 읽어야 함
        items = parse_message("[룬 | 힘] | 300 -> 310")
        self.assertEqual((items[0]["key"], items[0]["price"]), ("힘", 310))

    def test_shop_of(self):
        self.assertEqual(shop_of(ROWS[0]["content"]), "alch")
        self.assertEqual(shop_of(ROWS[1]["content"]), "cook")
        self.assertIsNone(shop_of("안녕하세요"))

    def test_not_price(self):
        self.assertEqual(parse_message("동글랜드 TOGETHER 채널을 팔로우했습니다"), [])


class IngestTest(unittest.TestCase):
    def test_accept(self):
        alerts = [
            {"id": "1427000000000000000", "content": ROWS[0]["content"]},   # 연금 알림
            {"id": "1427000000000000000", "content": ROWS[0]["content"]},   # 중복
            {"id": "abc", "content": ROWS[1]["content"]},                   # ID 이상
            {"id": "1427000000000000001", "content": "안녕하세요"},          # 시세 아님
            "이상한 값",
        ]
        new = ingest.accept(alerts, [])
        self.assertEqual([(r["id"], r["shop"]) for r in new], [("1427000000000000000", "alch")])
        self.assertTrue(new[0]["ts"].startswith("20"))


class BuildTest(unittest.TestCase):
    def test_prev_zero_ignored(self):
        row = {"id": "x", "shop": "alch", "ts": "2026-10-12T12:21:00+00:00",
               "content": "[화염저항룬 180~270]\n[룬 ㅣ 화염저항] | 0 → 186"}
        with mock.patch.object(collect.time, "time", return_value=1791800000):
            out = collect.build([row])
        self.assertEqual([s[1] for s in out["shops"]["alch"]["snaps"]], [{"화염저항": 186}])

    def test_slots(self):
        # 12:03 KST → 12:00 칸, 14:58 KST → 15:00 칸
        self.assertEqual(collect.to_slot("2026-10-12T03:03:00+00:00"),
                         collect.to_slot("2026-10-12T03:00:00+00:00"))
        self.assertEqual(collect.to_slot("2026-10-12T05:58:00+00:00"),
                         collect.to_slot("2026-10-12T06:00:00+00:00"))

    def test_build(self):
        with mock.patch.object(collect.time, "time", return_value=1791800000):  # 2026-10-12 고정
            out = collect.build(ROWS)
        alch = out["shops"]["alch"]
        # 9시(직전값) · 12시 · 15시 세 칸
        self.assertEqual([s[1]["화염저항"] for s in alch["snaps"]], [269, 193, 242])
        self.assertEqual(len(out["shops"]["cook"]["items"]), 17)


if __name__ == "__main__":
    unittest.main()
