# ============================================================
# SaveGreen / train.py (ML 학습 스캐폴드)
# ------------------------------------------------------------
# 이 스크립트는 resources/static/dummy/ml_dataset.json 을 읽어
# "절감률(savingPct, 0~1)"을 예측하는 간단한 회귀 모델을 학습하고
# 결과를 data/model.pkl 로 저장합니다.
#
# 의도:
#  - FastAPI(app/model.py)는 '절감률'만 ML 예측으로 치환하고,
#    절감량/비용/회수기간/라벨은 기존 정책(CAPEX/단가/라벨 규칙)으로 계산합니다.
#  - model.pkl이 없으면 FastAPI는 룰 기반(DUMMY)으로 자동 폴백합니다.
#
# 입력 스키마 가정(ml_dataset.json의 각 레코드):
#  - type              : "factory|hospital|school|office" 중 하나
#  - region            : (현재 'daejeon' 고정이라 학습에는 미사용)
#  - energy_kwh        : 최근 연간 전력사용량 (float)
#  - eui_kwh_m2y       : 전력 EUI (kWh/㎡·yr)
#  - builtYear         : 준공연도 (int)
#  - floorAreaM2       : 연면적 (float)
# (원본 키들은 보존되어 있을 수 있으며, monthly/yearlyConsumption은 여기선 집계치만 씀)
#
# 타깃:
#  - savingPct ∈ [0.05, 0.30] 범위로 규제된 값(없으면 휴리스틱으로 생성 가능)
#
# 실행:
#   (venv 활성화 후)
#   pip install -U scikit-learn pandas numpy joblib
#   python -m app.train
# ============================================================

import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.metrics import r2_score, mean_absolute_error
from sklearn.linear_model import Ridge
import joblib


# --------------------------
# 경로 설정 (자동 탐색 + 환경변수 지원)
# --------------------------
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # 프로젝트 루트 (ml/)
OUT_DIR = ROOT / "data"                        # model.pkl 저장 위치
OUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_PATH = OUT_DIR / "model.pkl"

def find_dataset() -> Path:
	"""
	ml_dataset.json의 위치를 자동으로 찾는다.
	우선순위:
	1) 환경변수 ML_DATASET (절대/상대경로)
	2) ml/resources/static/dummy/ml_dataset.json   (ML 프로젝트 내부)
	3) SaveGreen_Spring/src/main/resources/static/dummy/ml_dataset.json (스프링 내부)
	"""
	# 1) 환경변수 우선
	env = os.environ.get("ML_DATASET")
	if env:
		p = Path(env)
		if p.exists():
			return p

	# 2) 후보 경로들
	candidates = [
		ROOT / "resources" / "static" / "dummy" / "ml_dataset.json",
		ROOT.parent / "SaveGreen_Spring" / "src" / "main" / "resources" / "static" / "dummy" / "ml_dataset.json",
	]
	for p in candidates:
		if p.exists():
			return p

	# 3) 실패 시 친절한 메시지
	raise FileNotFoundError(
		"ml_dataset.json not found.\n"
		f"tried: {', '.join(str(c) for c in candidates)}\n"
		"→ 해결: (A) 파일을 ml\\resources\\static\\dummy 로 복사하거나\n"
		"        (B) PyCharm Run 설정의 환경변수 ML_DATASET 로 절대경로 지정하세요."
	)

DATASET_PATH = find_dataset()



# --------------------------
# 데이터 로드 & 전처리
# --------------------------
def load_dataset(path: Path) -> pd.DataFrame:
	"""ml_dataset.json을 DataFrame으로 읽는다."""
	with path.open("r", encoding="utf-8") as f:
		raw = json.load(f)
	# 배열이든 객체든 유연하게 처리
	df = pd.DataFrame(raw if isinstance(raw, list) else raw.get("items", []))
	return df


def clamp(v, lo, hi):
	return max(lo, min(hi, v))


