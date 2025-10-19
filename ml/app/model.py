# ============================================================
# SaveGreen / 모델 래퍼(더미 → 실전 교체 지점)
# ------------------------------------------------------------
# [이 파일의 목적]
# 	- FastAPI 엔드포인트(app.main)와 분리된 "예측 로직"의 단일 진입점.
# 	- 서버 기동 시 학습 모델 아티팩트(data/model.pkl)가 있으면 로드해서 사용하고,
# 	  없으면 규칙/휴리스틱 기반의 더미(DUMMY) 로직으로 안전하게 동작한다.
# 	- train.py가 모델을 학습해 pkl을 갱신하면, 서버 재시작만으로 실전에 반영 가능.
#
# [핵심 인터페이스]
# 	- predict(req_dict: dict) -> dict
# 		입력: 스프링에서 표준화된 JSON(dict)
# 		출력: savingKwhYr, savingCostYr, savingPct(%), paybackYears, label
#
# [현재 버전의 주요 정책/가정]
# 	- 타입별 정책(type_policy):
# 		* 전력단가(tariff, KRW/kWh)
# 		* CAPEX = capex_fixed + capex_per_m2 * max(0, floorArea - capex_free_area)
# 		* 기본 절감률(base_saving_pct, 0~1)
# 	- 절감률 보정:
# 		* 연식(builtYear) 보정: 오래될수록 절감 ↑, 최신일수록 약간 ↓
# 		* 부하율(load factor) 보정: 낮으면 약간 ↑, 매우 높으면 약간 ↓
# 		* (필요 시) EUI 보정은 추후 추가 가능
# 	- 라벨 기준:
# 		* RECOMMEND: savingPct ≥ 15% AND paybackYears ≤ 5년
# 		* CONDITIONAL: paybackYears ≤ 8년
# 		* 그 외 NOT_RECOMMEND
#
# [변경 내역(중요)]
# 	- 타입 정책값 업데이트(전력단가/고정비/무상구간/㎡당 CAPEX/기본 절감률).
# 	- CAPEX 계산식을 "고정비 + 무상구간 + 초과면적 비례"로 교체.
# 	- 알 수 없는 type의 폴백을 'office'로 변경(데모 스코프: 4종 고정).
# ============================================================

from typing import Dict, Any, Optional
from pathlib import Path
import pandas as pd

try:
	from joblib import load as joblib_load  # scikit-learn 계열 모델 로딩(선택)
except Exception:
	joblib_load = None  # 패키지 미설치 시 더미로 안전 처리

from .utils import monthly_features, yearly_total_kwh


