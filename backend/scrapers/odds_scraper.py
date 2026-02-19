"""
netkeiba.comからオッズ・出馬表データを取得するスクレイパー
"""

import re
import time
from typing import List

import pandas as pd
import requests
from bs4 import BeautifulSoup


# 出馬表ページ
SHUTUBA_URL = "https://race.netkeiba.com/race/shutuba.html"
# 単勝オッズページ
ODDS_WIN_URL = "https://race.netkeiba.com/odds/index.html"


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

    return horses


def _fetch_horses(race_id: str) -> List[dict]:
    """出馬表ページから出走馬一覧を取得する。"""
    horses: List[dict] = []

    try:
        url = f"{SHUTUBA_URL}?race_id={race_id}"
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
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
                # 馬番（JavaScript描画のため空の場合はインデックスで代替）
                horse_number_td = row.find("td", class_="Umaban")
                horse_number_text = horse_number_td.get_text(strip=True) if horse_number_td else ""
                try:
                    horse_number = int(horse_number_text)
                except ValueError:
                    horse_number = i + 1

                # 馬名・馬ID
                horse_name_tag = row.find("span", class_="HorseName")
                horse_name = horse_name_tag.get_text(strip=True) if horse_name_tag else ""
                horse_id = ""
                horse_link = row.find("a", href=re.compile(r"/horse/"))
                if horse_link:
                    id_match = re.search(r"/horse/(\d+)", horse_link["href"])
                    if id_match:
                        horse_id = id_match.group(1)

                # 騎手名
                jockey_tag = row.find("a", href=re.compile(r"/jockey/"))
                jockey = jockey_tag.get_text(strip=True) if jockey_tag else ""

                # 斤量
                weight_td = row.find("td", class_="Barei")
                weight_text = weight_td.get_text(strip=True) if weight_td else "0"
                try:
                    weight = float(re.search(r"[\d.]+", weight_text).group())
                except (AttributeError, ValueError):
                    weight = 0.0

                # 枠番（gate number 1-8）
                gate_number = 0
                waku_td = row.find("td", class_="Waku")
                if waku_td:
                    waku_span = waku_td.find("span")
                    if waku_span:
                        for cls in waku_span.get("class", []):
                            m = re.match(r"Waku(\d)", cls)
                            if m:
                                gate_number = int(m.group(1))
                                break

                # 馬体重と変化（例: "480(-4)"）
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
    """単勝・複勝オッズを取得する。馬番をキーとした辞書を返す。"""
    odds_data = {}

    try:
        url = f"{ODDS_WIN_URL}?race_id={race_id}&type=b1"
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        resp.encoding = resp.apparent_encoding or "euc-jp"

        if resp.status_code != 200:
            return odds_data

        soup = BeautifulSoup(resp.text, "lxml")

        # 単勝オッズテーブル
        odds_rows = soup.find_all("tr", class_="")
        for row in odds_rows:
            tds = row.find_all("td")
            if len(tds) >= 3:
                try:
                    num_text = tds[0].get_text(strip=True)
                    odds_text = tds[2].get_text(strip=True)
                    horse_number = int(num_text)
                    odds_win = float(odds_text)
                    odds_data[horse_number] = {
                        "odds_win": odds_win,
                        "odds_place": 0.0,
                    }
                except (ValueError, IndexError):
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
