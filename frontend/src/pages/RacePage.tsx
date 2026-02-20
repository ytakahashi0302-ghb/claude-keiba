import { useState, useEffect } from 'react';
import { getRaces, getHorses } from '../api/client';
import type { Race, Horse } from '../types';
import ExpectedValueChart from '../components/ExpectedValueChart';
import BudgetOptimizer from '../components/BudgetOptimizer';

// ---------------------------------------------------------------------------
// ベットシミュレーション（出走予定）
// ---------------------------------------------------------------------------

const BUDGET = 10000;

// JRA公式枠番カラー（背景色）
const GATE_COLORS: Record<number, string> = {
  1: '#f5f5f5', 2: '#424242', 3: '#e53935', 4: '#1e88e5',
  5: '#fdd835', 6: '#43a047', 7: '#fb8c00', 8: '#f06292',
};
// 枠番テキスト色（明るい背景は黒）
const GATE_TEXT: Record<number, string> = {
  1: '#333', 2: '#fff', 3: '#fff', 4: '#fff',
  5: '#333', 6: '#fff', 7: '#fff', 8: '#fff',
};

const BET_TYPE_COLOR: Record<string, string> = {
  '単勝': '#1565c0',
  '複勝': '#2e7d32',
  'ワイド': '#6a1b9a',
  '3連複': '#e65100',
  '3連単': '#880e4f',
  '単勝+複勝': '#00838f',
};

interface RaceSimBet {
  betLabel: string;
  betAmount: number;
  winProbability: number;       // この賭けの推定的中確率
  expectedReturn: number | null; // null = オッズ不明
}

interface RaceSimResult {
  name: string;
  betType: string;
  description: string;
  bets: RaceSimBet[];
  totalBet: number;
  hitProbability: number;         // 戦略全体の推定的中確率
  expectedTotalReturn: number | null;
  expectedProfit: number | null;
}

// ---------------------------------------------------------------------------
// 期待値コメント生成
// ---------------------------------------------------------------------------

function getEVComment(horse: Horse, horses: Horse[]): string {
  const ev = horse.expected_value ?? 0;

  // EV水準ラベル
  let label: string;
  if (ev >= 0.3)       label = '高EV穴馬';
  else if (ev >= 0.05) label = '割安';
  else if (ev >= -0.1) label = '適正水準';
  else if (ev >= -0.3) label = 'やや割高';
  else                 label = '人気先行';

  // 補足要因
  const factors: string[] = [];

  // 馬体重変化
  const wc = horse.weight_change;
  if (wc != null) {
    if (wc >= 2 && wc <= 8)       factors.push('体重増');
    else if (wc <= -6)             factors.push('体重大幅減');
    else if (wc < -2)              factors.push('体重減');
  }

  // 枠番
  if ((horse.gate_number ?? 0) <= 2)       factors.push('内枠有利');
  else if ((horse.gate_number ?? 0) >= 7)  factors.push('外枠不利');

  // 人気順 vs モデル順のズレ
  if (horse.popularity && horse.win_probability != null) {
    const sorted = [...horses].sort(
      (a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0)
    );
    const modelRank = sorted.findIndex(h => h.horse_id === horse.horse_id) + 1;
    if (modelRank < horse.popularity - 2)      factors.push('モデル↑');
    else if (modelRank > horse.popularity + 2) factors.push('モデル↓');
  }

  return factors.length > 0 ? `${label}（${factors.join('・')}）` : label;
}

