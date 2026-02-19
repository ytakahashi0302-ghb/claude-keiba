"""
競馬データ分析 FastAPI サーバー
"""

import json
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from scrapers.upcoming_races import get_upcoming_races
from scrapers.odds_scraper import get_horses_with_odds
from scrapers.past_results import get_past_races, get_race_results
from scrapers.horse_history import get_horse_history
from calculators.expected_value import calculate_expected_values
from calculators.budget_optimizer import optimize_budget


class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"

    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")


app = FastAPI(
    title="Keiba Optimizer API",
    version="0.1.0",
    default_response_class=UTF8JSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://ytakahashi0302-ghb.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OptimizeRequest(BaseModel):
    race_id: str
    budget: int


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/races")
def list_races():
    races = get_upcoming_races()
    return {"races": races}


@app.get("/races/past")
def list_past_races():
    races = get_past_races(days=14)
    return {"races": races}


@app.get("/races/{race_id}/results")
def get_results(race_id: str):
    result = get_race_results(race_id)
    return result


@app.get("/races/{race_id}/horses")
def get_race_horses(race_id: str):
    horses = get_horses_with_odds(race_id)
    if not horses:
        raise HTTPException(status_code=404, detail="Race not found")
    # 各馬の過去成績を取得して EV 計算に反映
    for horse in horses:
        hid = horse.get("horse_id", "")
        if hid:
            horse["race_history"] = get_horse_history(hid, n_races=5)
    horses_with_ev = calculate_expected_values(horses)
    # race_history はフロントへ送らない（サイズ削減）
    for h in horses_with_ev:
        h.pop("race_history", None)
    return {"race_id": race_id, "horses": horses_with_ev}


@app.post("/optimize")
def optimize_bets(req: OptimizeRequest):
    horses = get_horses_with_odds(req.race_id)
    if not horses:
        raise HTTPException(status_code=404, detail="Race not found")
    bets = optimize_budget(horses, req.budget)
    total_expected = sum(b["expected_return"] for b in bets)
    return {
        "race_id": req.race_id,
        "budget": req.budget,
        "bets": bets,
        "expected_return": round(total_expected, 2),
    }
