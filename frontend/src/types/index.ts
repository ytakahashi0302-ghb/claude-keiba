export interface Race {
  race_id: string;
  race_name: string;
  course: string;
  date: string;
  venue: string;
  race_number: number;
}

export interface Horse {
  horse_id: string;
  horse_name: string;
  jockey: string;
  weight: number;
  odds_win: number;
  odds_place: number;
  horse_number: number;
  gate_number?: number;          // 枠番 1-8
  body_weight?: number;          // 馬体重 (kg)
  weight_change?: number | null; // 馬体重変化 (kg)
  win_probability?: number;
  expected_value?: number;
}

export interface BetRecommendation {
  horse_id: string;
  horse_name: string;
  recommended_bet: number;
  expected_return: number;
  kelly_fraction: number;
}

export interface OptimizeResponse {
  recommendations: BetRecommendation[];
  total_bet: number;
  total_expected_return: number;
}

export interface HorseResult {
  ranking: number | null;
  horse_number: number;
  horse_name: string;
  jockey: string;
  time: string;
  odds_win: number;
  popularity: number;
  win_probability: number;
  expected_value: number;
}

export interface PayoutResult {
  horse_numbers: string;
  amount: number;
  popularity: string;
}

export interface Payout {
  type: string;
  results: PayoutResult[];
}

export interface RaceResult {
  race_id: string;
  race_name: string;
  venue: string;
  date: string;
  course: string;
  horses: HorseResult[];
  payouts: Payout[];
}
