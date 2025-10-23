# ============================================================
# SaveGreen / ML 스키마 정의 (Pydantic v2)
# ------------------------------------------------------------
# 이 파일은 FastAPI ↔ Spring 간의 "요청/응답 계약"을 명확히 하기 위한
# Pydantic 모델(데이터 클래스)을 정의한다.
#
# 핵심 목적
# 1) 예측 입력(PredictRequest): 스프링이 표준화한 값(type/region 등)을 받아
#    ML 엔진이 사용할 수 있도록 구조화.
# 2) 예측 출력(PredictResponse): FE가 차트/KPI/배너를 즉시 렌더할 수 있도록
#    model.py가 생성하는 최종 응답(JSON)과 1:1로 맞춘다.
#
# 유지보수 팁
# - 스키마 변경은 항상 여기(schema.py)에서 먼저 반영하고,
#   스프링 쪽 DTO와 동기화할 것.
# - Pydantic v2 기준으로 작성(필요 시 v1과의 호환 주의).
# - 필요 없는 필드는 Optional 로 선언하여 단계적 확장을 용이하게 한다.
# ============================================================

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ----------------------------- 입력 스키마 -----------------------------

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
	- A안 기준: ML 모델 입력은 훈련 스키마와 동일한 5개 특성으로 사용하며,
	  energy_kwh/eui_kwh_m2y는 예측단에서 파생 계산 가능.
	"""
	type: str = Field(..., description="표준화된 유형(factory|school|hospital|office|other 등)")
	region: Optional[str] = Field(None, description="표준화된 지역 코드(예: dae, dae_seo 등)")
	builtYear: Optional[int] = Field(None, description="준공연도(예: 2006)")
	floorAreaM2: Optional[float] = Field(None, description="연면적(㎡)")
	monthlyConsumption: Optional[List[MonthPoint]] = Field(None, description="월간 kWh 배열(1~12)")
	yearlyConsumption: Optional[List[YearPoint]] = Field(None, description="연간 kWh 배열(년도 순)")
	buildingName: Optional[str] = Field(None, description="표시/추적용 건물명")
	pnu: Optional[str] = Field(None, description="표시/추적용 PNU")
	address: Optional[str] = Field(None, description="표시/추적용 주소(도로명/지번 중 하나)")

	# 선택적으로 들어올 수 있는 KPI 계산용 파라미터(없으면 서버/ML에서 기본값 사용)
	tariffKrwPerKwh: Optional[float] = Field(None, description="전력 단가(KRW/kWh)")
	capexPerM2: Optional[float] = Field(None, description="CAPEX (KRW/㎡)")
	electricityEscalationPctPerYear: Optional[float] = Field(None, description="전력 단가 연 상승률(소수)")
	discountRate: Optional[float] = Field(None, description="할인율(소수, 선택)")
	pef: Optional[float] = Field(None, description="Primary Energy Factor, 선택")
	# 원시 측정/추정치가 직접 들어오는 경우(없어도 됨)
	energy_kwh: Optional[float] = Field(None, description="연간 전력 사용량(kWh) — 없으면 파생 계산")
	eui_kwh_m2y: Optional[float] = Field(None, description="EUI(kWh/㎡·년) — 없으면 파생 계산")
	# 메타
	meta: Optional[Dict[str, Any]] = Field(None, description="추가 메타(디버그/추적 용도)")


# ----------------------------- 출력 스키마 -----------------------------

class Series(BaseModel):
	"""차트용 시계열"""
	after: List[float] = Field(..., description="개선 후 연간 사용량(kWh/년) - 연도 배열과 길이 동일")
	savingKwhYr: List[float] = Field(..., description="연간 절감량(kWh/년) - 연도 배열과 길이 동일")


class Cost(BaseModel):
	"""비용 시계열"""
	savingKrwYr: List[float] = Field(..., description="연간 비용 절감(원/년) - 연도 배열과 길이 동일")


class Kpi(BaseModel):
	"""요약 KPI"""
	savingCostYr: float = Field(..., description="마지막 연도의 비용 절감(원/년)")
	savingKwhYr: float = Field(..., description="연간 절감량(kWh/년), 기준-개선")
	savingPct: float = Field(..., description="절감률(%)")
	paybackYears: float = Field(..., description="투자 회수 기간(년)")
	label: str = Field(..., description="RECOMMEND | CONDITIONAL | NOT_RECOMMEND")


class PredictResponse(BaseModel):
	"""
	예측 응답(풀 스키마): FE가 바로 렌더 가능한 구조.
	model.py 의 _finalize_response() 결과와 1:1로 맞춘다.
	- 필수: schemaVersion, years, series, cost, kpi
	- 선택: modelVersion/variant/source/contextEcho/uiHints/debug
	"""
	# 공통 메타
	schemaVersion: str
	modelVersion: Optional[str] = Field(None, description="모델 버전(없으면 manifest/version 힌트)")
	variant: Optional[str] = Field(None, description="A|B|C")
	source: Optional[str] = Field(None, description="ML | RULE_FALLBACK | DUMMY")

	# 본문(차트/계산)
	years: List[int]
	series: Series
	cost: Cost
	kpi: Kpi

	# 부가 정보(선택)
	contextEcho: Optional[Dict[str, Any]] = Field(None, description="요청 컨텍스트 에코(건물명/PNU 등)")
	uiHints: Optional[Dict[str, Any]] = Field(None, description="프런트 표시 힌트(축 범위/애니메이션 순서 등)")
	debug: Optional[Dict[str, Any]] = Field(None, description="디버깅 정보(경고/요청ID 등)")