function buildRaceSimulations(horses: Horse[]): RaceSimResult[] {
  const valid = horses.filter(h => (h.win_probability ?? 0) > 0);
  if (valid.length < 2) return [];

  // 最人気 = 単勝オッズが最も低い馬（オッズ0は除外）
  const withOdds = valid.filter(h => h.odds_win > 0);
  const byPop  = withOdds.slice().sort((a, b) => a.odds_win - b.odds_win);
  const byProb = valid.slice().sort((a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0));

  const top3 = byProb.slice(0, Math.min(3, byProb.length));
  const mostPop = byPop[0] ?? byProb[0];

  const r100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);

  /** 勝率比例配分（合計 = BUDGET になるよう端数を先頭に加算） */
  const proportionalAlloc = (hs: Horse[]): number[] => {
    const total = hs.reduce((s, h) => s + (h.win_probability ?? 0), 0);
    if (total <= 0) return hs.map(() => r100(BUDGET / hs.length));
    const allocs = hs.map(h => r100(BUDGET * (h.win_probability ?? 0) / total));
    allocs[0] += BUDGET - allocs.reduce((s, a) => s + a, 0);
    return allocs;
  };

  /**
   * 複勝の推定的中確率:
   *   複勝オッズがあればその逆数を正規化して3着分として推定、
   *   なければ win_probability × 3 で近似。
   */
  const estPlaceProb = (h: Horse): number => {
    if (h.odds_place > 0) {
      const sumInv = valid.reduce((s, x) => s + (x.odds_place > 0 ? 1 / x.odds_place : 0), 0);
      return sumInv > 0 ? Math.min((1 / h.odds_place) / sumInv * 3, 0.97) : 0;
    }
    return Math.min((h.win_probability ?? 0) * 3, 0.97);
  };

  const sims: RaceSimResult[] = [];

  // ========== 1. 単勝 – モデル上位3頭 勝率比例配分 ==========
  {
    const allocs = proportionalAlloc(top3);
    const bets: RaceSimBet[] = top3.map((h, i) => {
      const wp = h.win_probability ?? 0;
      const er = h.odds_win > 0 ? allocs[i] * h.odds_win * wp : null;
      return {
        betLabel: `${h.horse_number}番 ${h.horse_name}（推定勝率 ${(wp * 100).toFixed(1)}%）`,
        betAmount: allocs[i],
        winProbability: wp,
        expectedReturn: er,
      };
    });
    const validReturns = bets.map(b => b.expectedReturn).filter((r): r is number => r !== null);
    const totalReturn = validReturns.length === bets.length
      ? validReturns.reduce((s, r) => s + r, 0)
      : null;
    const hitProb = Math.min(top3.reduce((s, h) => s + (h.win_probability ?? 0), 0), 0.99);
    sims.push({
      name: '単勝 – モデル上位3頭 勝率比例配分',
      betType: '単勝',
      description: '推定勝率の高い上位3頭に、勝率に比例した金額を配分',
      bets, totalBet: BUDGET, hitProbability: hitProb,
      expectedTotalReturn: totalReturn,
      expectedProfit: totalReturn !== null ? totalReturn - BUDGET : null,
    });
  }

  // ========== 2. 複勝 – モデル上位3頭 勝率比例配分 ==========
  {
    const allocs = proportionalAlloc(top3);
    const bets: RaceSimBet[] = top3.map((h, i) => {
      const pp = estPlaceProb(h);
      const er = h.odds_place > 0 ? allocs[i] * h.odds_place * pp : null;
      return {
        betLabel: `${h.horse_number}番 ${h.horse_name}（推定複勝率 ${(pp * 100).toFixed(0)}%）`,
        betAmount: allocs[i],
        winProbability: pp,
        expectedReturn: er,
      };
    });
    const validReturns = bets.map(b => b.expectedReturn).filter((r): r is number => r !== null);
    const totalReturn = validReturns.length === bets.length
      ? validReturns.reduce((s, r) => s + r, 0)
      : null;
    // P(少なくとも1頭が複勝的中) = 1 - Π(1 - pp_i) [独立と仮定した上限]
    const hitProb = Math.min(
      1 - top3.reduce((prod, h) => prod * (1 - Math.min(estPlaceProb(h), 0.97)), 1),
      0.99,
    );
    sims.push({
      name: '複勝 – モデル上位3頭 勝率比例配分',
      betType: '複勝',
      description: '推定勝率の高い上位3頭の複勝に勝率比例で配分。3着内なら各馬的中',
      bets, totalBet: BUDGET, hitProbability: hitProb,
      expectedTotalReturn: totalReturn,
      expectedProfit: totalReturn !== null ? totalReturn - BUDGET : null,
    });
  }

  // ========== 3. ワイド – 上位3頭 全組み合わせ均等配分 ==========
  if (top3.length >= 2) {
    type Pair = [Horse, Horse];
    const pairs: Pair[] = [];
    for (let i = 0; i < top3.length - 1; i++) {
      for (let j = i + 1; j < top3.length; j++) pairs.push([top3[i], top3[j]]);
    }
    const betPerPair = r100(BUDGET / pairs.length);
    const bets: RaceSimBet[] = pairs.map(([h1, h2], idx) => {
      const betAmt = idx === pairs.length - 1 ? BUDGET - betPerPair * (pairs.length - 1) : betPerPair;
      // P(両馬が3着以内) ≈ min(pp1 × pp2 × 2, 0.95)
      const pairProb = Math.min(estPlaceProb(h1) * estPlaceProb(h2) * 2, 0.95);
      const sorted = [h1, h2].sort((a, b) => a.horse_number - b.horse_number);
      return {
        betLabel: sorted.map(h => `${h.horse_number}番 ${h.horse_name}`).join(' ✕ '),
        betAmount: betAmt,
        winProbability: pairProb,
        expectedReturn: null, // ワイドオッズは事前不明
      };
    });
    const hitProb = Math.min(bets.reduce((s, b) => s + b.winProbability, 0), 0.99);
    sims.push({
      name: 'ワイド – 上位3頭 全組み合わせ均等配分',
      betType: 'ワイド',
      description: '推定勝率上位3頭の全ペアに均等配分。両馬3着内で的中（ワイドオッズは当日確定）',
      bets, totalBet: BUDGET, hitProbability: hitProb,
      expectedTotalReturn: null, expectedProfit: null,
    });
  }

  // ========== 4. 3連複 – モデル上位3頭 ==========
  if (top3.length >= 3) {
    const sorted3 = top3.slice(0, 3).sort((a, b) => a.horse_number - b.horse_number);
    // P(上位3頭全員が3着以内) の粗い推定
    const p = sorted3.map(h => estPlaceProb(h));
    const hitProb = Math.max(0, Math.min(p[0] * p[1] * p[2] * 6, 0.90));
    sims.push({
      name: '3連複 – モデル上位3頭',
      betType: '3連複',
      description: '推定勝率上位3頭を3連複で全額購入。着順不問で3着以内なら的中（オッズは当日確定）',
      bets: [{
        betLabel: sorted3.map(h => `${h.horse_number}番 ${h.horse_name}`).join(' ✕ '),
        betAmount: BUDGET,
        winProbability: hitProb,
        expectedReturn: null,
      }],
      totalBet: BUDGET, hitProbability: hitProb,
      expectedTotalReturn: null, expectedProfit: null,
    });
  }

  // ========== 5. 単勝+複勝 – 最人気 50:50配分 ==========
  if (mostPop) {
    const half = BUDGET / 2;
    const wp = mostPop.win_probability ?? 0;
    const pp = estPlaceProb(mostPop);
    const tanshoReturn = mostPop.odds_win > 0 ? half * mostPop.odds_win * wp : null;
    const fukushoReturn = mostPop.odds_place > 0 ? half * mostPop.odds_place * pp : null;
    const totalReturn = tanshoReturn !== null && fukushoReturn !== null
      ? tanshoReturn + fukushoReturn : null;
    sims.push({
      name: '単勝+複勝 – 最人気 50:50配分',
      betType: '単勝+複勝',
      description: '最人気馬の単勝と複勝に半々配分。リスク分散型',
      bets: [
        {
          betLabel: `${mostPop.horse_number}番 ${mostPop.horse_name} 単勝（推定勝率 ${(wp * 100).toFixed(1)}%）`,
          betAmount: half, winProbability: wp, expectedReturn: tanshoReturn,
        },
        {
          betLabel: `${mostPop.horse_number}番 ${mostPop.horse_name} 複勝（推定複勝率 ${(pp * 100).toFixed(0)}%）`,
          betAmount: half, winProbability: pp, expectedReturn: fukushoReturn,
        },
      ],
      totalBet: BUDGET, hitProbability: pp, // 複勝が的中すれば最低限回収
      expectedTotalReturn: totalReturn,
      expectedProfit: totalReturn !== null ? totalReturn - BUDGET : null,
    });
  }

  // ========== 6. 3連単 – モデル予測順（上位3頭） ==========
  if (top3.length >= 3) {
    const [h1, h2, h3] = top3;
    // P(h1 1着) × P(h2 2着 | h1 1着) × P(h3 3着 | h1,h2)
    const p1 = h1.win_probability ?? 0;
    const p2 = Math.min((h2.win_probability ?? 0) / Math.max(0.01, 1 - p1), 1);
    const p3 = Math.min(
      (h3.win_probability ?? 0) / Math.max(0.01, 1 - p1 - (h2.win_probability ?? 0)), 1,
    );
    const hitProb = Math.max(0, Math.min(p1 * p2 * p3, 0.50));
    sims.push({
      name: '3連単 – モデル予測順（上位3頭）',
      betType: '3連単',
      description: '推定勝率順（1位→2位→3位）で着順を指定。的中率は低いが超高配当狙い（オッズは当日確定）',
      bets: [{
        betLabel: `${h1.horse_number}番 → ${h2.horse_number}番 → ${h3.horse_number}番`,
        betAmount: BUDGET,
        winProbability: hitProb,
        expectedReturn: null,
      }],
      totalBet: BUDGET, hitProbability: hitProb,
      expectedTotalReturn: null, expectedProfit: null,
    });
  }

  return sims;
}

