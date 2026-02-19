"""多因子期待値計算モジュール（v2: ブレンドモデル）

■ 旧モデルの問題点
  score = p_market × 各補正乗数 → 正規化 → win_probability
  → 正規化によってスコアが均され、結局すべての馬の EV が
    「市場控除率の分だけマイナス」の値（例: −25%）に収束してしまう。

■ 新モデルの考え方
  フォームスコアと市場確率を「独立したモデル」として別々に正規化し、
  加重ブレンドすることで、市場が過小評価した馬でも EV > 0 になりえる。

  Step 1: フォームスコア（市場と完全に独立）
      p_form = normalize( gate × weight_change × ranking × last_3f )
      ※ これは「過去成績・枠・体重変化だけから見た勝率推定」

  Step 2: 市場確率（控除率を除去した純粋な市場の評価）
      p_market = (1/オッズ) / Σ(1/オッズ)   ← 合計が 1.0 になる

  Step 3: ブレンド確率
      p_model = ALPHA × p_form + (1 − ALPHA) × p_market

  Step 4: 期待値
      EV = オッズ × p_model − 1

■ EV > 0 になる条件
  フォームが優れているのに市場が高オッズをつけている馬（穴馬）は
  p_form > p_market になりやすく、オッズが高いほど EV が正になる。
  逆に低オッズ人気馬でフォームが悪ければ EV は大きくマイナスになる。

■ ALPHA（フォームモデルへの信頼度）
  0.0 → 市場100%（全馬 EV = −控除率%）
  0.4 → フォーム40% + 市場60%（好フォーム穴馬に正EV が出やすい）
  1.0 → フォーム100%（市場情報を無視）
  ALPHA = 0.40 に設定。
"""

from typing import List, Optional


# ---------------------------------------------------------------------------
# ハイパーパラメータ
# ---------------------------------------------------------------------------
# フォームモデルへの信頼度。市場オッズは大量の情報を集約しているため、
# 60% は市場に従い、40% を自前のフォームモデルで上書きする。
ALPHA = 0.40


def calculate_expected_values(horses: List[dict]) -> List[dict]:
    """
    各馬に win_probability と expected_value を付加して返す。

    Parameters
    ----------
    horses : list[dict]
        各馬の情報。以下のキーを利用（省略可能なものは None でも可）:
            odds_win      float   単勝オッズ（必須）
            gate_number   int     枠番 1-8（省略可）
            weight_change int     馬体重変化 kg（省略可）
            race_history  list    過去レース成績リスト（省略可）
                各要素: {ranking, field_size, last_3f}

    Returns
    -------
    list[dict]
        win_probability, expected_value が付加された馬情報のリスト。
    """
    if not horses:
        return []

    valid = [h for h in horses if h.get("odds_win", 0) > 0]
    if not valid:
        return [{**h, "win_probability": 0.0, "expected_value": 0.0} for h in horses]

    # -----------------------------------------------------------------------
    # 全馬の平均上り3Fを事前計算（相対比較に使用）
    # -----------------------------------------------------------------------
    all_3f_avgs = [
        avg for h in valid
        if (avg := _avg_last_3f(h.get("race_history", []))) > 0
    ]
    global_3f_avg = sum(all_3f_avgs) / len(all_3f_avgs) if all_3f_avgs else 0.0

    # -----------------------------------------------------------------------
    # Step 1: 各馬の inv_odds（市場用）と form_score（フォーム用）を計算
    # -----------------------------------------------------------------------
    work = []
    for horse in horses:
        odds = horse.get("odds_win", 0)
        if odds <= 0:
            work.append({"horse": horse, "inv_odds": 0.0, "form_score": 0.0})
            continue

        gate    = horse.get("gate_number") or 0
        wc      = horse.get("weight_change")
        history = horse.get("race_history") or []

        form_score = (
            _gate_factor(gate)
            * _weight_change_factor(wc)
            * _ranking_factor(history)
            * _last3f_factor(history, global_3f_avg)
        )

        work.append({
            "horse":      horse,
            "inv_odds":   1.0 / odds,
            "form_score": form_score,
        })

    total_inv_odds = sum(w["inv_odds"]   for w in work)
    total_form     = sum(w["form_score"] for w in work)

    # -----------------------------------------------------------------------
    # Step 2 & 3: ブレンド確率・EV を確定
    # -----------------------------------------------------------------------
    results = []
    for w in work:
        horse      = w["horse"]
        inv_odds   = w["inv_odds"]
        form_score = w["form_score"]
        base       = {k: v for k, v in horse.items()}  # race_history は main.py が除去

        if inv_odds <= 0 or total_inv_odds <= 0:
            results.append({**base, "win_probability": 0.0, "expected_value": 0.0})
            continue

        # 市場確率（控除率を除去: Σ が 1.0 になるよう正規化）
        p_market = inv_odds / total_inv_odds

        # フォームモデル確率（フォームスコアを正規化）
        # データなし馬は form_score=1.0（中立）として扱うため、
        # total_form=0 は実際には発生しないが安全のためフォールバック
        p_form = (form_score / total_form) if total_form > 0 else p_market

        # ブレンド確率
        p_model = ALPHA * p_form + (1.0 - ALPHA) * p_market

        # 期待値: p_model > 1/odds ⟺ EV > 0（その馬を市場が過小評価している）
        ev = horse["odds_win"] * p_model - 1.0

        results.append({**base, "win_probability": p_model, "expected_value": ev})

    return results


