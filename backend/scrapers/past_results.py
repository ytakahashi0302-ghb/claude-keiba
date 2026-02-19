"""
netkeiba.comから過去レース結果を取得するスクレイパー
"""

import re
import time
from datetime import datetime, timedelta
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

from calculators.expected_value import calculate_expected_values


RACE_LIST_URL = "https://race.netkeiba.com/top/race_list_sub.html"
RESULT_URL = "https://race.netkeiba.com/race/result.html"

VENUE_CODE_MAP = {
    "01": "札幌", "02": "函館", "03": "福島", "04": "新潟",
    "05": "東京", "06": "中山", "07": "中京", "08": "京都",
    "09": "阪神", "10": "小倉",
}

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def get_past_races(days: int = 14) -> List[dict]:
    """
    過去 days 日間に開催されたレース一覧を返す（新しい順）。
    """
    races: List[dict] = []
    today = datetime.now()

    for i in range(1, days + 1):
        target = today - timedelta(days=i)
        date_str = target.strftime("%Y%m%d")
        fetched = _fetch_races_for_date(date_str)
        races.extend(fetched)

    if not races:
        return _mock_past_races()

    return races


def get_race_results(race_id: str) -> dict:
    """
    指定レースの結果（着順・オッズ・期待値・払戻）を返す。

    Returns
    -------
    dict
        race_id, race_name, venue, date, course, horses, payouts を含む辞書。
        horses 各要素: ranking, horse_number, horse_name, jockey, odds_win,
                       popularity, time, win_probability, expected_value
        payouts 各要素: type, results[{horse_numbers, amount, popularity}]
    """
    try:
        url = f"{RESULT_URL}?race_id={race_id}"
        resp = requests.get(url, timeout=15, headers=_HEADERS)
        resp.encoding = resp.apparent_encoding or "euc-jp"

        if resp.status_code != 200:
            raise ValueError(f"HTTP {resp.status_code}")

        soup = BeautifulSoup(resp.text, "lxml")

        # レース基本情報
        race_name, venue, date_str, course = _parse_race_info(soup, race_id)

        # 出走馬・着順データ
        horses = _parse_result_table(soup)

        # 期待値を計算（現在公開中のオッズを使用）
        if horses:
            horses = calculate_expected_values(horses)

        # 払い戻しデータ
        payouts = _parse_payouts(soup)

        return {
            "race_id": race_id,
            "race_name": race_name,
            "venue": venue,
            "date": date_str,
            "course": course,
            "horses": horses,
            "payouts": payouts,
        }

    except Exception as e:
        return _mock_result(race_id, str(e))


# ---------------------------------------------------------------------------
# 内部関数
# ---------------------------------------------------------------------------

def _fetch_races_for_date(date_str: str) -> List[dict]:
    """指定日のレース一覧を取得する。"""
    races: List[dict] = []
    try:
        url = f"{RACE_LIST_URL}?kaisai_date={date_str}"
        resp = requests.get(url, timeout=10, headers=_HEADERS)
        resp.encoding = resp.apparent_encoding or "euc-jp"

        if resp.status_code != 200:
            return races

        soup = BeautifulSoup(resp.text, "lxml")
        race_links = soup.find_all("a", href=re.compile(r"race_id=\d+"))

        seen_ids: set = set()
        for link in race_links:
            href = link.get("href", "")
            m = re.search(r"race_id=(\d+)", href)
            if not m:
                continue
            race_id = m.group(1)
            if race_id in seen_ids:
                continue
            seen_ids.add(race_id)

            race_name = link.get_text(strip=True)
            venue = _extract_venue(race_id)
            race_number = _extract_race_number(race_id)

            races.append({
                "race_id": race_id,
                "race_name": race_name if race_name else f"{venue}{race_number}R",
                "course": "",
                "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                "venue": venue,
                "race_number": race_number,
            })

        time.sleep(0.3)

    except Exception:
        pass

    return races


def _parse_race_info(soup: BeautifulSoup, race_id: str):
    """ページからレース基本情報を取得する。"""
    # タイトルからレース名を抽出: "クイーンＣ(G3) 結果・払戻 | 2026年2月14日 東京11R ..."
    title_tag = soup.find("title")
    race_name = ""
    date_str = ""
    venue = _extract_venue(race_id)

    if title_tag:
        title = title_tag.get_text()
        # レース名: タイトルの先頭部分（" 結果・払戻" の前）
        m = re.match(r"^(.+?)\s*(?:結果|オッズ)", title)
        if m:
            race_name = m.group(1).strip()
        # 日付: "2026年2月14日"
        m2 = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", title)
        if m2:
            date_str = f"{m2.group(1)}-{int(m2.group(2)):02d}-{int(m2.group(3)):02d}"
        # 開催場: タイトルの "東京11R" などから
        m3 = re.search(r"([^\s]+?)(\d+)R\s", title)
        if m3:
            venue = m3.group(1)

    # コース情報
    course = ""
    race_data = soup.find("div", class_="RaceData01")
    if race_data:
        text = race_data.get_text()
        m = re.search(r"[芝ダ]\d+m", text)
        if m:
            course = m.group(0)

    return race_name, venue, date_str, course


