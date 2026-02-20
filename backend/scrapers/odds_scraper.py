"""
netkeiba.comからオッズ・出馬表データを取得するスクレイパー
"""

import re
import time
from typing import List

import pandas as pd
import requests
from bs4 import BeautifulSoup

from scrapers._headers import BROWSER_HEADERS, API_HEADERS


# 出馬表ページ
SHUTUBA_URL = "https://race.netkeiba.com/race/shutuba.html"
# オッズAPIエンドポイント（base64+zlib圧縮JSONを返す）
ODDS_API_URL = "https://race.netkeiba.com/api/api_get_jra_odds.html"


def get_horses_with_odds(race_id: str) -> List[dict]:
    """
    指定レースの出走馬一覧とオッズを取得する。

    Parameters
    ----------
    race_id : str
        レースID（例: "202509020611"）

    Returns
    -------
    list[dict]
        各馬の情報を格納した辞書のリスト。
        キー: horse_id, horse_name, jockey, weight, odds_win, odds_place, horse_number
    """
    horses = _fetch_horses(race_id)

    if not horses:
        return _mock_horses(race_id)

    # オッズ情報を取得して馬情報にマージ
    odds_data = _fetch_odds(race_id)
    if odds_data:
        for horse in horses:
            num = horse["horse_number"]
            if num in odds_data:
                horse["odds_win"] = odds_data[num].get("odds_win", 0.0)
                horse["odds_place"] = odds_data[num].get("odds_place", 0.0)
                horse["popularity"] = odds_data[num].get("popularity", 0)

    return horses


def _fetch_horses(race_id: str) -> List[dict]:
    """出馬表ページから出走馬一覧を取得する。"""
    horses: List[dict] = []

    try:
        url = f"{SHUTUBA_URL}?race_id={race_id}"
        resp = requests.get(url, timeout=15, headers={
            **BROWSER_HEADERS,
            "Referer": "https://race.netkeiba.com/top/",
        })
        resp.encoding = resp.apparent_encoding or "euc-jp"

        if resp.status_code != 200:
            return horses

        soup = BeautifulSoup(resp.text, "lxml")

        # pd.read_htmlで出馬表テーブルを取得
        try:
            dfs = pd.read_html(resp.text)
            if not dfs:
                return horses
            df = dfs[0]
        except ValueError:
            return horses

        # BeautifulSoupで馬ID・騎手名を取得
        table = soup.find("table", class_="ShutubaTable")
        if not table:
            return horses

        rows = table.find_all("tr", class_="HorseList")

        for i, row in enumerate(rows):
            try:
                # 枠番: td自体のクラスが Waku1, Waku2, ... の形式
                gate_number = 0
                for td in row.find_all("td"):
                    for cls in td.get("class", []):
                        m = re.match(r"^Waku(\d)$", cls)
                        if m:
                            gate_number = int(m.group(1))
                            break
                    if gate_number:
                        break

                # 馬番: td自体のクラスが Umaban1, Umaban2, ... の形式
                horse_number = i + 1
                for td in row.find_all("td"):
                    for cls in td.get("class", []):
                        if re.match(r"^Umaban\d+$", cls):
                            try:
                                horse_number = int(td.get_text(strip=True))
                            except ValueError:
                                pass
                            break

                # 馬名・馬ID（HorseInfo > span.HorseName > a）
                horse_name = ""
                horse_id = ""
                info_td = row.find("td", class_="HorseInfo")
                if info_td:
                    name_span = info_td.find("span", class_="HorseName")
                    horse_link = (name_span or info_td).find("a", href=re.compile(r"/horse/"))
                    if horse_link:
                        horse_name = horse_link.get_text(strip=True)
                        m = re.search(r"/horse/(\d+)", horse_link["href"])
                        if m:
                            horse_id = m.group(1)

                # 騎手名
                jockey_tag = row.find("a", href=re.compile(r"/jockey/"))
                jockey = jockey_tag.get_text(strip=True) if jockey_tag else ""

                # 斤量: td.Barei は「性齢」(例:牝3)、斤量はその次のtd
                weight = 0.0
                barei_td = row.find("td", class_="Barei")
                if barei_td:
                    next_td = barei_td.find_next_sibling("td")
                    if next_td:
                        try:
                            weight = float(next_td.get_text(strip=True))
                        except ValueError:
                            pass

                # 馬体重と変化（例: "480(-4)"）出走前は空の場合あり
                body_weight = 0
                weight_change = None
                bw_td = row.find("td", class_="Weight")
                if bw_td:
                    bw_text = bw_td.get_text(strip=True)
                    bw_m = re.match(r"(\d+)\(([+-]?\d+)\)", bw_text)
                    if bw_m:
                        body_weight = int(bw_m.group(1))
                        weight_change = int(bw_m.group(2))

                horses.append({
                    "horse_id": horse_id,
                    "horse_name": horse_name,
                    "jockey": jockey,
                    "weight": weight,
                    "odds_win": 0.0,
                    "odds_place": 0.0,
                    "horse_number": horse_number,
                    "gate_number": gate_number,
                    "body_weight": body_weight,
                    "weight_change": weight_change,
                })

            except Exception:
                continue

        time.sleep(0.5)

    except Exception:
        pass

    return horses


