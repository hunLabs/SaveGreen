# ============================================================
# SaveGreen / ML 유틸 함수 모음
# ------------------------------------------------------------
# 목적
# - 월별/연별 소비 데이터에서 간단한 통계/피처를 생성하여
#   모델 또는 휴리스틱 계산에 활용한다.
#
# 주의
# - 여기의 피처는 "가벼운 휴리스틱" 중심이며, 실제 학습 로직이
#   정교해지면 별도의 feature_engineering 모듈로 분리 가능.
# ============================================================

from typing import List, Optional, Tuple
from statistics import mean, pstdev


def safe_mean(values: List[float]) -> float:
	"""빈 리스트를 방어적으로 처리하는 평균 계산."""
	if not values:
		return 0.0
	return float(mean(values))


def safe_std(values: List[float]) -> float:
	"""표준편차(모표준편차). 데이터가 2개 미만이면 0 처리."""
	if not values or len(values) < 2:
		return 0.0
	return float(pstdev(values))


def monthly_features(monthly: Optional[List[dict]]) -> dict:
	"""
	월별 kWh 시계열에서 계절성/변동성 특징을 추출.
	반환 예:
	{
		"months": 12,
		"avg_kwh": 1234.5,
		"std_kwh": 321.0,
		"max_kwh": 2000.0,
		"min_kwh": 900.0,
		"load_factor": 0.62   # 평균/최대 (부하율)
	}
	"""
	if not monthly:
		return {
			"months": 0,
			"avg_kwh": 0.0,
			"std_kwh": 0.0,
			"max_kwh": 0.0,
			"min_kwh": 0.0,
			"load_factor": 0.0
		}

	seq = [float(m.get("electricity", 0.0)) for m in monthly]
	avg = safe_mean(seq)
	mx = max(seq) if seq else 0.0
	mn = min(seq) if seq else 0.0
	lf = (avg / mx) if mx > 0 else 0.0

	return {
		"months": len(seq),
		"avg_kwh": avg,
		"std_kwh": safe_std(seq),
		"max_kwh": mx,
		"min_kwh": mn,
		"load_factor": float(lf)
	}


def yearly_total_kwh(yearly: Optional[List[dict]]) -> Tuple[int, float]:
	"""
	연별 kWh 시계열에서 (포인트 개수, 총합)을 반환.
	- 개수가 적은 최근 준공 건물의 경우 총합이 작아질 수 있음.
	"""
	if not yearly:
		return 0, 0.0
	seq = [float(y.get("electricity", 0.0)) for y in yearly]
	return len(seq), float(sum(seq))
