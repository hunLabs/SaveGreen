# ============================================================
# SaveGreen / app/model.py — ML 예측 매니저(A/B/C) 전체 코드
# ------------------------------------------------------------
# [역할]
# 1) ./data 폴더의 model_A.pkl, model_B.pkl(선택), manifest.json(선택)을 로드.
# 2) /predict(variant=A|B|C) 요청을 받아 절감률(%)(savingPct)을 예측.
#    - A/B: 개별 모델 출력
#    - C  : A/B 가중 앙상블(둘 중 하나 없으면 생존 모델로 폴백)
# 3) 예측 실패 시 규칙기반 폴백(RULE_FALLBACK)으로 응답 스키마 유지.
#
# [이번 패치 핵심 — A안 확정]
# - "훈련 스키마 == 예측 스키마" 보장.
#   * 모델 입력 특성(순서 고정): ["type","floorAreaM2","builtYear","energy_kwh","eui_kwh_m2y"]
#   * 예측 시, payload에서 energy_kwh/eui_kwh_m2y 파생 계산:
#     - energy_kwh: payload.energy_kwh > payload.baselineKwh > floorAreaM2×DEFAULT_EUI
#     - eui_kwh_m2y: energy_kwh / floorAreaM2 (floor=0이면 DEFAULT_EUI)
#
# [입/출력 스키마 요약]
# - 입력(payload): type, region(선택), floorAreaM2, builtYear, yearsFrom, yearsTo,
#                  (선택)energy_kwh, (선택)baselineKwh,
#                  (KPI용) tariffKrwPerKwh, capexPerM2, electricityEscalationPctPerYear, discountRate, pef
# - 출력: modelVersion, years[], series.after[], series.savingKwhYr[],
#        cost.savingKrwYr[], kpi{ savingCostYr, savingKwhYr, savingPct, paybackYears, label },
#        debug.warnings[], source(ML|RULE_FALLBACK), uiHints.costAxisMax 등
#
# [경로 정책]
# - 기본 경로: ./data
# - (읽기만 허용) 과거 호환: ./app/data — 존재 시 경고 로그만 찍고 참조
#   ※ 저장(train.py)은 항상 ./data 로만 수행됨.
# ============================================================

from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List
from datetime import datetime

# joblib 우선, 없으면 pickle 폴백
try:
    import joblib
    _LOAD = joblib.load
except Exception:
    import pickle
    def _LOAD(path: str):
        with open(path, "rb") as f:
            return pickle.load(f)

# DataFrame 열 순서 고정용
import pandas as pd


# ---------------------------- 상수/설정 ----------------------------

DATA_PRIMARY = "./data"
DATA_DEPRECATED = "./app/data"   # 읽기만! (저장은 금지)

_BASE_DIR = Path(__file__).resolve().parents[1]  # .../ml
DATA_PRIMARY = str(_BASE_DIR / "data")           # 항상 여기서 로드
DATA_DEPRECATED = str(_BASE_DIR / "app" / "data")  # 옛 파일 읽기만 허용(경고)

MODEL_A = "model_A.pkl"
MODEL_B = "model_B.pkl"
MANIFEST = "manifest.json"

# 훈련 시 기대 컬럼(순서 고정)
EXPECTED_FEATURES_A: List[str] = [
    "type", "floorAreaM2", "builtYear", "energy_kwh", "eui_kwh_m2y"
]
EXPECTED_FEATURES_B: List[str] = [
    "type", "floorAreaM2", "builtYear", "energy_kwh", "eui_kwh_m2y"
]

# 데모용 기본값(정책 모듈로 대체 가능)
DEFAULT_EUI = 250.0                 # kWh/㎡·년
DEFAULT_TARIFF = 130.0              # KRW/kWh
DEFAULT_CAPEX_PER_M2 = 200_000.0    # KRW/㎡
DEFAULT_ESCALATION = 0.03           # 전력단가 연 상승률
UI_COST_AXIS_MAX = 60_000_000       # 우측 축 고정(요구사항)


# ---------------------------- 경로/유틸 ----------------------------

def _first_existing_path(*candidates: str) -> Optional[str]:
    """여러 경로 후보 중 먼저 존재하는 파일을 반환."""
    for p in candidates:
        if p and os.path.isfile(p):
            return p
    return None