def _parse_result_table(soup: BeautifulSoup) -> List[dict]:
    """ResultRefund テーブルから出走馬・着順・オッズを取得する。"""
    horses = []
    result_table = soup.find("table", class_="ResultRefund")
    if not result_table:
        return horses

    rows = result_table.find_all("tr")
    for row in rows:
        tds = row.find_all("td")
        if len(tds) < 11:
            continue
        try:
            ranking_text = tds[0].get_text(strip=True)
            try:
                ranking: Optional[int] = int(ranking_text)
            except ValueError:
                ranking = None  # 除外・中止など

            horse_number_text = tds[2].get_text(strip=True)
            horse_number = int(horse_number_text) if horse_number_text.isdigit() else 0

            horse_name = tds[3].get_text(strip=True)
            jockey = tds[6].get_text(strip=True)
            time_str = tds[7].get_text(strip=True)

            popularity_text = tds[9].get_text(strip=True)
            try:
                popularity = int(popularity_text)
            except ValueError:
                popularity = 0

            odds_text = tds[10].get_text(strip=True)
            try:
                odds_win = float(odds_text)
            except ValueError:
                odds_win = 0.0

            horses.append({
                "ranking": ranking,
                "horse_number": horse_number,
                "horse_name": horse_name,
                "jockey": jockey,
                "time": time_str,
                "popularity": popularity,
                "odds_win": odds_win,
                # EV計算用（calculate_expected_values から付加される）
                "win_probability": 0.0,
                "expected_value": 0.0,
            })
        except Exception:
            continue

    return horses


def _parse_payouts(soup: BeautifulSoup) -> List[dict]:
    """払戻テーブルから単勝・複勝などを取得する。"""
    payouts = []
    payout_tables = soup.find_all("table", class_="Payout_Detail_Table")

    for table in payout_tables:
        for row in table.find_all("tr"):
            ths = row.find_all("th")
            tds = row.find_all("td")
            if not ths or len(tds) < 2:
                continue

            bet_type = ths[0].get_text(strip=True)
            numbers_raw = tds[0].get_text(strip=True)
            amounts_raw = tds[1].get_text(strip=True)
            popularity_raw = tds[2].get_text(strip=True) if len(tds) > 2 else ""

            # 複数払戻（複勝など）を分割
            # 金額: "170円640円460円" → ["170", "640", "460"]
            amounts = [a.replace(",", "") for a in re.findall(r"[\d,]+(?=円)", amounts_raw)]
            # 馬番: "125" → ["1", "2", "5"] (1文字ずつ) or "14" (2桁)
            # 複数馬番の場合は金額件数に合わせて分割
            popularities = re.findall(r"\d+人気", popularity_raw)

            results = []
            if len(amounts) <= 1:
                results.append({
                    "horse_numbers": numbers_raw,
                    "amount": int(amounts[0]) if amounts else 0,
                    "popularity": popularities[0] if popularities else "",
                })
            else:
                # 複数払戻（複勝など）
                for j, amt in enumerate(amounts):
                    results.append({
                        "horse_numbers": numbers_raw,
                        "amount": int(amt),
                        "popularity": popularities[j] if j < len(popularities) else "",
                    })

            payouts.append({
                "type": bet_type,
                "results": results,
            })

    return payouts


def _extract_venue(race_id: str) -> str:
    if len(race_id) >= 6:
        return VENUE_CODE_MAP.get(race_id[4:6], "不明")
    return "不明"


def _extract_race_number(race_id: str) -> int:
    if len(race_id) >= 12:
        try:
            return int(race_id[10:12])
        except ValueError:
            pass
    return 0


def _mock_past_races() -> List[dict]:
    """スクレイピング失敗時のモックデータ。"""
    base = datetime.now()
    result = []
    for offset in range(1, 15):
        d = base - timedelta(days=offset)
        if d.weekday() in (5, 6):  # 土日のみ
            date_str = d.strftime("%Y-%m-%d")
            for r in range(1, 13):
                result.append({
                    "race_id": f"MOCK{d.strftime('%Y%m%d')}{r:02d}",
                    "race_name": f"モックレース{r}R",
                    "course": "芝1600m",
                    "date": date_str,
                    "venue": "東京",
                    "race_number": r,
                })
    return result


def _mock_result(race_id: str, error: str) -> dict:
    """結果取得失敗時のモックデータ。"""
    horses_raw = [
        {"horse_number": 1, "horse_name": "サンプルホース", "jockey": "田中", "ranking": 1,
         "time": "1:34.5", "odds_win": 3.5, "popularity": 2, "win_probability": 0.0, "expected_value": 0.0},
        {"horse_number": 2, "horse_name": "テストランナー", "jockey": "佐藤", "ranking": 2,
         "time": "1:34.8", "odds_win": 5.2, "popularity": 4, "win_probability": 0.0, "expected_value": 0.0},
        {"horse_number": 3, "horse_name": "モックスター", "jockey": "鈴木", "ranking": 3,
         "time": "1:35.1", "odds_win": 8.0, "popularity": 5, "win_probability": 0.0, "expected_value": 0.0},
    ]
    horses = calculate_expected_values(horses_raw)
    return {
        "race_id": race_id,
        "race_name": "モックレース（取得失敗）",
        "venue": "東京",
        "date": datetime.now().strftime("%Y-%m-%d"),
        "course": "芝1600m",
        "horses": horses,
        "payouts": [
            {"type": "単勝", "results": [{"horse_numbers": "1", "amount": 350, "popularity": "2人気"}]},
            {"type": "複勝", "results": [
                {"horse_numbers": "1", "amount": 140, "popularity": "2人気"},
                {"horse_numbers": "2", "amount": 210, "popularity": "4人気"},
            ]},
        ],
        "_error": error,
    }