class ModelManager:
	def __init__(self):
		# -------------------------------------------------------
		# [정책] 타입별 기본 가정값
		#  - tariff(KRW/kWh): 전력단가
		#  - capex_fixed(KRW): 기본 고정 투자(설계/계측/기준 장비 등)
		#  - capex_free_area(㎡): 이 면적까지는 고정비로 커버(무상구간)
		#  - capex_per_m2(KRW/㎡): 무상구간 초과면적에만 비례 비용 적용
		#  - base_saving_pct(0~1): 타입별 기본 절감률
		# -------------------------------------------------------
		self.type_policy = {
			"factory":  {"tariff": 140, "capex_fixed": 30_000_000, "capex_free_area": 500, "capex_per_m2": 220_000, "base_saving_pct": 0.18},
			"school":   {"tariff": 130, "capex_fixed": 25_000_000, "capex_free_area": 400, "capex_per_m2": 180_000, "base_saving_pct": 0.16},
			"hospital": {"tariff": 170, "capex_fixed": 40_000_000, "capex_free_area": 300, "capex_per_m2": 260_000, "base_saving_pct": 0.17},
			"office":   {"tariff": 150, "capex_fixed": 20_000_000, "capex_free_area": 300, "capex_per_m2": 200_000, "base_saving_pct": 0.15},
		}

		# 라벨 기준(권고/조건부/비권고)
		self.recommend_pct_threshold = 0.15
		self.recommend_payback_years = 5.0
		self.conditional_payback_years = 8.0

		# (선택) 학습 모델/전처리 로드
		self.model: Optional[Any] = None
		self.preprocess: Optional[Any] = None
		self.model_path = Path(__file__).resolve().parent.parent / "data" / "model.pkl"
		self.preprocess_path = Path(__file__).resolve().parent.parent / "data" / "preprocess.pkl"
		self._try_load_artifacts()

	def status(self) -> str:
		"""헬스체크/로그용 상태 문자열."""
		return "loaded" if self.model is not None else "dummy"

	def _try_load_artifacts(self):
		"""
		data/model.pkl, preprocess.pkl을 가능하면 로드한다.
		- joblib 미설치/모델 미존재 시 더미 모드로 안전하게 동작.
		"""
		if joblib_load is None:
			return
		try:
			if self.model_path.exists():
				self.model = joblib_load(self.model_path)
			if self.preprocess_path.exists():
				self.preprocess = joblib_load(self.preprocess_path)
			if self.model is not None:
				print(f"[ML] model loaded: {self.model_path.name}")
			else:
				print("[ML] model not found. Running in DUMMY mode.")
		except Exception as e:
			print(f"[ML] model load failed → DUMMY mode. reason={e}")
			self.model = None
			self.preprocess = None

	def _pick_policy(self, typ: str) -> Dict[str, float]:
		"""
		입력 type 문자열을 바탕으로 정책 딕셔너리를 선택한다.
		- 데모 스코프는 4종(type ∈ {factory, school, hospital, office})이므로
		  알 수 없는 값은 'office'로 폴백한다.
		"""
		return self.type_policy.get((typ or "office").lower(), self.type_policy["office"])

	def _adjust_saving_pct(self, base_pct: float, built_year: Optional[int]) -> float:
		"""
		절감률 연식 보정:
		- 오래될수록 개선 여지↑ → 약간 상향(최대 +0.03)
		- 최근 건물은 기본적으로 효율이 좋아 약간 하향(-0.01)
		- 하한은 5%로 클램프
		"""
		if not built_year:
			return base_pct
		if built_year < 2000:
            # 2000년 이전: 노후 → 개선 여지 큼
			base_pct += 0.03
		elif built_year <= 2010:
			base_pct += 0.02
		elif built_year <= 2018:
			base_pct += 0.01
		else:
			base_pct -= 0.01
		return max(0.05, base_pct)

	def _calc_label(self, saving_pct: float, payback_years: float) -> str:
		"""
		라벨 판정:
		- RECOMMEND: 절감률 충분(≥15%) + 회수기간 짧음(≤5년)
		- CONDITIONAL: 회수기간이 8년 이내 (절감률 요건 미달이어도 조건부)
		- NOT_RECOMMEND: 그 외
		"""
		if saving_pct >= self.recommend_pct_threshold and payback_years <= self.recommend_payback_years:
			return "RECOMMEND"
		if payback_years <= self.conditional_payback_years:
			return "CONDITIONAL"
		return "NOT_RECOMMEND"

	def _predict_dummy(self, req: Dict[str, Any]) -> Dict[str, Any]:
		"""
		룰 기반(더미) 예측 로직.
		- 입력: 스프링 표준화된 dict (type/region/builtYear/floorAreaM2/…)
		- 처리:
			1) 타입별 정책 조회
			2) 월/연 시계열에서 보조 특징(부하율 등) 추출
			3) 절감률 보정(연식, 부하율)
			4) 기준 사용량 산정(연시계열 평균 또는 월평균×12)
			5) CAPEX 계산(고정비 + 무상구간 + 초과면적 비례)
			6) 절감량/비용/회수기간/라벨 계산
		- 출력: KPI 딕셔너리
		"""
		typ = (req.get("type") or "office").lower()
		policy = self._pick_policy(typ)
		floor = float(req.get("floorAreaM2") or 0.0)
		built_year = req.get("builtYear")

		# 1) 월/연 특성
		m_feats = monthly_features(req.get("monthlyConsumption"))
		n_years, yearly_sum = yearly_total_kwh(req.get("yearlyConsumption"))

		# 2) 절감률(기본 + 연식 보정)
		saving_pct = self._adjust_saving_pct(policy["base_saving_pct"], built_year)

		# 3) 부하율 보정: 평균/피크 비율이 낮으면 개선 여지↑ (소폭 +), 매우 높으면 개선 여지↓ (소폭 -)
		lf = m_feats.get("load_factor", 0.0)
		if lf > 0:
			if lf < 0.5:
				saving_pct += 0.01
			elif lf >= 0.8:
				saving_pct -= 0.01
		# 안전 범위로 클램프(5~30%)
		saving_pct = max(0.05, min(saving_pct, 0.30))

		# 4) 기준 사용량: 연시계열 평균(데이터 없으면 월평균×12 폴백)
		baseline_kwh = (yearly_sum / n_years) if n_years > 0 else m_feats.get("avg_kwh", 0.0) * 12.0

		# 5) CAPEX 계산식 (중요 변경)
		# 	- 고정비(capex_fixed) + 초과면적 비례(capex_per_m2 × max(0, 면적 - capex_free_area))
		eff_area = max(0.0, floor - policy["capex_free_area"])
		if floor > 0:
			capex = policy["capex_fixed"] + policy["capex_per_m2"] * eff_area
		else:
			# 면적 정보가 없으면 보수적으로 500㎡ 기준을 적용(무상구간 반영)
			capex = policy["capex_fixed"] + policy["capex_per_m2"] * max(0.0, 500.0 - policy["capex_free_area"])

		# 6) KPI 산출
		saving_kwh_yr = baseline_kwh * saving_pct
		saving_cost_yr = saving_kwh_yr * policy["tariff"]
		payback_years = (capex / saving_cost_yr) if saving_cost_yr > 0 else 99.0
		label = self._calc_label(saving_pct, payback_years)

		return {
			"savingKwhYr": float(round(saving_kwh_yr, 2)),
			"savingCostYr": float(round(saving_cost_yr, 2)),
			"savingPct": float(round(saving_pct * 100.0, 2)),  # % 단위로 반환
			"paybackYears": float(round(payback_years, 2)),
			"label": label
		}

	def _featurize(self, req: Dict[str, Any]) -> Dict[str, float]:
		"""
		학습과 동일한 피처셋을 생성한다.
		- train.py와 동일: type(원핫은 파이프라인에서), builtYear, floorAreaM2, energy_kwh, eui_kwh_m2y
		- energy_kwh/eui는 요청에 명시가 없으면 월/연 시계열에서 근사 산출
		"""
		typ = (req.get("type") or "office").lower()
		floor = float(req.get("floorAreaM2") or 0.0)

		m_feats = monthly_features(req.get("monthlyConsumption"))
		n_years, yearly_sum = yearly_total_kwh(req.get("yearlyConsumption"))

		# 연간 사용량 근사
		if n_years > 0:
			energy_kwh = yearly_sum / n_years
		else:
			energy_kwh = m_feats.get("avg_kwh", 0.0) * 12.0

		# EUI
		eui = (energy_kwh / floor) if floor > 0 else 0.0

		return {
			"type": typ,
			"builtYear": int(req.get("builtYear") or 2010),
			"floorAreaM2": float(floor or 0.0),
			"energy_kwh": float(energy_kwh or 0.0),
			"eui_kwh_m2y": float(eui or 0.0),
		}

	def predict(self, req_dict: Dict[str, Any]) -> Dict[str, Any]:
		"""
		핵심 예측 함수.
		- 학습 모델이 있으면 그걸 사용(전처리 포함), 없으면 _predict_dummy로 대체.
		- 학습 모델 사용 시: train.py와 동일한 전처리/피처링을 반드시 재현해야 한다.
		"""
		if self.model is None:
			return self._predict_dummy(req_dict)

		# ==== 학습 모델 경로 ====
		try:
			# 1) 피처 생성
			feat = self._featurize(req_dict)
			dfX = pd.DataFrame([feat])  # 모델이 pandas 입력을 받아도 되도록

			# 2) 절감률 예측(0~1 범위로 클램프)
			pred_pct = float(self.model.predict(dfX)[0])
			pred_pct = max(0.05, min(pred_pct, 0.30))

			# 3) 아래는 기존 정책 계산 재사용
			typ = feat["type"]
			policy = self._pick_policy(typ)
			floor = feat["floorAreaM2"]

			# 기준 사용량
			baseline_kwh = feat["energy_kwh"]

			# CAPEX (고정비 + 무상구간 + 초과면적 비례)
			eff_area = max(0.0, floor - policy["capex_free_area"])
			if floor > 0:
				capex = policy["capex_fixed"] + policy["capex_per_m2"] * eff_area
			else:
				capex = policy["capex_fixed"] + policy["capex_per_m2"] * max(0.0, 500.0 - policy["capex_free_area"])

			# KPI
			saving_kwh_yr = baseline_kwh * pred_pct
			saving_cost_yr = saving_kwh_yr * policy["tariff"]
			payback_years = (capex / saving_cost_yr) if saving_cost_yr > 0 else 99.0
			label = self._calc_label(pred_pct, payback_years)

			return {
				"savingKwhYr": float(round(saving_kwh_yr, 2)),
				"savingCostYr": float(round(saving_cost_yr, 2)),
				"savingPct": float(round(pred_pct * 100.0, 2)),
				"paybackYears": float(round(payback_years, 2)),
				"label": label
			}
		except Exception as e:
			print(f"[ML] predict via model failed → fallback dummy. reason={e}")
			return self._predict_dummy(req_dict)