def _resolve(pathname: str) -> Optional[str]:
    """
    동일 파일명을 표준 위치(./data)에서 먼저 찾고,
    없으면 (비권장) ./app/data 에서 찾는다(읽기 전용, 경고 출력).
    """
    p1 = os.path.join(DATA_PRIMARY, pathname)
    p2 = os.path.join(DATA_DEPRECATED, pathname)
    found = _first_existing_path(p1, p2)
    if found and found.startswith(DATA_DEPRECATED):
        print(f"[ML][WARN] using deprecated path: {found}  (please move files to {DATA_PRIMARY})")
        print("[ML] resolved", os.path.abspath(found))
    return found

def _safe_float(v: Any, default: float = 0.0) -> float:
    """숫자 변환 헬퍼(예외 시 기본값)."""
    try:
        return float(v)
    except Exception:
        return float(default)

def _build_years(years_from: int | None, years_to: int | None) -> list[int]:
    """
    응답 years[] 생성:
    - 둘 다 있으면 [from..to] 양끝 포함
    - 하나만 있으면: from=값, to=from+10
    - 둘 다 없으면: [올해..올해+10]
    """
    now = datetime.now().year
    yf = int(years_from) if years_from else now
    yt = int(years_to)   if years_to   else (yf + 10)
    if yt < yf:
        yf, yt = yt, yf
    return list(range(yf, yt + 1))  # inclusive


# ---------------------------- DataFrame 빌더 ----------------------------

def _derive_energy_eui(payload: Dict[str, Any]) -> Tuple[float, float]:
    """
    payload에서 energy_kwh/eui_kwh_m2y 를 파생 계산한다.
    우선순위:
    1) payload.energy_kwh
    2) payload.baselineKwh
    3) floorAreaM2 × DEFAULT_EUI
    """
    floor = _safe_float(payload.get("floorAreaM2"), 0.0)
    energy = payload.get("energy_kwh")
    if energy is None:
        energy = payload.get("baselineKwh")
    if energy is None:
        energy = (floor * DEFAULT_EUI) if floor > 0 else 300_000.0
    energy = _safe_float(energy, 0.0)

    if floor > 0:
        eui = energy / floor
    else:
        eui = DEFAULT_EUI
    return energy, eui

def _make_feature_frame(payload: Dict[str, Any], expected_cols: List[str]) -> pd.DataFrame:
    """
    예측 입력(payload) → 훈련 시 기대하는 컬럼만 뽑아 순서를 고정한 DataFrame 생성.
    (이번 패치) 모델 입력은 훈련 스키마와 동일한 5개:
      ["type","floorAreaM2","builtYear","energy_kwh","eui_kwh_m2y"]
    - 여분 컬럼(region/tariff/capex 등)은 무시.
    - 누락 컬럼은 파생 계산 또는 None 보정.
    """
    # 필수/기본
    type_ = payload.get("type")
    floor = payload.get("floorAreaM2")
    built = payload.get("builtYear")

    # 파생: energy_kwh / eui_kwh_m2y
    energy_kwh, eui = _derive_energy_eui(payload)

    row = {
        "type": type_,
        "floorAreaM2": floor,
        "builtYear": built,
        "energy_kwh": energy_kwh,
        "eui_kwh_m2y": eui,
    }
    df = pd.DataFrame([row])
    for c in expected_cols:
        if c not in df.columns:
            df[c] = None
    return df[expected_cols]


# ---------------------------- 모델 로더 ----------------------------

class _Loaded:
    def __init__(self, path: str, pipe: Any):
        self.path = path
        self.pipe = pipe


