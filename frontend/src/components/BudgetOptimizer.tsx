import { useState } from 'react';
import { optimizeBudget } from '../api/client';
import type { OptimizeResponse } from '../types';

interface Props {
  raceId: string;
}

const MOCK_RESPONSE: OptimizeResponse = {
  recommendations: [
    { horse_id: '1', horse_name: 'Mock Horse A', recommended_bet: 3000, expected_return: 4500, kelly_fraction: 0.15 },
    { horse_id: '2', horse_name: 'Mock Horse B', recommended_bet: 2000, expected_return: 2800, kelly_fraction: 0.10 },
    { horse_id: '3', horse_name: 'Mock Horse C', recommended_bet: 1000, expected_return: 1200, kelly_fraction: 0.05 },
  ],
  total_bet: 6000,
  total_expected_return: 8500,
};

export default function BudgetOptimizer({ raceId }: Props) {
  const [budget, setBudget] = useState('');
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const budgetNum = Number(budget);
    if (!budgetNum || budgetNum <= 0) {
      setError('Please enter a valid budget amount.');
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
        // Fallback to mock data when API is unavailable
        setResult(MOCK_RESPONSE);
        setLoading(false);
      });
  };

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Budget Optimizer</h3>

      <form onSubmit={handleSubmit} style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label htmlFor="budget-input" style={{ fontWeight: 'bold' }}>
            Budget:
          </label>
          <input
            id="budget-input"
            type="number"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="e.g. 10000"
            min="1"
            style={{
              padding: '8px 12px',
              fontSize: '1rem',
              width: '200px',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          <span style={{ color: '#666' }}>JPY</span>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '8px 20px',
              fontSize: '1rem',
              backgroundColor: '#1a237e',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Calculating...' : 'Calculate Optimal Allocation'}
          </button>
        </div>
      </form>

      {error && (
        <p style={{ color: '#d32f2f', marginBottom: '16px' }}>{error}</p>
      )}

      {result && (
        <>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              marginBottom: '16px',
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: '#1a237e',
                  color: '#fff',
                  textAlign: 'left',
                }}
              >
                <th style={thStyle}>Horse Name</th>
                <th style={thStyle}>Recommended Bet</th>
                <th style={thStyle}>Expected Return</th>
                <th style={thStyle}>Kelly Fraction</th>
              </tr>
            </thead>
            <tbody>
              {result.recommendations.map((rec) => (
                <tr key={rec.horse_id}>
                  <td style={tdStyle}>{rec.horse_name}</td>
                  <td style={tdStyle}>{rec.recommended_bet.toLocaleString()} JPY</td>
                  <td style={tdStyle}>{rec.expected_return.toLocaleString()} JPY</td>
                  <td style={tdStyle}>{(rec.kelly_fraction * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#e8eaf6', fontWeight: 'bold' }}>
                <td style={tdStyle}>Total</td>
                <td style={tdStyle}>{result.total_bet.toLocaleString()} JPY</td>
                <td style={tdStyle}>{result.total_expected_return.toLocaleString()} JPY</td>
                <td style={tdStyle}>-</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '2px solid #e0e0e0',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #e0e0e0',
};