# ---------------------------------------------------------------------------
# 因子関数
# ---------------------------------------------------------------------------

def _gate_factor(gate: int) -> float:
    """
    枠番効果。
    内枠（1-3）はやや有利（+4%）、外枠（7-8）はやや不利（-4%）。
    gate=0 のときは 1.0（情報なし）。
    """
    if gate <= 0:
        return 1.0
    if gate <= 3:
        return 1.04
    if gate <= 6:
        return 1.00
    return 0.96   # 7, 8


def _weight_change_factor(wc: Optional[int]) -> float:
    """
    馬体重変化補正。
    +2〜+8 kg: 好調サイン (+4%)
    ±2 kg以内: 安定 (0%)
    -2〜-6 kg: やや不安 (-5%)
    -6 kg超の減少 or +12 kg超の増加: 懸念 (-10%)
    """
    if wc is None:
        return 1.0
    if 2 <= wc <= 8:
        return 1.04
    if -2 <= wc < 2:
        return 1.00
    if -6 <= wc < -2 or 8 < wc <= 12:
        return 0.95
    return 0.90   # 極端な変化


def _ranking_factor(history: List[dict]) -> float:
    """
    直近3走の着順スコア（(頭数 - 着順) / (頭数 - 1)）の平均に基づく補正。

    スコア 1.0 = 1着、0.5 = 中間、0.0 = 最下位。
    平均スコア 0.5 が「標準」→ そこからの偏差を ±20% に変換。

    データなしは 1.0（中立）。
    """
    scores = []
    for r in history[:3]:
        rank = r.get("ranking")
        n    = r.get("field_size", 0)
        if rank is not None and n > 1:
            scores.append((n - rank) / (n - 1))

    if not scores:
        return 1.0

    avg  = sum(scores) / len(scores)  # 0.0〜1.0
    mult = 1.0 + (avg - 0.5) * 0.40  # ±20% （0.5 偏差 × 0.40）
    return max(0.80, min(1.20, mult))


def _avg_last_3f(history: List[dict]) -> float:
    """直近3走の上り3F平均を返す（0 = データなし）。"""
    vals = [r["last_3f"] for r in history[:3] if r.get("last_3f", 0) > 0]
    return sum(vals) / len(vals) if vals else 0.0


def _last3f_factor(history: List[dict], global_avg: float) -> float:
    """
    上り3ハロン相対スコア。
    全馬平均より速い（数値が小さい）ほど有利（最大 +12%）。
    global_avg = 0 のときはデータなしとして 1.0 を返す。

    1秒の差 ≈ ±2.4%（最大 ±12%）
    """
    if global_avg <= 0:
        return 1.0
    horse_avg = _avg_last_3f(history)
    if horse_avg <= 0:
        return 1.0
    diff = global_avg - horse_avg   # 正値 = この馬が速い
    mult = 1.0 + diff * 0.024
    return max(0.88, min(1.12, mult))
