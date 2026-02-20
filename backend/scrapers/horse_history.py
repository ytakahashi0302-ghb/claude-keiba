"""
netkeiba.comから馬の過去レース成績を取得するスクレイパー。

各馬について直近 N 走の成績（着順・タイム・上り3F・体重変化）を取得し、
期待値計算の入力として利用する。
"""

import re
import time
from typing import List, Dict, Optional

import requests
from bs4 import BeautifulSoup

from scrapers._headers import BROWSER_HEADERS


HORSE_URL = "https://db.netkeiba.com/horse/{horse_id}/"

# モジュールレベルキャッシュ（セッション中に同じ馬を重複取得しない）
_CACHE: Dict[str, List[dict]] = {}


def get_horse_history(horse_id: str, n_races: int = 5) -> List[dict]:
    """
    馬の直近 n_races 走の成績を返す。

    Returns
    -------
    list of dict, 各要素:
        ranking      : int | None  着順（除外・中止は None）
        field_size   : int         出走頭数
        last_3f      : float       上り3ハロン（秒、0 = 不明）
        weight_change: int | None  馬体重変化（kg）
    """
    if not horse_id:
        return []

    if horse_id in _CACHE:
        return _CACHE[horse_id][:n_races]

    try:
        url = HORSE_URL.format(horse_id=horse_id)
        resp = requests.get(url, timeout=15, headers={
            **BROWSER_HEADERS,
            "Referer": "https://db.netkeiba.com/",
        })
        resp.encoding = resp.apparent_encoding or "euc-jp"

        if resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "lxml")
        history = _parse_history(soup)
        _CACHE[horse_id] = history
        time.sleep(0.25)
        return history[:n_races]

    except Exception:
        return []


def clear_cache() -> None:
    """キャッシュをクリアする（テスト用）。"""
    _CACHE.clear()


# ---------------------------------------------------------------------------
# 内部パーサ
# ---------------------------------------------------------------------------

def _parse_history(soup: BeautifulSoup) -> List[dict]:
    """過去成績テーブルを解析する。"""
    races = []

    # テーブルを特定（複数のクラス候補を試みる）
    table = (
        soup.find("table", class_="db_h_race_results")
        or soup.find("table", class_="race_table_01")
    )
    if not table:
        return races

    rows = table.find_all("tr")
    if not rows:
        return races

    # ヘッダー行からカラムインデックスを動的に取得
    header_row = rows[0]
    headers = [th.get_text(strip=True) for th in header_row.find_all(["th", "td"])]
    idx = _build_column_index(headers)

    for row in rows[1:]:
        tds = row.find_all("td")
        if len(tds) < 5:
            continue
        try:
            entry = _parse_row(tds, idx)
            if entry:
                races.append(entry)
        except Exception:
            continue

    return races


def _build_column_index(headers: List[str]) -> Dict[str, int]:
    """ヘッダー名からカラムインデックスを構築する。"""
    mapping: Dict[str, int] = {}
    keywords = {
        "ranking": ["着順", "着"],
        "field_size": ["頭数", "頭"],
        "last_3f": ["上り", "上がり"],
        "body_weight": ["馬体重", "体重"],
    }
    for col_name, kws in keywords.items():
        for i, header in enumerate(headers):
            if any(kw in header for kw in kws):
                mapping[col_name] = i
                break

    # フォールバック: netkeiba の典型的な列配置
    defaults = {"ranking": 10, "field_size": 6, "last_3f": 19, "body_weight": 20}
    for k, v in defaults.items():
        mapping.setdefault(k, v)

    return mapping


def _parse_row(tds, idx: Dict[str, int]) -> Optional[dict]:
    """1行をパースして成績辞書を返す。"""
    def safe_td(i: int) -> str:
        if i < len(tds):
            return tds[i].get_text(strip=True)
        return ""

    # 着順
    ranking: Optional[int] = None
    rank_text = safe_td(idx["ranking"])
    try:
        ranking = int(rank_text)
    except ValueError:
        pass  # 除外・中止は None のまま

    # 出走頭数
    field_size = 0
    try:
        field_size = int(safe_td(idx["field_size"]))
    except ValueError:
        pass

    # 上り3ハロン
    last_3f = 0.0
    try:
        last_3f = float(safe_td(idx["last_3f"]))
    except ValueError:
        pass

    # 馬体重と変化
    weight_change: Optional[int] = None
    bw_text = safe_td(idx["body_weight"])
    bw_m = re.match(r"(\d+)\(([+-]?\d+)\)", bw_text)
    if bw_m:
        weight_change = int(bw_m.group(2))

    # 着順が None かつ頭数が 0 の場合は有効なレース行でない可能性あり
    if ranking is None and field_size == 0:
        return None

    return {
        "ranking": ranking,
        "field_size": field_size,
        "last_3f": last_3f,
        "weight_change": weight_change,
    }