def build_training_frame(df: pd.DataFrame) -> pd.DataFrame:
	"""
	모델이 학습할 피처/타깃을 만든다.
	- 피처(X): type, builtYear, floorAreaM2, energy_kwh, eui_kwh_m2y
	- 타깃(y): savingPct (없으면 휴리스틱으로 생성)
	"""
	# 필수 컬럼 보정
	for c in ["type", "builtYear", "floorAreaM2", "energy_kwh", "eui_kwh_m2y"]:
		if c not in df.columns: df[c] = np.nan

	# 타입 미기재 → office로 폴백
	df["type"] = df["type"].fillna("office").str.lower()

	# builtYear/floor/energy/eui 결측/비정상값 처리
	df["builtYear"] = pd.to_numeric(df["builtYear"], errors="coerce").fillna(2008).astype(int)
	df["floorAreaM2"] = pd.to_numeric(df["floorAreaM2"], errors="coerce").fillna(1500.0).astype(float)
	df["energy_kwh"] = pd.to_numeric(df["energy_kwh"], errors="coerce").fillna(180000.0).astype(float)
	df["eui_kwh_m2y"] = pd.to_numeric(df["eui_kwh_m2y"], errors="coerce").astype(float)
	# eui가 없으면 proxy로 생성
	missing_eui = df["eui_kwh_m2y"].isna()
	df.loc[missing_eui, "eui_kwh_m2y"] = df.loc[missing_eui, "energy_kwh"] / df.loc[missing_eui, "floorAreaM2"].replace(0, np.nan)

	# 타깃: savingPct (없으면 간단 휴리스틱으로 생성)
	if "savingPct" not in df.columns:
		df["savingPct"] = np.nan
	df["savingPct"] = pd.to_numeric(df["savingPct"], errors="coerce")

	# 휴리스틱: 연식/타입/EUI 기반 가정으로 절감률 생성(데모용)
	needs = df["savingPct"].isna()
	if needs.any():
		# 타입별 베이스
		base = df["type"].map({
			"factory": 0.18, "hospital": 0.17, "school": 0.16, "office": 0.15
		}).fillna(0.15)
		# 연식 보정
		year = df["builtYear"]
		year_adj = np.where(year < 2000, 0.03, np.where(year <= 2010, 0.02, np.where(year <= 2018, 0.01, -0.01)))
		# EUI 보정
		eui = df["eui_kwh_m2y"]
		eui_adj = np.where(eui >= 220, 0.02, np.where(eui >= 180, 0.01, 0.0))
		df.loc[needs, "savingPct"] = base[needs] + year_adj[needs] + eui_adj[needs]

	# 안전 클램프
	df["savingPct"] = df["savingPct"].apply(lambda x: clamp(float(x), 0.05, 0.30))

	# 학습용 선택 컬럼만 반환
	return df[["type", "builtYear", "floorAreaM2", "energy_kwh", "eui_kwh_m2y", "savingPct"]].dropna()


def main():
	print(f"[train] loading dataset: {DATASET_PATH}")
	df_raw = load_dataset(DATASET_PATH)
	df = build_training_frame(df_raw)

	if len(df) < 10:
		print(f"[train][warn] samples too small: {len(df)} (>=10 권장)")

	X = df[["type", "builtYear", "floorAreaM2", "energy_kwh", "eui_kwh_m2y"]]
	y = df["savingPct"].astype(float)

	# 파이프라인: type → 원핫, 수치 → 스케일, 모델 → Ridge(간단하고 안정적)
	cat_cols = ["type"]
	num_cols = ["builtYear", "floorAreaM2", "energy_kwh", "eui_kwh_m2y"]

	ct = ColumnTransformer([
		("type", OneHotEncoder(handle_unknown="ignore"), cat_cols),
		("num", StandardScaler(), num_cols)
	])

	model = Ridge(alpha=1.0)

	pipe = Pipeline([
		("prep", ct),
		("model", model)
	])

	print("[train] fitting model...")
	pipe.fit(X, y)

	# 성능 로그(대략치)
	pred = pipe.predict(X)
	print(f"[train] r2={r2_score(y, pred):.3f}, MAE={mean_absolute_error(y, pred):.4f}")

	print(f"[train] saving to: {MODEL_PATH}")
	joblib.dump(pipe, MODEL_PATH)
	print("[train] done.")


if __name__ == "__main__":
	main()