def _fetch_odds(race_id: str) -> dict:
    """単勝オッズをAPIから取得する。馬番をキーとした辞書を返す。

    netkeiba.comのオッズはJavaScript経由でAJAX取得されるため、
    HTMLページではなくAPIエンドポイントを直接叩く。
    必須パラメータ: type=1, action=init, pid=api_get_jra_odds
    レスポンスの data フィールドは JSON オブジェクトとして返される。
    """
    odds_data = {}

    try:
        params = {
            "race_id": race_id,
            "type": "1",            # 1 = 単勝・複勝（typeはbXではなく整数）
            "action": "init",       # 初回ロード
            "sort": "no",
            "isPremium": "0",
            "pid": "api_get_jra_odds",
            "input": "UTF-8",
        }
        resp = requests.get(ODDS_API_URL, params=params, timeout=15, headers={
            **API_HEADERS,
            "Referer": f"https://race.netkeiba.com/race/shutuba.html?race_id={race_id}",
        })

        if resp.status_code != 200:
            return odds_data

        result = resp.json()

        # data が空ならオッズ未公開
        raw_data = result.get("data")
        if not raw_data:
            return odds_data

        # data は JSON オブジェクト（dict）として返される
        # 構造: raw_data["odds"]["1"]["01"] = [odds_win, ?, popularity_rank]
        win_odds_map = raw_data.get("odds", {}).get("1", {})

        for horse_key, row in win_odds_map.items():
            try:
                horse_number = int(horse_key)
                odds_win = float(row[0])
                popularity = int(row[2]) if len(row) > 2 and row[2] else 0
                odds_data[horse_number] = {
                    "odds_win": odds_win,
                    "odds_place": 0.0,
                    "popularity": popularity,
                }
            except (ValueError, IndexError, TypeError):
                continue

        time.sleep(0.5)

    except Exception:
        pass

    return odds_data


def _mock_horses(race_id: str) -> List[dict]:
    """開発用モックデータを返す。"""
    return [
        {
            "horse_id": "2021104321",
            "horse_name": "サンプルホース",
            "jockey": "田中太郎",
            "weight": 57.0,
            "odds_win": 3.5,
            "odds_place": 1.8,
            "horse_number": 1,
        },
        {
            "horse_id": "2021104322",
            "horse_name": "テストランナー",
            "jockey": "佐藤花子",
            "weight": 55.0,
            "odds_win": 5.2,
            "odds_place": 2.1,
            "horse_number": 2,
        },
        {
            "horse_id": "2021104323",
            "horse_name": "モックスター",
            "jockey": "鈴木一郎",
            "weight": 56.0,
            "odds_win": 8.0,
            "odds_place": 3.0,
            "horse_number": 3,
        },
        {
            "horse_id": "2021104324",
            "horse_name": "デバッグキング",
            "jockey": "高橋次郎",
            "weight": 57.0,
            "odds_win": 12.5,
            "odds_place": 4.5,
            "horse_number": 4,
        },
        {
            "horse_id": "2021104325",
            "horse_name": "コードブレイカー",
            "jockey": "山田三郎",
            "weight": 54.0,
            "odds_win": 20.0,
            "odds_place": 6.0,
            "horse_number": 5,
        },
        {
            "horse_id": "2021104326",
            "horse_name": "アルゴリズム",
            "jockey": "渡辺四郎",
            "weight": 56.0,
            "odds_win": 35.0,
            "odds_place": 8.5,
            "horse_number": 6,
        },
        {
            "horse_id": "2021104327",
            "horse_name": "パイソニスタ",
            "jockey": "伊藤五郎",
            "weight": 55.0,
            "odds_win": 50.0,
            "odds_place": 12.0,
            "horse_number": 7,
        },
        {
            "horse_id": "2021104328",
            "horse_name": "ラストホープ",
            "jockey": "中村六郎",
            "weight": 57.0,
            "odds_win": 80.0,
            "odds_place": 18.0,
            "horse_number": 8,
        },
    ]