function RaceSimCard({ sim }: { sim: RaceSimResult }) {
  const badgeBg = BET_TYPE_COLOR[sim.betType] ?? '#546e7a';
  return (
    <div style={{
      border: '2px solid #e0e0e0', borderRadius: '8px',
      padding: '14px 16px', backgroundColor: '#fafafa',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '0.93rem', color: '#212121', flex: 1 }}>
          {sim.name}
        </div>
        <span style={{
          fontSize: '0.72rem', fontWeight: 'bold', color: '#fff',
          backgroundColor: badgeBg, padding: '2px 8px', borderRadius: '12px',
          whiteSpace: 'nowrap', marginLeft: '8px',
        }}>
          {sim.betType}
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: '#777', margin: '0 0 10px' }}>{sim.description}</p>

      <div style={{ marginBottom: '10px' }}>
        {sim.bets.map((bet, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '5px 8px', borderRadius: '4px', marginBottom: '4px',
            backgroundColor: '#f0f4ff', fontSize: '0.83rem',
          }}>
            <span style={{ color: '#333', flex: 1 }}>{bet.betLabel}</span>
            <span style={{ color: '#555', marginLeft: '8px', whiteSpace: 'nowrap' }}>
              {bet.betAmount.toLocaleString()}円
            </span>
          </div>
        ))}
      </div>

      <div style={{
        borderTop: '1px solid #e0e0e0', paddingTop: '8px',
        display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.85rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#666' }}>合計賭け金</span>
          <span>{sim.totalBet.toLocaleString()}円</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#666' }}>推定的中確率</span>
          <span style={{ fontWeight: 'bold', color: '#1565c0' }}>
            {(sim.hitProbability * 100).toFixed(1)}%
          </span>
        </div>
        {sim.expectedTotalReturn !== null ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>期待リターン</span>
              <span>{Math.round(sim.expectedTotalReturn).toLocaleString()}円</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>期待損益</span>
              <span style={{
                fontWeight: 'bold',
                color: (sim.expectedProfit ?? 0) >= 0 ? '#2e7d32' : '#c62828',
              }}>
                {(sim.expectedProfit ?? 0) >= 0 ? '+' : ''}
                {Math.round(sim.expectedProfit ?? 0).toLocaleString()}円
              </span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: '0.78rem', color: '#aaa', marginTop: '2px' }}>
            ※ この賭け式のオッズはレース当日に確定します
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインページ
// ---------------------------------------------------------------------------

export default function RacePage() {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [horses, setHorses] = useState<Horse[]>([]);
  const [loadingRaces, setLoadingRaces] = useState(false);
  const [loadingHorses, setLoadingHorses] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoadingRaces(true);
    getRaces()
      .then((data: Race[]) => { setRaces(data); setLoadingRaces(false); })
      .catch(() => { setError('レース一覧の取得に失敗しました。'); setLoadingRaces(false); });
  }, []);

  useEffect(() => {
    if (!selectedRaceId) { setHorses([]); return; }
    setLoadingHorses(true);
    setError('');
    getHorses(selectedRaceId)
      .then((data: Horse[]) => { setHorses(data); setLoadingHorses(false); })
      .catch(() => { setError('出走馬の取得に失敗しました。'); setLoadingHorses(false); });
  }, [selectedRaceId]);

  const raceSims = horses.length > 0 ? buildRaceSimulations(horses) : [];

  return (
    <div>
      <h2 style={{ marginBottom: '16px' }}>レース選択</h2>

      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="race-select" style={{ fontWeight: 'bold', marginRight: '8px' }}>
          レース:
        </label>
        <select
          id="race-select"
          value={selectedRaceId}
          onChange={(e) => setSelectedRaceId(e.target.value)}
          style={{ padding: '8px 12px', fontSize: '1rem', minWidth: '320px' }}
          disabled={loadingRaces}
        >
          <option value="">-- レースを選択してください --</option>
          {races.map((race) => (
            <option key={race.race_id} value={race.race_id}>
              {race.venue} {race.race_number}R - {race.race_name}（{race.date}）
            </option>
          ))}
        </select>
        {loadingRaces && <span style={{ marginLeft: '8px' }}>読み込み中...</span>}
      </div>

      {error && <p style={{ color: '#d32f2f', marginBottom: '16px' }}>{error}</p>}
      {loadingHorses && <p>出走馬を読み込み中...</p>}

      {!loadingHorses && horses.length > 0 && (
        <>
          <h3 style={{ marginBottom: '8px' }}>出走馬一覧</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '32px', backgroundColor: '#fff' }}>
            <thead>
              <tr style={{ backgroundColor: '#1a237e', color: '#fff', textAlign: 'left' }}>
                <th style={thStyle}>枠</th>
                <th style={thStyle}>馬番</th>
                <th style={thStyle}>馬名</th>
                <th style={thStyle}>騎手</th>
                <th style={thStyle}>斤量</th>
                <th style={thStyle}>体重(変化)</th>
                <th style={thStyle}>人気</th>
                <th style={thStyle}>単勝オッズ</th>
                <th style={thStyle}>推定勝率</th>
                <th style={thStyle}>期待値</th>
                <th style={thStyle}>評価理由</th>
              </tr>
            </thead>
            <tbody>
              {horses.map((horse) => {
                const ev = horse.expected_value ?? 0;
                const bg = ev > 0 ? '#e8f5e9' : ev < -0.1 ? '#ffebee' : '#fff8e1';
                return (
                  <tr key={horse.horse_id} style={{ backgroundColor: bg }}>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {horse.gate_number ? (
                        <span style={{
                          display: 'inline-block', width: '22px', lineHeight: '22px',
                          borderRadius: '4px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold',
                          backgroundColor: GATE_COLORS[horse.gate_number] ?? '#ccc',
                          color: GATE_TEXT[horse.gate_number] ?? '#fff',
                        }}>
                          {horse.gate_number}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={tdStyle}>{horse.horse_number}</td>
                    <td style={tdStyle}>{horse.horse_name}</td>
                    <td style={tdStyle}>{horse.jockey}</td>
                    <td style={tdStyle}>{horse.weight} kg</td>
                    <td style={tdStyle}>
                      {horse.body_weight ? (
                        <>
                          {horse.body_weight}
                          {horse.weight_change != null && (
                            <span style={{ fontSize: '0.8rem', marginLeft: '3px', color: horse.weight_change > 0 ? '#1565c0' : horse.weight_change < 0 ? '#c62828' : '#666' }}>
                              ({horse.weight_change > 0 ? '+' : ''}{horse.weight_change})
                            </span>
                          )}
                        </>
                      ) : '-'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {horse.popularity ? (
                        <span style={{
                          display: 'inline-block', minWidth: '22px', lineHeight: '22px',
                          borderRadius: '4px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold',
                          backgroundColor: horse.popularity === 1 ? '#f57f17' : horse.popularity <= 3 ? '#1565c0' : '#616161',
                          color: '#fff', padding: '0 4px',
                        }}>
                          {horse.popularity}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 'bold' }}>{horse.odds_win.toFixed(1)} 倍</td>
                    <td style={tdStyle}>
                      {horse.win_probability != null
                        ? (horse.win_probability * 100).toFixed(1) + '%'
                        : '-'}
                    </td>
                    <td style={tdStyle}>
                      {horse.expected_value != null
                        ? (horse.expected_value >= 0 ? '+' : '') + horse.expected_value.toFixed(3)
                        : '-'}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#555', whiteSpace: 'nowrap' }}>
                      {getEVComment(horse, horses)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginBottom: '32px' }}>
            <ExpectedValueChart horses={horses} />
          </div>

          <BudgetOptimizer raceId={selectedRaceId} />

          {/* ベットシミュレーション（予測） */}
          {raceSims.length > 0 && (() => {
            // ---- サマリー計算 ----
            const avgHitRate = raceSims.reduce((s, sim) => s + sim.hitProbability, 0) / raceSims.length;
            const simsWithReturn = raceSims.filter(s => s.expectedTotalReturn !== null);
            const totalBetKnown  = simsWithReturn.reduce((s, sim) => s + sim.totalBet, 0);
            const totalExpReturn = simsWithReturn.reduce((s, sim) => s + (sim.expectedTotalReturn ?? 0), 0);
            const totalExpProfit = totalExpReturn - totalBetKnown;
            const returnRate     = totalBetKnown > 0 ? totalExpReturn / totalBetKnown : null;
            return (
              <div style={{ marginBottom: '32px' }}>
                <h4 style={{ marginBottom: '4px' }}>
                  ベットシミュレーション（予算: {BUDGET.toLocaleString()}円 / 最適配分）
                </h4>
                <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '12px' }}>
                  各戦略で {BUDGET.toLocaleString()}円 を最適配分した場合の推定的中確率と期待損益を示します。
                  単勝・複勝はオッズが公開されている場合のみ期待損益を計算。
                  ワイド・3連複・3連単のオッズはレース当日確定のため参考確率のみ表示します。
                </p>

                {/* ── 全体サマリーパネル ── */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: simsWithReturn.length > 0 ? 'repeat(3, 1fr)' : '1fr',
                  gap: '1px',
                  backgroundColor: '#bdbdbd',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  marginBottom: '16px',
                  border: '1px solid #bdbdbd',
                }}>
                  {/* 推定的中率 */}
                  <div style={{ backgroundColor: '#1a237e', padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9fa8da', marginBottom: '4px', letterSpacing: '0.03em' }}>
                      推定平均的中率（全{raceSims.length}戦略）
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>
                      {(avgHitRate * 100).toFixed(1)}%
                    </div>
                  </div>

                  {simsWithReturn.length > 0 && (
                    <>
                      {/* 期待リターン vs 投資額 */}
                      <div style={{ backgroundColor: '#0d47a1', padding: '16px 20px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: '#90caf9', marginBottom: '4px', letterSpacing: '0.03em' }}>
                          期待リターン / 投資額
                          <span style={{ display: 'block', fontSize: '0.7rem', color: '#78909c' }}>
                            ※ オッズ確定戦略 {simsWithReturn.length} 種のみ
                          </span>
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#fff', lineHeight: 1.2 }}>
                          {Math.round(totalExpReturn).toLocaleString()}円
                          <span style={{ fontSize: '0.8rem', color: '#90caf9', marginLeft: '4px' }}>
                            / {totalBetKnown.toLocaleString()}円
                          </span>
                        </div>
                        {returnRate !== null && (
                          <div style={{ fontSize: '0.8rem', color: '#b3e5fc', marginTop: '2px' }}>
                            回収率 {(returnRate * 100).toFixed(1)}%
                          </div>
                        )}
                      </div>

                      {/* 期待損益 */}
                      <div style={{
                        backgroundColor: totalExpProfit >= 0 ? '#1b5e20' : '#b71c1c',
                        padding: '16px 20px',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '0.75rem', color: totalExpProfit >= 0 ? '#a5d6a7' : '#ef9a9a', marginBottom: '4px', letterSpacing: '0.03em' }}>
                          期待損益合計
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>
                          {totalExpProfit >= 0 ? '+' : ''}{Math.round(totalExpProfit).toLocaleString()}円
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: '16px',
                }}>
                  {raceSims.map((sim, i) => (
                    <RaceSimCard key={i} sim={sim} />
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {!loadingHorses && selectedRaceId && horses.length === 0 && !error && (
        <p>このレースの出走馬データが見つかりません。</p>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '2px solid #e0e0e0' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #e0e0e0' };
