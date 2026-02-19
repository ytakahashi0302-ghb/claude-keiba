import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import type { Horse } from '../types';

interface Props {
  horses: Horse[];
}

export default function ExpectedValueChart({ horses }: Props) {
  const data = horses
    .filter((h) => h.expected_value !== undefined)
    .map((h) => ({
      name: `${h.horse_number}. ${h.horse_name}`,
      ev: h.expected_value!,
    }))
    .sort((a, b) => b.ev - a.ev);

  if (data.length === 0) {
    return <p>No expected value data available.</p>;
  }

  return (
    <div style={{ width: '100%', height: Math.max(300, data.length * 40) }}>
      <h3 style={{ marginBottom: '8px' }}>Expected Value by Horse</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 120, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={110} />
          <Tooltip
            formatter={(value: number) => [value.toFixed(2), 'EV']}
          />
          <Bar dataKey="ev" barSize={20}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.ev >= 0 ? '#4caf50' : '#f44336'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