class ModelManager:
    """
    모델 파일 로드/상태 관리 및 예측(variant A/B/C).
    - A/B: 각각의 파이프라인에 맞춘 DataFrame으로 예측
    - C  : A/B를 가중 결합(둘 중 하나만 있으면 생존 모델로 폴백)
    """
    def __init__(self) -> None:
        self.A: Optional[_Loaded] = None
        self.B: Optional[_Loaded] = None
        self.manifest: Optional[dict] = None
        self._load_all()

    def _load_all(self) -> None:
        # manifest
        mf = _resolve(MANIFEST)
        if mf:
            try:
                with open(mf, "r", encoding="utf-8") as f:
                    self.manifest = json.load(f)
            except Exception as e:
                print(f"[ML][WARN] failed to load manifest: {e!r}")

        # models
        pA = _resolve(MODEL_A)
        pB = _resolve(MODEL_B)
        if pA:
            try:
                self.A = _Loaded(pA, _LOAD(pA))
            except Exception as e:
                print(f"[ML][WARN] failed to load A: {e!r}")
        if pB:
            try:
                self.B = _Loaded(pB, _LOAD(pB))
            except Exception as e:
                print(f"[ML][WARN] failed to load B: {e!r}")

        print(f"[ML] model loaded: A={'ok' if self.A else '-'} B={'ok' if self.B else '-'} manifest={'ok' if self.manifest else '-'}")

    # ---------------------- 예측 엔트리 ----------------------

    def predict_variant(self, payload: Dict[str, Any], variant: str = "C") -> Dict[str, Any]:
        """
        variant=A|B|C 에 따라 절감률(%)을 산출하고, 표준 응답 스키마로 변환.
        예측 실패/모델 부재 시 RULE_FALLBACK로 대체.
        """
        var = (variant or "C").upper()
        source = "ML"
        warnings: List[str] = []

        try:
            saving_pct = self._predict_pct(payload, var, warnings)
        except Exception as e:
            # 예측 파이프라인 전체 실패 → 규칙 폴백
            source = "RULE_FALLBACK"
            warnings.append(f"PREDICT_FAIL:{repr(e)}")
            saving_pct = self._rule_fallback_pct(payload)

        # 응답 생성
        years = _build_years(payload.get("yearsFrom"), payload.get("yearsTo"))
        resp = self._finalize_response(payload, years, saving_pct)
        resp.setdefault("debug", {})["warnings"] = warnings
        resp["source"] = source
        resp["variant"] = var
        resp["uiHints"] = {"costAxisMax": UI_COST_AXIS_MAX, "animation": {"order": "bar->point->line"}}
        return resp

    # ---------------------- 핵심 로직 ----------------------

    def _predict_pct(self, payload: Dict[str, Any], variant: str, warnings: List[str]) -> float:
        """
        A/B/C 절감률(%) 예측. A/B는 동일한 훈련 스키마(5컬럼)를 사용.
        C는 A/B 가중 평균(둘 중 하나만 있으면 생존 모델 채택).
        """
        if variant == "A":
            if not self.A:
                warnings.append("A_MISSING")
                return self._rule_fallback_pct(payload)
            return self._predict_with(self.A, payload, EXPECTED_FEATURES_A, "A", warnings)

        if variant == "B":
            if not self.B:
                warnings.append("B_MISSING")
                return self._rule_fallback_pct(payload)
            return self._predict_with(self.B, payload, EXPECTED_FEATURES_B, "B", warnings)

        # C: 앙상블
        a = self._predict_with(self.A, payload, EXPECTED_FEATURES_A, "A", warnings) if self.A else None
        b = self._predict_with(self.B, payload, EXPECTED_FEATURES_B, "B", warnings) if self.B else None

        if a is None and b is None:
            warnings.append("AB_MISSING")
            return self._rule_fallback_pct(payload)
        if a is None:
            return b if b is not None else self._rule_fallback_pct(payload)
        if b is None:
            return a

        wA, wB = self._ensemble_weights()
        return max(0.0, min(wA * a + wB * b, 100.0))

    def _predict_with(
        self,
        loaded: Optional[_Loaded],
        payload: Dict[str, Any],
        expected_cols: List[str],
        tag: str,
        warnings: List[str]
    ) -> Optional[float]:
        """
        단일 파이프라인 예측.
        - expected_cols로 DataFrame을 만들어 ColumnTransformer에 정확히 맞춤.
        - 실패 시 None을 반환하고 warnings에 기록.
        """
        if not loaded:
            return None
        try:
            X = _make_feature_frame(payload, expected_cols)
            y = loaded.pipe.predict(X)
            val = float(y[0] if hasattr(y, "__len__") else y)
            return max(0.0, min(val, 100.0))
        except Exception as e:
            print(f"[ML][WARN] predict failed via {loaded.path}: {e!r}")
            warnings.append(f"{tag}_FAIL:{repr(e)}")
            return None

    def _ensemble_weights(self) -> Tuple[float, float]:
        """
        가중치 우선순위:
        1) manifest.ensemble.suggested_by_inverse_mae.{wA,wB}
        2) manifest.ensemble.{wA,wB}
        3) (0.5, 0.5)
        합=1.0 정규화.
        """
        wA, wB = 0.5, 0.5
        if isinstance(self.manifest, dict):
            ens = self.manifest.get("ensemble") or {}
            sugg = ens.get("suggested_by_inverse_mae") or {}
            sA, sB = sugg.get("wA"), sugg.get("wB")
            if isinstance(sA, (int, float)) and isinstance(sB, (int, float)):
                wA, wB = float(sA), float(sB)
            else:
                mA, mB = ens.get("wA"), ens.get("wB")
                if isinstance(mA, (int, float)) and isinstance(mB, (int, float)):
                    wA, wB = float(mA), float(mB)

        total = (wA or 0.0) + (wB or 0.0)
        if total <= 0:
            return 0.5, 0.5
        return wA / total, wB / total

    # ---------------------- 폴백/최종 응답 ----------------------

    def _rule_fallback_pct(self, payload: Dict[str, Any]) -> float:
        """
        간단한 규칙 기반 절감률(예시): 건물 연식/면적에 따른 대략치.
        실운영에서는 dae.json/정책 모듈을 참조해 계산하세요.
        """
        built = int(payload.get("builtYear") or 2000)
        floor = _safe_float(payload.get("floorAreaM2"), 1000.0)
        age_bonus = max(0, 2025 - built) * 0.15  # 연식 1년당 0.15%p
        size_term = 5.0 if floor > 1000 else 3.0
        pct = 10.0 + size_term + age_bonus
        return max(5.0, min(pct, 30.0))

    def _finalize_response(self, payload: Dict[str, Any], years: List[int], saving_pct: float) -> Dict[str, Any]:
        """
        years/series/cost/kpi를 포함하는 표준 응답을 생성.
        - baselineKwh이 없으면 floorAreaM2×DEFAULT_EUI를 사용.
        - cost.savingKrwYr은 연도별 전력단가 상승률을 반영.
        """
        floor = _safe_float(payload.get("floorAreaM2"), 0.0)
        baseline_kwh = _safe_float(
            payload.get("baselineKwh"),
            floor * DEFAULT_EUI if floor > 0 else 300_000.0
        )

        tariff0 = _safe_float(payload.get("tariffKrwPerKwh"), DEFAULT_TARIFF)
        escal = _safe_float(payload.get("electricityEscalationPctPerYear"), DEFAULT_ESCALATION)
        capex_per_m2 = _safe_float(payload.get("capexPerM2"), DEFAULT_CAPEX_PER_M2)

        # after = baseline × (1 - pct)
        after = baseline_kwh * (1.0 - saving_pct / 100.0)
        series_after = [round(after, 4) for _ in years]

        # savingKwh는 단순 동일(연차별 변화 필요시 정책 반영)
        saving_kwh = baseline_kwh - after
        series_saving_kwh = [round(saving_kwh, 4) for _ in years]

        # 비용 절감(연도별 전력단가 상승)
        cost_saving_krw = []
        for i, _y in enumerate(years):
            tariff_year_i = tariff0 * ((1.0 + escal) ** i)
            cost_saving_krw.append(round(saving_kwh * tariff_year_i, 2))

        # KPI(마지막 연도 기준)
        capex = floor * capex_per_m2 if floor > 0 else 0.0
        last_saving_cost = cost_saving_krw[-1] if cost_saving_krw else 0.0
        payback = (capex / last_saving_cost) if last_saving_cost > 0 else 99.0

        label = "RECOMMEND" if (saving_pct >= 15.0 and payback <= 5.0) else ("CONDITIONAL" if payback <= 8.0 else "NOT_RECOMMEND")

        return {
            "schemaVersion": "1.0",
            "modelVersion": self._model_version_hint(),
            "years": years,
            "series": {
                "after": series_after,
                "savingKwhYr": series_saving_kwh
            },
            "cost": {
                "savingKrwYr": cost_saving_krw
            },
            "kpi": {
                "savingCostYr": last_saving_cost,
                "savingKwhYr": round(saving_kwh, 4),
                "savingPct": round(saving_pct, 4),
                "paybackYears": round(payback, 3),
                "label": label
            },
            "contextEcho": {
                "buildingName": payload.get("buildingName"),
                "pnu": payload.get("pnu")
            }
        }

    def _model_version_hint(self) -> str:
        """manifest에서 버전 힌트를 가져오거나 기본값 제공."""
        try:
            if self.manifest and isinstance(self.manifest, dict):
                ver = self.manifest.get("modelVersion") or self.manifest.get("version")
                if isinstance(ver, str) and ver.strip():
                    return ver.strip()
        except Exception:
            pass
        return "2025.10.C"


# ---------------------------- 외부 사용 헬퍼 ----------------------------

# 전역 싱글톤처럼 사용할 수 있게 매니저 인스턴스 생성(서버 시작 시 로드)
MODEL = ModelManager()

def predict(payload: Dict[str, Any], variant: str = "C") -> Dict[str, Any]:
    """
    외부(서버 핸들러)에서 직접 호출하는 진입점.
    - payload(dict): 프런트/스프링에서 전달한 예측 입력
    - variant(str): "A"|"B"|"C"(기본 C)
    """
    return MODEL.predict_variant(payload, variant)
