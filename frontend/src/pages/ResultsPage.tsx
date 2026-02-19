import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { getPastRaces, getRaceResults } from '../api/client';
import type { Race, RaceResult, HorseResult } from '../types';

const BUDGET = 10000;

// ---------------------------------------------------------------------------
// シミュレーション型定義
// ---------------------------------------------------------------------------

interface SimBet {
  horses: HorseResult[];   // 対象馬（単複=1頭、ワイド=2頭、3連複=3頭）
  betAmount: number;       // この組み合わせへの賭け金
  hit: boolean;
  payout: number;          // この賭けの払い戻し（的中時のみ）
  betLabel: string;        // 表示用ラベル
}

interface SimResult {
  name: string;
  betType: string;
  description: string;     // 配分方針の説明
  bets: SimBet[];
  totalBet: number;
  totalPayout: number;
  totalProfit: number;
}

// ---------------------------------------------------------------------------
// シミュレーション計算
// ---------------------------------------------------------------------------

function buildSimulations(result: RaceResult): SimResult[] {
  if (!result.horses.length) return [];

  const byPop  = result.horses.slice().sort((a, b) => a.popularity - b.popularity);
  const byProb = result.horses.slice().sort((a, b) => b.win_probability - a.win_probability);

  const top3prob = byProb.filter(h => h.win_probability > 0).slice(0, 3);
  const mostPop  = byPop[0];

  const pTansho     = result.payouts.find(p => p.type === '単勝');
  const pFukusho    = result.payouts.find(p => p.type === '複勝');
  const pWide       = result.payouts.find(p => p.type === 'ワイド');
  const pSanrenpuku = result.payouts.find(p => p.type === '3連複');
  const pSanrentan  = result.payouts.find(p => p.type === '3連単');

  /** JRAの賭け単位（100円）に丸める */
  const r100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);
  /** per100円あたりの払戻額 × 賭け金 → 払い戻し総額 */
  const calcPayout = (per100: number, bet: number) => Math.round(per100 * (bet / 100));

  /** 勝率に比例して BUDGET を各馬に配分（合計が BUDGET になるよう端数調整） */
  const proportionalAlloc = (horses: HorseResult[]): number[] => {
    const totalProb = horses.reduce((s, h) => s + h.win_probability, 0);
    if (totalProb <= 0) return horses.map(() => r100(BUDGET / horses.length));
    const allocs = horses.map(h => r100(BUDGET * h.win_probability / totalProb));
    // 合計を BUDGET に合わせる（端数を最初の馬に加算）
    const diff = BUDGET - allocs.reduce((s, a) => s + a, 0);
    allocs[0] += diff;
    return allocs;
  };

  /** 複勝払戻: 着順順に格納されているので着順インデックスで引く */
  const fukushoPer100 = (horse: HorseResult): number => {
    if (!pFukusho) return 0;
    const placedByRank = result.horses
      .filter(h => h.ranking !== null && h.ranking <= 3)
      .sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99));
    const idx = placedByRank.findIndex(h => h.horse_number === horse.horse_number);
    return pFukusho.results[idx >= 0 ? idx : 0]?.amount ?? 0;
  };

  const sims: SimResult[] = [];

  // ==========================================================================
  // 1. 単勝 – モデル上位3頭 勝率比例配分
  // ==========================================================================
  if (top3prob.length > 0) {
    const allocs = proportionalAlloc(top3prob);
    const bets: SimBet[] = top3prob.map((h, i) => {
      const betAmt = allocs[i];
      const hit    = h.ranking === 1;
      const payout = hit ? calcPayout(pTansho?.results[0]?.amount ?? 0, betAmt) : 0;
      return {
        horses: [h], betAmount: betAmt, hit, payout,
        betLabel: `${h.horse_number}番 ${h.horse_name}（推定${(h.win_probability * 100).toFixed(1)}%）`,
      };
    });
    const totalPayout = bets.reduce((s, b) => s + b.payout, 0);
    sims.push({
      name: '単勝 – モデル上位3頭 勝率比例配分',
      betType: '単勝',
      description: '推定勝率の高い上位3頭に、勝率に比例した金額を配分',
      bets,
      totalBet: BUDGET,
      totalPayout,
      totalProfit: totalPayout - BUDGET,
    });
  }

  // ==========================================================================
  // 2. 複勝 – モデル上位3頭 勝率比例配分
  // ==========================================================================
  if (top3prob.length > 0) {
    const allocs = proportionalAlloc(top3prob);
    const bets: SimBet[] = top3prob.map((h, i) => {
      const betAmt = allocs[i];
      const hit    = h.ranking !== null && h.ranking <= 3;
      const payout = hit ? calcPayout(fukushoPer100(h), betAmt) : 0;
      return {
        horses: [h], betAmount: betAmt, hit, payout,
        betLabel: `${h.horse_number}番 ${h.horse_name}（推定${(h.win_probability * 100).toFixed(1)}%）`,
      };
    });
    const totalPayout = bets.reduce((s, b) => s + b.payout, 0);
    sims.push({
      name: '複勝 – モデル上位3頭 勝率比例配分',
      betType: '複勝',
      description: '推定勝率の高い上位3頭の複勝に、勝率比例で配分。3着内なら的中',
      bets,
      totalBet: BUDGET,
      totalPayout,
      totalProfit: totalPayout - BUDGET,
    });
  }

  // ==========================================================================
  // 3. ワイド – 上位3頭 全組み合わせ均等配分
  // ==========================================================================
  if (top3prob.length >= 2) {
    // 全ペアを生成
    type Pair = [HorseResult, HorseResult];
    const pairs: Pair[] = [];
    for (let i = 0; i < top3prob.length - 1; i++) {
      for (let j = i + 1; j < top3prob.length; j++) {
        pairs.push([top3prob[i], top3prob[j]]);
      }
    }
    const betPerPair = r100(BUDGET / pairs.length);
    const bets: SimBet[] = pairs.map(([h1, h2], pairIdx) => {
      // 最後のペアは端数調整
      const betAmt = pairIdx === pairs.length - 1
        ? BUDGET - betPerPair * (pairs.length - 1)
        : betPerPair;
      const hit = h1.ranking !== null && h1.ranking <= 3 &&
                  h2.ranking !== null && h2.ranking <= 3;
      // ワイドの払戻はインデックスで近似（全ペア同一 horse_numbers の場合あり）
      const per100 = pWide?.results[pairIdx]?.amount ?? pWide?.results[0]?.amount ?? 0;
      const payout = hit ? calcPayout(per100, betAmt) : 0;
      const sorted = [h1, h2].sort((a, b) => a.horse_number - b.horse_number);
      return {
        horses: sorted, betAmount: betAmt, hit, payout,
        betLabel: sorted.map(h => `${h.horse_number}番 ${h.horse_name}`).join(' ✕ '),
      };
    });
    const totalPayout = bets.reduce((s, b) => s + b.payout, 0);
    sims.push({
      name: 'ワイド – 上位3頭 全組み合わせ均等配分',
      betType: 'ワイド',
      description: '推定勝率上位3頭で作れる全ペアに均等配分。両馬3着内で的中',
      bets,
      totalBet: BUDGET,
      totalPayout,
      totalProfit: totalPayout - BUDGET,
    });
  }

  // ==========================================================================
  // 4. 3連複 – モデル上位3頭
  // ==========================================================================
  if (top3prob.length >= 3) {
    const horses = top3prob.slice(0, 3).sort((a, b) => a.horse_number - b.horse_number);
    const hit    = horses.every(h => h.ranking !== null && h.ranking <= 3);
    const payout = hit ? calcPayout(pSanrenpuku?.results[0]?.amount ?? 0, BUDGET) : 0;
    sims.push({
      name: '3連複 – モデル上位3頭',
      betType: '3連複',
      description: '推定勝率上位3頭を3連複で全額購入。着順不問で3着内に入れば的中',
      bets: [{
        horses,
        betAmount: BUDGET,
        hit,
        payout,
        betLabel: horses.map(h => `${h.horse_number}番 ${h.horse_name}`).join(' ✕ '),
      }],
      totalBet: BUDGET,
      totalPayout: payout,
      totalProfit: payout - BUDGET,
    });
  }

  // ==========================================================================
  // 5. 3連単 – モデル予測順（上位3頭）
  // ==========================================================================
  if (top3prob.length >= 3) {
    const [h1, h2, h3] = top3prob;
    // 予測着順: 推定勝率1位→1着、2位→2着、3位→3着
    const hit = h1.ranking === 1 && h2.ranking === 2 && h3.ranking === 3;
    const payout = hit ? calcPayout(pSanrentan?.results[0]?.amount ?? 0, BUDGET) : 0;
    sims.push({
      name: '3連単 – モデル予測順（上位3頭）',
      betType: '3連単',
      description: '推定勝率順（1位→2位→3位）で着順を指定。的中率は低いが超高配当狙い',
      bets: [{
        horses: [h1, h2, h3],
        betAmount: BUDGET,
        hit,
        payout,
        betLabel: `${h1.horse_number}番 → ${h2.horse_number}番 → ${h3.horse_number}番`,
      }],
      totalBet: BUDGET,
      totalPayout: payout,
      totalProfit: payout - BUDGET,
    });
  }

  // ==========================================================================
  // 6. 単勝+複勝 – 最人気 50:50配分
  // ==========================================================================
  if (mostPop) {
    const halfBudget = BUDGET / 2;
    const tanshoHit  = mostPop.ranking === 1;
    const fukushoHit = mostPop.ranking !== null && mostPop.ranking <= 3;
    const bets: SimBet[] = [
      {
        horses: [mostPop],
        betAmount: halfBudget,
        hit: tanshoHit,
        payout: tanshoHit ? calcPayout(pTansho?.results[0]?.amount ?? 0, halfBudget) : 0,
        betLabel: `${mostPop.horse_number}番 ${mostPop.horse_name} 単勝`,
      },
      {
        horses: [mostPop],
        betAmount: halfBudget,
        hit: fukushoHit,
        payout: fukushoHit ? calcPayout(fukushoPer100(mostPop), halfBudget) : 0,
        betLabel: `${mostPop.horse_number}番 ${mostPop.horse_name} 複勝`,
      },
    ];
    const totalPayout = bets.reduce((s, b) => s + b.payout, 0);
    sims.push({
      name: '単勝+複勝 – 最人気 50:50配分',
      betType: '単勝+複勝',
      description: '最人気馬の単勝と複勝に半々で配分。リスク分散型',
      bets,
      totalBet: BUDGET,
      totalPayout,
      totalProfit: totalPayout - BUDGET,
    });
  }

  return sims;
}

