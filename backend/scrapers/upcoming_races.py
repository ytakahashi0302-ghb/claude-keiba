"""
netkeiba.comから出走予定レース一覧を取得するスクレイパー
"""

import re
import time
from datetime import datetime, timedelta
from typing import List

import requests
from bs4 import BeautifulSoup

from scrapers._headers import BROWSER_HEADERS


# netkeiba.comのレース一覧ページ
RACE_LIST_URL = "https://race.netkeiba.com/top/race_list_sub.html"

# 開催場コード -> 開催場名のマッピング
VENUE_CODE_MAP = {
    "01": "札幌", "02": "函館", "03": "福島", "04": "新潟",
    "05": "東京", "06": "中山", "07": "中京", "08": "京都",
    "09": "阪神", "10": "小倉",
}


def get_upcoming_races() -> List[dict]:
    """
    今日・明日の出走予定レース一覧を取得する。

    Returns
    -------
    list[dict]
        各レース情報を格納した辞書のリスト。
        キー: race_id, race_name, course, date, venue, race_number
    """
    races: List[dict] = []

    today = datetime.now()
    # 今日から7日後まで検索（週末の開催をカバー）
    target_dates = [today + timedelta(days=i) for i in range(7)]

    for target_date in target_dates:
        date_str = target_date.strftime("%Y%m%d")
        fetched = _fetch_races_for_date(date_str)
        races.extend(fetched)

    if not races:
        return _mock_races()

    return races


def _fetch_races_for_date(date_str: str) -> List[dict]:
    """指定日のレース一覧をnetkeiba.comから取得する。"""
    races: List[dict] = []

    try:
        url = f"{RACE_LIST_URL}?kaisai_date={date_str}"
        resp = requests.get(url, timeout=15, headers={
            **BROWSER_HEADERS,
            "Referer": "https://race.netkeiba.com/top/",
        })
        resp.encoding = resp.apparent_encoding or "euc-jp"

        if resp.status_code != 200:
            return races

        soup = BeautifulSoup(resp.text, "lxml")

        # 各レースのリンクを取得
        race_links = soup.find_all("a", href=re.compile(r"race_id=\d+"))

        seen_ids: set = set()
        for link in race_links:
            href = link.get("href", "")
            race_id_match = re.search(r"race_id=(\d+)", href)
            if not race_id_match:
                continue

            race_id = race_id_match.group(1)
            # 重複を除外
            if race_id in seen_ids:
                continue
            seen_ids.add(race_id)

            race_name = link.get_text(strip=True)

            # race_idからメタ情報を抽出 (例: 202509020611)
            # 形式: {year:4}{place:2}{kai:2}{day:2}{race_number:2}
            venue = _extract_venue(race_id)
            race_number = _extract_race_number(race_id)
            course = _extract_course_from_name(race_name)

            races.append({
                "race_id": race_id,
                "race_name": race_name if race_name else f"{venue}{race_number}R",
                "course": course,
                "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                "venue": venue,
                "race_number": race_number,
            })

        time.sleep(0.5)

    except Exception:
        pass

    return races


def _extract_venue(race_id: str) -> str:
    """race_idから開催場名を取得する。"""
    if len(race_id) >= 6:
        place_code = race_id[4:6]
        return VENUE_CODE_MAP.get(place_code, "不明")
    return "不明"


def _extract_race_number(race_id: str) -> int:
    """race_idからレース番号を取得する。"""
    if len(race_id) >= 12:
        return int(race_id[10:12])
    return 0


def _extract_course_from_name(race_name: str) -> str:
    """レース名からコース情報を推測する（簡易）。"""
    if "ダ" in race_name or "ダート" in race_name:
        return "ダート"
    if "芝" in race_name:
        return "芝"
    return ""


def _mock_races() -> List[dict]:
    """開発用モックデータを返す。"""
    today = datetime.now().strftime("%Y-%m-%d")
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    return [
        {
            "race_id": "202609010101",
            "race_name": "3歳未勝利",
            "course": "芝1600m",
            "date": today,
            "venue": "東京",
            "race_number": 1,
        },
        {
            "race_id": "202609010102",
            "race_name": "3歳未勝利",
            "course": "ダート1400m",
            "date": today,
            "venue": "東京",
            "race_number": 2,
        },
        {
            "race_id": "202609010105",
            "race_name": "4歳以上1勝クラス",
            "course": "芝2000m",
            "date": today,
            "venue": "東京",
            "race_number": 5,
        },
        {
            "race_id": "202609010111",
            "race_name": "東京メインレース",
            "course": "芝1800m",
            "date": today,
            "venue": "東京",
            "race_number": 11,
        },
        {
            "race_id": "202609010112",
            "race_name": "4歳以上2勝クラス",
            "course": "ダート1600m",
            "date": today,
            "venue": "東京",
            "race_number": 12,
        },
        {
            "race_id": "202606010201",
            "race_name": "3歳未勝利",
            "course": "芝1200m",
            "date": tomorrow,
            "venue": "中山",
            "race_number": 1,
        },
        {
            "race_id": "202606010211",
            "race_name": "中山メインレース",
            "course": "芝2500m",
            "date": tomorrow,
            "venue": "中山",
            "race_number": 11,
        },
    ]
