# ============================================================
# SaveGreen / ML 스키마 정의 (Pydantic v2)
# ------------------------------------------------------------
# 이 파일은 FastAPI ↔ Spring 간의 "요청/응답 계약"을 명확히 하기 위한
# Pydantic 모델(데이터 클래스)을 정의한다.
#
# 핵심 목적
# 1) 예측 입력(PredictRequest): 스프링이 표준화한 값(type/region 등)을 받아
#    ML 엔진이 사용할 수 있도록 구조화.
# 2) 예측 출력(PredictResponse): KPI/차트에 필요한 핵심 값을 딱 맞게 반환.
#
# 유지보수 팁
# - 스키마 변경은 항상 여기(schema.py)에서 먼저 반영하고,
#   스프링 쪽 DTO와 동기화할 것.
# - pydantic v2 기준으로 작성(필요 시 v1과의 호환 주의).
# ============================================================

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class MonthPoint(BaseModel):
	"""월간 전력 사용량 데이터 포인트"""
	month: int = Field(..., description="1~12")
	electricity: float = Field(..., description="월간 전력 사용량(kWh)")


class YearPoint(BaseModel):
	"""연간 전력 사용량 데이터 포인트"""
	year: int = Field(..., description="예: 2018")
	electricity: float = Field(..., description="연간 전력 사용량(kWh)")


class PredictRequest(BaseModel):
	"""
	스프링에서 "표준화된 입력"을 받아 ML 추론에 사용하는 요청 스키마.
	- type, region은 서버 단일 표준화 규칙을 거친 값이어야 함.
	- monthlyConsumption/yearlyConsumption은 옵션(없어도 동작 가능한 설계).
	"""
	type: str = Field(..., description="표준화된 유형(factory|school|hospital|office|other 등)")
	region: Optional[str] = Field(None, description="표준화된 지역 코드(예: dae, dae_seo 등)")
	builtYear: Optional[int] = Field(None, description="준공연도(예: 2006)")
	floorAreaM2: Optional[float] = Field(None, description="연면적(㎡)")
	monthlyConsumption: Optional[List[MonthPoint]] = Field(None, description="월간 kWh 배열(1~12)")
	yearlyConsumption: Optional[List[YearPoint]] = Field(None, description="연간 kWh 배열(년도 순)")
	meta: Optional[Dict[str, Any]] = Field(None, description="추가 메타(디버그/추적 용도)")


class PredictResponse(BaseModel):
	"""
	예측 응답 스키마 — FE KPI/차트에 바로 쓸 수 있는 형태.
	- savingKwhYr: 연간 절감량(kWh/년)
	- savingCostYr: 연간 비용 절감(원/년)
	- savingPct: 절감률(%)
	- paybackYears: 투자 회수기간(년)
	- label: RECOMMEND | CONDITIONAL | NOT_RECOMMEND
	"""
	savingKwhYr: float
	savingCostYr: float
	savingPct: float
	paybackYears: float
	label: str
