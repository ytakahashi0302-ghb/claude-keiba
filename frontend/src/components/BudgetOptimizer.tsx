import { useState } from 'react';
import { optimizeBudget } from '../api/client';
import type { OptimizeResponse } from '../types';

interface Props {
  raceId: string;
}

export default function BudgetOptimizer({ raceId }: Props) {
  const [budget, setBudget] = useState('');
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const budgetNum = Math.round(Number(budget) / 100) * 100;
    if (!budgetNum || budgetNum < 100) {
      setError('予算は100円以上で入力してください。');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    optimizeBudget(raceId, budgetNum)
      .then((data: OptimizeResponse) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => {
        setError('データ取得に失敗しました。レースと予算を確認してください。');
        setLoading(false);
      });
  };

  const profit = result ? result.guaranteed_return - result.total_bet : 0;
  const profitRate = result && result.total_bet > 0
    ? ((result.guaranteed_return / result.total_bet - 1) * 100)
    : 0;

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
      <h3 style={{ marginTop: 0, marginBottom: '4px' }}>予算最適化（ダッチベッティング）</h3>
      <p style={{ fontSize: '0.82rem', color: '#666', marginTop: 0, marginBottom: '16px' }}>
        選択した馬のどれが勝っても利益が出るよう予算を配分します
      </p>

      <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label htmlFor="budget-input" style={{ fontWeight: 'bold' }}>予算:</label>
          <input
            id="budget-input"
            type="number"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="例: 10000"
            min="100"
            step="100"
            style={{ padding: '8px 12px', fontSize: '1rem', width: '160px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          <span style={{ color: '#666' }}>円</span>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '8px 20px', fontSize: '1rem', backgroundColor: '#1a237e',
              color: '#fff', border: 'none', borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '計算中...' : '最適配分を計算'}
          </button>
        </div>
      </form>

      {error && <p style={{ color: '#d32f2f', marginBottom: '16px' }}>{error}</p>}

      {result && result.recommendations.length > 0 && (
        <>
          {/* サマリーパネル */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px',
            marginBottom: '20px',
          }}>
            {[
              { label: '投資額', value: `${result.total_bet.toLocaleString()}円`, sub: `残り ${result.remaining_budget.toLocaleString()}円` },
              { label: '最低保証リターン', value: `${result.guaranteed_return.toLocaleString()}円`, sub: `どの馬が勝っても`, highlight: true },
              { label: '確定利益（最低）', value: `${profit >= 0 ? '+' : ''}${profit.toLocaleString()}円`, sub: `回収率 ${(profitRate >= 0 ? '+' : '')}${profitRate.toFixed(1)}%`, positive: profit >= 0 },
              { label: '的中カバレッジ', value: `${(result.coverage * 100).toFixed(1)}%`, sub: `選択馬のどれかが勝つ確率` },
            ].map(({ label, value, sub, highlight, positive }) => (
              <div key={label} style={{
                backgroundColor: highlight ? '#e8f5e9' : '#f5f5f5',
                borderRadius: '6px', padding: '12px', textAlign: 'center',
                border: highlight ? '1px solid #a5d6a7' : '1px solid #e0e0e0',
              }}>
                <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '4px' }}>{label}</div>
                <div style={{
                  fontSize: '1.1rem', fontWeight: 'bold',
                  color: positive === true ? '#2e7d32' : positive === false ? '#c62828' : highlight ? '#1b5e20' : '#1a237e',
                }}>{value}</div>
                <div style={{ fontSize: '0.72rem', color: '#888', marginTop: '2px' }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* 賭け配分テーブル */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1a237e', color: '#fff', textAlign: 'left' }}>
                <th style={thStyle}>馬名</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>単勝オッズ</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>推奨ベット</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>的中時リターン</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>推定勝率</th>
              </tr>
            </thead>
            <tbody>
              {result.recommendations.map((rec, i) => (
                <tr key={rec.horse_id || i} style={{ backgroundColor: i % 2 === 0 ? '#fafafa' : '#fff' }}>
                  <td style={tdStyle}>{rec.horse_name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{rec.odds_win.toFixed(1)}倍</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>{rec.recommended_bet.toLocaleString()}円</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#2e7d32' }}>{rec.if_wins_return.toLocaleString()}円</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{(rec.win_probability * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#e8eaf6', fontWeight: 'bold' }}>
                <td style={tdStyle} colSpan={2}>合計</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{result.total_bet.toLocaleString()}円</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#1b5e20' }}>
                  {result.guaranteed_return.toLocaleString()}円〜
                </td>
                <td style={tdStyle} />
              </tr>
            </tfoot>
          </table>

          {result.remaining_budget > 0 && (
            <p style={{ fontSize: '0.83rem', color: '#555', backgroundColor: '#fff8e1', padding: '8px 12px', borderRadius: '4px', margin: 0 }}>
              💡 残り <strong>{result.remaining_budget.toLocaleString()}円</strong> は最も期待値の高い馬への追加投資に使えます
            </p>
          )}
        </>
      )}

      {result && result.recommendations.length === 0 && (
        <p style={{ color: '#888' }}>対象馬が見つかりませんでした。オッズが取得できていない可能性があります。</p>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '2px solid #e0e0e0' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #e0e0e0' };
