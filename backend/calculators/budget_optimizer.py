"""予算最適化モジュール

ダッチベッティング戦略:
  選択した馬のどれが勝っても「リターン ≥ 投資合計」となるよう配分する。

アルゴリズム:
  1. 馬を勝率降順に並べ、以下の条件を満たす限り選択に追加する:
       Σ(1/odds_i) + k×100/budget ≤ 1.0   … (k = 追加後の馬数)
     これにより100円単位の切り上げ丸め誤差を考慮した利益の余白が確保される。
  2. bet_i = ceil(budget / odds_i / 100) × 100  (切り上げ)
     → 任意の的中馬について  bet_i × odds_i ≥ budget ≥ total_bet  が成立
  3. guaranteed_return = min(bet_i × odds_i) ≥ budget ≥ total_bet  → 利益確定
"""

import math
from typing import List

from calculators.expected_value import calculate_expected_values


def optimize_budget(horses: List[dict], budget: int) -> dict:
    """ダッチベッティングによる予算最適配分を算出する。

    Args:
        horses: 馬情報のリスト。各要素に odds_win が必須。
        budget: 総予算（100円単位）。

    Returns:
        {bets, total_bet, guaranteed_return, remaining_budget, coverage}
    """
    empty = {"bets": [], "total_bet": 0, "guaranteed_return": 0,
             "remaining_budget": budget, "coverage": 0.0}

    if not horses or budget <= 0:
        return empty

    # 期待値・勝率を算出
    horses_with_ev = calculate_expected_values(horses)

    # オッズ 1.0 超の馬のみ対象（控除率で1倍以下はありえないが念のため）
    valid = [h for h in horses_with_ev if h.get("odds_win", 0) > 1.0]
    if not valid:
        return empty

    # 勝率降順でソート
    valid.sort(key=lambda h: h.get("win_probability", 0), reverse=True)

    # ── ダッチ対象馬を選択 ──────────────────────────────────────────
    # 条件: inv_sum + 1/o_i + (k+1)×100/budget ≤ 1.0
    #   → budget×(1 - Σ(1/o_j)) ≥ k×100  (切り上げ丸め誤差の余白を保証)
    selected: List[dict] = []
    inv_sum = 0.0
    for horse in valid:
        k_after = len(selected) + 1
        rounding_margin = k_after * 100 / budget
        inv = 1.0 / horse["odds_win"]
        if inv_sum + inv + rounding_margin <= 1.0:
            selected.append(horse)
            inv_sum += inv

    # 1頭も選べない場合（予算が小さすぎる等）は勝率1位のみ
    if not selected:
        selected = [valid[0]]

    # ── 賭け金を計算 (切り上げ: bet_i × odds_i ≥ budget を保証) ──────
    bets = []
    total_bet = 0
    for horse in selected:
        odds = horse["odds_win"]
        wp = horse.get("win_probability", 0.0)

        bet = max(100, math.ceil(budget / odds / 100) * 100)
        total_bet += bet

        if_wins = round(bet * odds)
        expected = round(bet * odds * wp, 2)

        bets.append({
            "horse_id": horse.get("horse_id", ""),
            "horse_name": horse.get("horse_name", ""),
            "recommended_bet": bet,
            "if_wins_return": if_wins,
            "expected_return": expected,
            "odds_win": odds,
            "win_probability": round(wp, 4),
        })

    remaining = max(0, budget - total_bet)

    # guaranteed_return = 選択馬が的中した場合の最低リターン
    # (ceil構成により guaranteed_return ≥ budget ≥ total_bet)
    guaranteed_return = min(b["if_wins_return"] for b in bets) if bets else 0

    # coverage = 選択馬のいずれかが勝つ推定確率
    no_win_prob = 1.0
    for horse in selected:
        no_win_prob *= max(0.0, 1.0 - horse.get("win_probability", 0.0))
    coverage = round(1.0 - no_win_prob, 4)

    return {
        "bets": bets,
        "total_bet": total_bet,
        "guaranteed_return": guaranteed_return,
        "remaining_budget": remaining,
        "coverage": coverage,
    }
