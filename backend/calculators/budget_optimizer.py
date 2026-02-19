"""予算最適化モジュール

ケリー基準に基づき、各馬への最適なベット配分を算出する。
"""

from typing import List

from calculators.expected_value import calculate_expected_values


def optimize_budget(horses: List[dict], budget: int) -> List[dict]:
    """ケリー基準による予算最適配分を算出する。

    Args:
        horses: 馬情報のリスト。各要素に odds_win (単勝オッズ) が必須。
        budget: 総予算（円）。

    Returns:
        各馬の推奨ベット額と期待リターンを含むリスト。
        各要素: {horse_id, horse_name, recommended_bet, expected_return, kelly_fraction}
    """
    if not horses or budget <= 0:
        return []

    # 期待値を算出
    horses_with_ev = calculate_expected_values(horses)

    # ケリー比率を計算
    kelly_entries = []
    for horse in horses_with_ev:
        odds = horse["odds_win"]
        p = horse["win_probability"]
        q = 1.0 - p
        b = odds - 1.0  # 純利益倍率

        if b <= 0:
            kelly_fraction = 0.0
        else:
            kelly_fraction = (b * p - q) / b

        # 期待値がマイナスの馬はベットしない
        if kelly_fraction <= 0:
            kelly_fraction = 0.0

        # ハーフケリー（過大投資を防ぐ）
        half_kelly = 0.5 * kelly_fraction

        kelly_entries.append({
            "horse": horse,
            "kelly_fraction": kelly_fraction,
            "half_kelly": half_kelly,
        })

    # ハーフケリー比率の合計で正規化し、予算内に収める
    total_half_kelly = sum(e["half_kelly"] for e in kelly_entries)

    results = []
    for entry in kelly_entries:
        horse = entry["horse"]
        half_kelly = entry["half_kelly"]

        if total_half_kelly > 0 and half_kelly > 0:
            allocation_ratio = half_kelly / total_half_kelly
            recommended_bet = int(budget * allocation_ratio)
        else:
            recommended_bet = 0

        expected_return = recommended_bet * horse["odds_win"] * horse["win_probability"]

        results.append({
            "horse_id": horse.get("horse_id", ""),
            "horse_name": horse.get("horse_name", ""),
            "recommended_bet": recommended_bet,
            "expected_return": round(expected_return, 2),
            "kelly_fraction": round(entry["kelly_fraction"], 6),
        })

    return results