// ---------------------------------------------------------------------------
// メインページ
// ---------------------------------------------------------------------------

export default function ResultsPage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [result, setResult] = useState<RaceResult | null>(null);
  const [loadingRaces, setLoadingRaces] = useState(false);
  const [loadingResult, setLoadingResult] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoadingRaces(true);
    getPastRaces()
      .then((data: Race[]) => { setRaces(data); setLoadingRaces(false); })
      .catch(() => { setError('過去レース一覧の取得に失敗しました。'); setLoadingRaces(false); });
  }, []);

  useEffect(() => {
    if (!selectedRaceId) { setResult(null); return; }
    setLoadingResult(true);
    setError('');
    getRaceResults(selectedRaceId)
      .then((data: RaceResult) => { setResult(data); setLoadingResult(false); })
      .catch(() => { setError('レース結果の取得に失敗しました。'); setLoadingResult(false); });
  }, [selectedRaceId]);

  const winPayout = result?.payouts.find(p => p.type === '単勝');
  const winPayoutAmount = winPayout?.results[0]?.amount ?? 0;

  const overround = result?.horses.reduce((sum, h) => sum + (h.odds_win > 0 ? 1 / h.odds_win : 0), 0) ?? 0;
  const takeout = overround > 0 ? (1 - 1 / overround) : 0;

  const simulations = result ? buildSimulations(result) : [];

  const chartData = result?.horses
    .slice()
    .sort((a, b) => a.horse_number - b.horse_number)
    .map(h => {
      const isWinner = h.ranking === 1;
      const actualWinRate = isWinner && winPayoutAmount > 0
        ? parseFloat(((winPayoutAmount / 100) / h.odds_win * 100).toFixed(1))
        : 0;
      return {
        name: `${h.horse_number}番`,
        推定勝率: parseFloat((h.win_probability * 100).toFixed(1)),
        実際の結果: actualWinRate,
      };
    }) ?? [];

  return (
    <div>
      <h2 style={{ marginBottom: '8px' }}>先週のレース実績比較</h2>
      <p style={{ color: '#666', marginBottom: '20px', fontSize: '0.9rem' }}>
        オッズから算出した推定勝率と実際の払い戻しを比較します。
      </p>

      {/* レース選択 */}
      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="past-race-select" style={{ fontWeight: 'bold', marginRight: '8px' }}>
          過去レース:
        </label>
        <select
          id="past-race-select"
          value={selectedRaceId}
          onChange={(e) => setSelectedRaceId(e.target.value)}
          style={{ padding: '8px 12px', fontSize: '1rem', minWidth: '360px' }}
          disabled={loadingRaces}
        >
          <option value="">-- レースを選択してください --</option>
          {races.map((race) => (
            <option key={race.race_id} value={race.race_id}>
              {race.date} {race.venue} {race.race_number}R - {race.race_name}
            </option>
          ))}
        </select>
        {loadingRaces && <span style={{ marginLeft: '8px', color: '#666' }}>読み込み中...</span>}
      </div>

      {error && <p style={{ color: '#d32f2f', marginBottom: '16px' }}>{error}</p>}
      {loadingResult && <p>レース結果を読み込み中...</p>}

      {!loadingResult && result && (
        <>
          {/* レース情報ヘッダー */}
          <div style={{
            backgroundColor: '#1a237e', color: '#fff',
            padding: '12px 16px', borderRadius: '6px', marginBottom: '16px',
          }}>
            <h3 style={{ margin: 0 }}>
              {result.race_name} ／ {result.venue} ／ {result.date} ／ {result.course}
            </h3>
          </div>

          {/* 期待値モデルの説明 */}
          <div style={{
            backgroundColor: '#fff8e1', border: '1px solid #ffe082',
            borderRadius: '6px', padding: '12px 16px', marginBottom: '20px',
            fontSize: '0.875rem', color: '#555',
          }}>
            <strong>期待値モデルについて：</strong>
            このモデルはオッズの逆数から勝率を推定するため、
            <strong>全馬の期待値 = 1/Σ(1/オッズ) − 1 = {(-takeout * 100).toFixed(1)}%</strong>（市場控除率）で一定になります。
            ※これは市場が効率的（オッズ＝真の確率）と仮定した場合の帰結です。
          </div>

          {/* ベットシミュレーション */}
          {simulations.length > 0 && (() => {
            // ---- サマリー計算（実績） ----
            const hitCount      = simulations.filter(s => s.totalProfit > 0).length;
            const hitRate       = hitCount / simulations.length;
            const totalBetAll   = simulations.reduce((s, sim) => s + sim.totalBet, 0);
            const totalPayAll   = simulations.reduce((s, sim) => s + sim.totalPayout, 0);
            const totalProfAll  = totalPayAll - totalBetAll;
            const returnRateAll = totalBetAll > 0 ? totalPayAll / totalBetAll : 0;
            return (
              <div style={{ marginBottom: '32px' }}>
                <h4 style={{ marginBottom: '4px' }}>
                  ベットシミュレーション（予算: {BUDGET.toLocaleString()}円 / 最適配分）
                </h4>
                <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '12px' }}>
                  各戦略ごとに {BUDGET.toLocaleString()}円 を最適配分した場合の結果を示します。
                  勝率比例配分は推定勝率に応じた賭け金。ワイドの払戻は組み合わせ近似値。
                </p>

                {/* ── 全体サマリーパネル（実績） ── */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '1px',
                  backgroundColor: '#bdbdbd',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  marginBottom: '16px',
                  border: '1px solid #bdbdbd',
                }}>
                  {/* 的中率 */}
                  <div style={{ backgroundColor: '#1a237e', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9fa8da', marginBottom: '4px', letterSpacing: '0.03em' }}>
                      実際の的中率（払い戻しがプラス）
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>
                      {(hitRate * 100).toFixed(0)}%
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#c5cae9', marginTop: '2px' }}>
                      {hitCount} / {simulations.length} 戦略
                    </div>
                  </div>

                  {/* 合計リターン vs 投資額 */}
                  <div style={{ backgroundColor: '#0d47a1', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#90caf9', marginBottom: '4px', letterSpacing: '0.03em' }}>
                      合計払い戻し / 投資総額
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#fff', lineHeight: 1.2 }}>
                      {totalPayAll.toLocaleString()}円
                      <span style={{ fontSize: '0.8rem', color: '#90caf9', marginLeft: '4px' }}>
                        / {totalBetAll.toLocaleString()}円
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#b3e5fc', marginTop: '2px' }}>
                      回収率 {(returnRateAll * 100).toFixed(1)}%
                    </div>
                  </div>

                  {/* 合計損益 */}
                  <div style={{
                    backgroundColor: totalProfAll >= 0 ? '#1b5e20' : '#b71c1c',
                    padding: '16px 20px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '0.75rem', color: totalProfAll >= 0 ? '#a5d6a7' : '#ef9a9a', marginBottom: '4px', letterSpacing: '0.03em' }}>
                      合計損益
                    </div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>
                      {totalProfAll >= 0 ? '+' : ''}{totalProfAll.toLocaleString()}円
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: '16px',
                }}>
                  {simulations.map((sim, i) => (
                    <SimCard key={i} sim={sim} />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 払い戻しパネル */}
          {result.payouts.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <h4 style={{ marginBottom: '10px' }}>払い戻し結果</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {result.payouts.map((payout, i) => (
                  <div key={i} style={{
                    border: '1px solid #e0e0e0', borderRadius: '6px',
                    padding: '10px 14px', backgroundColor: '#fff', minWidth: '160px',
                  }}>
                    <div style={{ fontWeight: 'bold', color: '#1a237e', marginBottom: '4px' }}>
                      {payout.type}
                    </div>
                    {payout.results.map((r, j) => (
                      <div key={j} style={{ fontSize: '0.9rem', marginBottom: '2px' }}>
                        <span style={{ color: '#333' }}>{r.horse_numbers}番 </span>
                        <span style={{ fontWeight: 'bold', color: '#d32f2f' }}>
                          {r.amount.toLocaleString()}円
                        </span>
                        <span style={{ color: '#888', marginLeft: '4px', fontSize: '0.8rem' }}>
                          ({r.popularity})
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 結果テーブル */}
          <h4 style={{ marginBottom: '6px' }}>着順・推定勝率・ベット損益テーブル</h4>
          <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '10px' }}>
            「100円ベット損益」= 1着なら（払戻 − 100）円、それ以外は −100円。
          </p>
          <div style={{ overflowX: 'auto', marginBottom: '32px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff' }}>
              <thead>
                <tr style={{ backgroundColor: '#1a237e', color: '#fff', textAlign: 'left' }}>
                  <th style={thStyle}>着順</th>
                  <th style={thStyle}>馬番</th>
                  <th style={thStyle}>馬名</th>
                  <th style={thStyle}>騎手</th>
                  <th style={thStyle}>タイム</th>
                  <th style={thStyle}>人気</th>
                  <th style={thStyle}>単勝オッズ</th>
                  <th style={thStyle}>推定勝率</th>
                  <th style={thStyle}>100円ベット損益</th>
                </tr>
              </thead>
              <tbody>
                {result.horses
                  .slice()
                  .sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99))
                  .map((horse) => (
                    <ResultRow
                      key={horse.horse_number}
                      horse={horse}
                      winPayoutAmount={winPayoutAmount}
                    />
                  ))}
              </tbody>
            </table>
          </div>

          {/* 推定勝率チャート */}
          {chartData.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h4 style={{ marginBottom: '6px' }}>推定勝率 vs 実際の結果</h4>
              <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '12px' }}>
                「推定勝率」= オッズ逆数を正規化した確率(%)。
                「実際の結果」= 1着馬のみ、払戻額をオッズで割った実効的な勝率相当値(%)。
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="推定勝率" fill="#1a237e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="実際の結果" fill="#d32f2f" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {!loadingResult && selectedRaceId && !result && !error && (
        <p>このレースの結果データが見つかりません。</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// シミュレーションカード
// ---------------------------------------------------------------------------

const BET_TYPE_COLOR: Record<string, string> = {
  '単勝': '#1565c0',
  '複勝': '#2e7d32',
  'ワイド': '#6a1b9a',
  '3連複': '#e65100',
  '3連単': '#880e4f',
  '単勝+複勝': '#00838f',
};

// 高配当の閾値: 賭け金 (10,000円) の 1万円以上の利益 = totalProfit >= 10000
const HIGH_PAYOUT_THRESHOLD = 10000;

function SimCard({ sim }: { sim: SimResult }) {
  const anyHit = sim.bets.some(b => b.hit);
  const isHighPayout = sim.totalProfit >= HIGH_PAYOUT_THRESHOLD;
  const badgeBg = BET_TYPE_COLOR[sim.betType] ?? '#546e7a';

  // カードの縁取り: 高配当 > 的中 > ハズレ の優先順位
  const borderColor = isHighPayout ? '#f9a825' : anyHit ? '#43a047' : '#e0e0e0';
  const bgColor     = isHighPayout ? '#fffde7'  : anyHit ? '#f1f8e9'  : '#fafafa';

  return (
    <div style={{
      border: `2px solid ${borderColor}`,
      borderRadius: '8px',
      padding: '14px 16px',
      backgroundColor: bgColor,
      position: 'relative',
    }}>
      {/* 高配当バナー */}
      {isHighPayout && (
        <div style={{
          position: 'absolute', top: '-1px', right: '-1px',
          backgroundColor: '#f9a825', color: '#fff',
          fontSize: '0.72rem', fontWeight: 'bold',
          padding: '3px 10px', borderRadius: '0 6px 0 8px',
          letterSpacing: '0.05em',
        }}>
          高配当 +{sim.totalProfit.toLocaleString()}円
        </div>
      )}

      {/* ヘッダー */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', marginTop: isHighPayout ? '10px' : '0' }}>
        <div style={{ fontWeight: 'bold', fontSize: '0.93rem', color: '#212121', flex: 1 }}>
          {sim.name}
        </div>
        <span style={{
          fontSize: '0.72rem', fontWeight: 'bold', color: '#fff',
          backgroundColor: badgeBg,
          padding: '2px 8px', borderRadius: '12px', whiteSpace: 'nowrap', marginLeft: '8px',
        }}>
          {sim.betType}
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: '#777', margin: '0 0 10px' }}>{sim.description}</p>

      {/* 個別ベット一覧 */}
      <div style={{ marginBottom: '10px' }}>
        {sim.bets.map((bet, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '5px 8px', borderRadius: '4px', marginBottom: '4px',
            backgroundColor: bet.hit ? '#e8f5e9' : '#f5f5f5',
            fontSize: '0.83rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
              <span style={{
                display: 'inline-block', minWidth: '16px', textAlign: 'center',
                fontWeight: 'bold', fontSize: '0.75rem',
                color: bet.hit ? '#2e7d32' : '#999',
              }}>
                {bet.hit ? '✓' : '✗'}
              </span>
              <span style={{ color: '#333', flexShrink: 1 }}>{bet.betLabel}</span>
            </div>
            <div style={{ textAlign: 'right', marginLeft: '8px', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#555' }}>{bet.betAmount.toLocaleString()}円</span>
              {bet.hit && (
                <span style={{ color: '#d32f2f', fontWeight: 'bold', marginLeft: '6px' }}>
                  → {bet.payout.toLocaleString()}円
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 合計サマリー */}
      <div style={{
        borderTop: '1px solid #e0e0e0', paddingTop: '8px',
        display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.85rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#666' }}>合計賭け金</span>
          <span>{sim.totalBet.toLocaleString()}円</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#666' }}>払い戻し</span>
          <span style={{ fontWeight: 'bold' }}>
            {sim.totalPayout > 0 ? `${sim.totalPayout.toLocaleString()}円` : '–'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#666' }}>損益</span>
          <span style={{
            fontWeight: 'bold',
            color: sim.totalProfit >= 0 ? '#2e7d32' : '#c62828',
          }}>
            {sim.totalProfit >= 0 ? '+' : ''}{sim.totalProfit.toLocaleString()}円
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 結果テーブル行
// ---------------------------------------------------------------------------

function ResultRow({ horse, winPayoutAmount }: { horse: HorseResult; winPayoutAmount: number }) {
  const isFirst = horse.ranking === 1;
  const betProfit = isFirst && winPayoutAmount > 0 ? winPayoutAmount - 100 : -100;

  return (
    <tr style={{ backgroundColor: isFirst ? '#fff8e1' : '#fff' }}>
      <td style={{ ...tdStyle, fontWeight: isFirst ? 'bold' : 'normal', color: isFirst ? '#f57f17' : '#333' }}>
        {horse.ranking ?? '除'}
      </td>
      <td style={tdStyle}>{horse.horse_number}</td>
      <td style={{ ...tdStyle, fontWeight: isFirst ? 'bold' : 'normal' }}>{horse.horse_name}</td>
      <td style={tdStyle}>{horse.jockey}</td>
      <td style={tdStyle}>{horse.time}</td>
      <td style={tdStyle}>{horse.popularity}人気</td>
      <td style={{ ...tdStyle, fontWeight: 'bold' }}>
        {horse.odds_win > 0 ? `${horse.odds_win.toFixed(1)}倍` : '-'}
      </td>
      <td style={tdStyle}>
        {horse.win_probability > 0 ? `${(horse.win_probability * 100).toFixed(1)}%` : '-'}
      </td>
      <td style={{ ...tdStyle, fontWeight: 'bold', color: betProfit > 0 ? '#2e7d32' : '#c62828' }}>
        {horse.odds_win > 0 ? `${betProfit >= 0 ? '+' : ''}${betProfit.toLocaleString()}円` : '-'}
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '2px solid #e0e0e0' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #e0e0e0' };
