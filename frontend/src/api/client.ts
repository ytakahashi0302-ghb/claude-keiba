import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
});

export const getRaces = () => api.get('/races').then(r => r.data.races);

export const getHorses = (raceId: string) =>
  api.get(`/races/${raceId}/horses`).then(r => r.data.horses);

export const getPastRaces = () => api.get('/races/past').then(r => r.data.races);

export const getRaceResults = (raceId: string) =>
  api.get(`/races/${raceId}/results`).then(r => r.data);

export const optimizeBudget = (raceId: string, budget: number) =>
  api.post('/optimize', { race_id: raceId, budget }).then(r => {
    const d = r.data;
    const bets: Array<{horse_id: string; horse_name: string; recommended_bet: number; expected_return: number; kelly_fraction: number}> = d.bets || [];
    return {
      recommendations: bets.map((b) => ({
        horse_id: b.horse_id,
        horse_name: b.horse_name,
        recommended_bet: b.recommended_bet,
        expected_return: b.expected_return,
        kelly_fraction: b.kelly_fraction,
      })),
      total_bet: bets.reduce((s, b) => s + b.recommended_bet, 0),
      total_expected_return: bets.reduce((s, b) => s + b.expected_return, 0),
    };
  });
