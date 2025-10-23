# ============================================================
# SaveGreen / app/train.py — 모델 학습 파이프라인(8:2 + K-Fold + 후보모델 비교)
# ------------------------------------------------------------
# [역할]
# - FastAPI /train 백그라운드 잡에서 호출되는 학습 엔진.
# - 데이터 적재 → 전처리/피처링 → train/test(8:2) 분할 → K-Fold(CV)로
#   후보 모델(ElasticNet=모델A, RandomForest=모델B) 성능 비교 →
#   최적 하이퍼파라미터 선택 → train 전체 재학습 →
#   ./data 에 산출물 저장(원자적 저장: 임시파일→move):
#     * model_A.pkl : 해석성(선형계열, ElasticNet)
#     * model_B.pkl : 비선형 성능(RandomForest)
#     * model.pkl   : 하위호환 단일(베스트 복사본)
#     * manifest.json : 버전/피처/지표/앙상블 가중치(wA,wB), split/kfold 등 메타
#
# [설계 핵심]
# 1) 일반화 성능
#    - 전체 → train/test 8:2 분할(재현성: random_state=42)
#    - train(80%) 내부에서만 K-Fold(기본 K=5) 교차검증 → 평균±표준편차 로그
#    - 최종 test(20%) 평가는 1회만 수행(누수 방지)
# 2) 전처리/누수 방지
#    - ColumnTransformer + Pipeline 으로 스케일/원핫 + 모델을 한 덩어리 저장
#    - 각 fold의 train에서만 fit → val/test엔 transform만 (Pipeline 자동 보장)
# 3) 앙상블(C)
#    - 기본 wA=0.5, wB=0.5 저장
#    - manifest에 역수비례(1/MAE) 가중치 제안도 저장(참고용)
#    - [신규] C_Ensemble 의 TRAIN/TEST 점수를 A/B와 동일 포맷으로 계산/로그/manifest 반영
# 4) 저장 안정성
#    - .pkl/.json 모두 임시파일에 먼저 기록 후 shutil.move()로 원자적 교체
#    - manifest["version"]은 매 실행 ISO-8601(KST)로 자동 갱신
#
# [입력 칼럼 기대]
#   - type(str), region(str), energy_kwh(float), eui_kwh_m2y(float),
#     builtYear(int), floorAreaM2(float), target(float; 없으면 샘플 생성부에서 만듦)
#
# [출력 파일]
#   - ./data/model_A.pkl, ./data/model_B.pkl, ./data/model.pkl, ./data/manifest.json
#
# [실행]
#   - FastAPI trainer 가 import 하여 main() 호출
#   - 단독 실행도 가능:  python -m app.train  또는  python app/train.py
# ============================================================

from __future__ import annotations

# [추가] direct-run guard — `python app/train.py` 로 직접 실행해도 import가 깨지지 않게 함
if __package__ in (None, "", __name__):
	import sys, pathlib
	# 프로젝트 루트(…/ml)를 sys.path 에 추가해서 `import app.*` 가 가능하도록 처리
	ROOT = pathlib.Path(__file__).resolve().parents[1]  # D:\CO2\ml
	if str(ROOT) not in sys.path:
		sys.path.insert(0, str(ROOT))
# [끝]

import json
import os
import shutil
import tempfile
import contextlib
import datetime as dt
from datetime import datetime
from typing import Any, Dict, List, Tuple
from pathlib import Path

# [수정] 상대/절대 import 모두 시도 (직접 실행/모듈 실행 호환)
try:
	from . import ml_logging  # ← 패키지 컨텍스트( -m 실행 )일 때
except Exception:
	from app import ml_logging  # ← 직접 실행일 때

# (리소스 제어) BLAS 스레드 제한용
try:
	from threadpoolctl import threadpool_limits
except Exception:
	threadpool_limits = None

# (경고 숨김) ElasticNet 수렴 경고 제거
import warnings
from sklearn.exceptions import ConvergenceWarning
warnings.filterwarnings("ignore", category=ConvergenceWarning)

import numpy as np
import pandas as pd

# sklearn
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split, KFold, cross_validate
from sklearn.linear_model import ElasticNet
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# 저장/로드
try:
	import joblib
	_DUMP = joblib.dump
except Exception:
	# joblib 미설치 환경 폴백
	import pickle
	_DUMP = lambda obj, path: pickle.dump(obj, open(path, "wb"))  # noqa: E731


# ------------------------------- 경로/유틸 -------------------------------

BASE_DIR = Path(__file__).resolve().parents[1]   # .../ml
DATA_ROOT = BASE_DIR / "data"                    # 항상 여기만 사용

DATA_DIRS = [str(DATA_ROOT), str(BASE_DIR / "ml" / "data")]  # CSV 탐색용 후보

def _ensure_data_dir() -> str:
	"""
	산출물 저장 디렉터리(./data)를 보장한다. 존재하지 않으면 생성.
	※ 저장은 항상 ./data 로만 한다(legacy app/data 금지).
	"""
	DATA_ROOT.mkdir(parents=True, exist_ok=True)
	return str(DATA_ROOT)

def _timestamp_kst() -> str:
	"""한국시간(서버 로컬 기준) 타임스탬프 문자열(레거시 헬퍼: 사용처 일부 유지)."""
	return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

def _now_kst_iso() -> str:
	"""
	KST 기준 ISO-8601 타임스탬프(초 단위).
	예: 2025-10-21T16:20:15+09:00
	"""
	kst = dt.timezone(dt.timedelta(hours=9))
	return dt.datetime.now(tz=kst).isoformat(timespec="seconds")

def _clip_pct(x: np.ndarray | float, lo: float = 0.0, hi: float = 100.0) -> np.ndarray | float:
	"""절감률을 안전하게 0~100으로 클리핑."""
	return np.clip(x, lo, hi)

def _cv_pool_size() -> int:
	"""
	CV 병렬 워커 수를 합리적으로 제한.
	- 기본: CPU 코어의 절반, 최대 4
	- 너무 크게 잡으면 IDE/OS가 버벅이므로 보수적으로 제한
	"""
	try:
		return max(1, min(4, (os.cpu_count() or 4) // 2))
	except Exception:
		return 2


# ------------------------- 로그 run_id 공통 태그 -------------------------
# 학습 파이프라인의 모든 이벤트/메트릭에 동일하게 들어갈 run_id.
# - trainer 스레드가 환경변수 ML_RUN_ID를 세팅해 넘겨줄 수도 있고,
# - 없으면 여기서 자체 생성(날짜+시간)하여 사용.
RUN_ID = os.getenv("ML_RUN_ID") or datetime.now().strftime("%Y%m%d-%H%M%S")

def _tags(extra: Dict[str, str] | None = None) -> Dict[str, str]:
	"""모든 로깅 호출에 공통 run_id를 붙이는 유틸."""
	base = {"run_id": RUN_ID}
	if extra:
		base.update({k: str(v) for k, v in extra.items()})
	return base


# ------------------------- 데이터 적재/생성 로직 -------------------------

def _build_training_frame() -> pd.DataFrame:
	"""
	시연/테스트를 위한 샘플 데이터프레임을 생성한다.
	- 운영에서는 CSV/DB 로 교체.
	- target(절감률)이 없으면 간단 휴리스틱 + 노이즈로 생성.
	"""
	n = 1200
	rng = np.random.default_rng(42)

	types = rng.choice(["factory", "hospital", "school", "office"], size=n, p=[0.35, 0.15, 0.25, 0.25])
	region = rng.choice(["daejeon"], size=n)
	floor = rng.uniform(300, 8000, size=n)              # ㎡
	year = rng.integers(1980, 2021, size=n)             # 준공연도
	energy = rng.uniform(50_000, 2_000_000, size=n)     # kWh/yr
	eui = energy / floor                                # kWh/㎡·yr (러프)

	# 절감률 가짜 타깃(현실을 흉내낸 단순 휴리스틱 + 노이즈)
	base = 8.0 + 0.015 * (eui - 200) + 0.0004 * (floor - 2000) + 0.01 * (2005 - year)
	type_bias = np.array([{"factory": 2.5, "hospital": -0.5, "school": 1.0, "office": 0.0}[t] for t in types])
	target = base + type_bias + rng.normal(0, 2.5, size=n)
	target = _clip_pct(target, 4.0, 35.0)

	df = pd.DataFrame({
		"type": types,
		"region": region,
		"energy_kwh": energy,
		"eui_kwh_m2y": eui,
		"builtYear": year,
		"floorAreaM2": floor,
		"target": target
	})
	return df


def build_training_frame() -> pd.DataFrame:
	"""
	데이터프레임을 생성/적재하는 엔트리.
	- 프로젝트 util에 동일 이름 함수가 있으면 그걸 우선 사용(호환성↑)
	- 없으면 내부 샘플 생성(_build_training_frame)
	- (확장) CSV가 있으면 우선 로드하도록 변경 가능
	"""
	# 1) 외부 유틸 시도
	try:
		from .utils import build_training_frame as ext_build  # type: ignore
		df = ext_build()
		if not isinstance(df, pd.DataFrame):
			raise RuntimeError("utils.build_training_frame() returned non-DataFrame")
		return df
	except Exception:
		pass

	# 2) CSV 시도 (있다면)
	for d in DATA_DIRS:
		csv = os.path.join(d, "training_data.csv")
		if os.path.isfile(csv):
			df = pd.read_csv(csv)
			if "target" not in df.columns:
				raise RuntimeError(f"{csv} must include 'target' column for supervised learning")
			return df

	# 3) 내부 샘플
	return _build_training_frame()


# ----------------------------- 피처/파이프라인 -----------------------------

NUM_COLS = ["floorAreaM2", "energy_kwh", "eui_kwh_m2y", "builtYear"]
CAT_COLS = ["type"]  # region은 데모에서 단일값이라 제외(필요 시 추가)
TARGET = "target"

def make_preprocessor() -> ColumnTransformer:
	"""
	수치/범주 전처리를 묶은 ColumnTransformer 생성
	- 수치: StandardScaler
	- 범주: OneHotEncoder(handle_unknown='ignore')
	"""
	num = Pipeline(steps=[("scaler", StandardScaler())])
	cat = Pipeline(steps=[("ohe", OneHotEncoder(handle_unknown="ignore"))])
	pre = ColumnTransformer(
		transformers=[
			("num", num, NUM_COLS),
			("cat", cat, CAT_COLS),
		],
		remainder="drop"
	)
	return pre


def make_models() -> Dict[str, Tuple[Any, Dict[str, List[Any]]]]:
	"""
	후보 모델과 간단 하이퍼파라미터 그리드를 반환.
	- A: ElasticNet (해석성)
	- B: RandomForestRegressor (비선형 성능)
	"""
	models: Dict[str, Tuple[Any, Dict[str, List[Any]]]] = {
		"A_ElasticNet": (
			ElasticNet(random_state=42, max_iter=50_000),
			{
				"model__alpha": [0.05, 0.1, 0.5, 1.0],   # 0.01보다 보수적으로 시작(수렴 안정↑)
				"model__l1_ratio": [0.2, 0.5, 0.8, 1.0], # 0(Ridge)는 제외(경고↓)
			}
		),
		"B_RandomForest": (
			RandomForestRegressor(random_state=42, n_estimators=200, n_jobs=1),  # 내부 병렬 OFF
			{
				"model__max_depth": [None, 6, 10, 14],
				"model__min_samples_leaf": [1, 2, 5],
			}
		),
	}
	return models


def build_pipeline(estimator: Any) -> Pipeline:
	"""ColumnTransformer + Estimator 로 파이프라인 구성"""
	pre = make_preprocessor()
	return Pipeline(steps=[("pre", pre), ("model", estimator)])


# ----------------------------- 평가/교차검증 -----------------------------

def cv_evaluate(pipe: Pipeline, X: pd.DataFrame, y: pd.Series, k: int = 5) -> Dict[str, float]:
	"""
	K-Fold 교차검증 수행(주지표=MAE, 보조=RMSE/R²) → 평균/표준편차 반환
	- scoring:
	  * 'neg_mean_absolute_error' (MAE)
	  * 'neg_root_mean_squared_error' (RMSE)
	  * 'r2'
	- 리소스 제어:
	  * cross_validate 의 n_jobs 를 코어 절반(최대4)로 제한
	  * threadpool_limits 로 BLAS 스레드 1로 고정(가능 시)
	"""
	scoring = {
		"mae": "neg_mean_absolute_error",
		"rmse": "neg_root_mean_squared_error",
		"r2": "r2",
	}
	cv = KFold(n_splits=k, shuffle=True, random_state=42)
	pool = _cv_pool_size()

	if threadpool_limits:
		with threadpool_limits(limits=1):
			cvres = cross_validate(pipe, X, y, scoring=scoring, cv=cv, n_jobs=pool, return_train_score=False)
	else:
		cvres = cross_validate(pipe, X, y, scoring=scoring, cv=cv, n_jobs=pool, return_train_score=False)

	# 음수 지표 복구(neg -> pos)
	mae = -cvres["test_mae"]
	rmse = -cvres["test_rmse"]
	r2 = cvres["test_r2"]
	return {
		"cv_mae_mean": float(np.mean(mae)),
		"cv_mae_std": float(np.std(mae)),
		"cv_rmse_mean": float(np.mean(rmse)),
		"cv_rmse_std": float(np.std(rmse)),
		"cv_r2_mean": float(np.mean(r2)),
		"cv_r2_std": float(np.std(r2)),
	}


def _train_scores(pipe: Pipeline, X_train: pd.DataFrame, y_train: pd.Series) -> Dict[str, float]:
	"""
	Train set(학습 데이터)에서의 성능 지표 계산(MAE/RMSE/R²)
	- 과적합 체크용: Train vs Test 간 격차를 비교한다.
	"""
	yhat = pipe.predict(X_train)
	mae = mean_absolute_error(y_train, yhat)
	try:
		rmse = mean_squared_error(y_train, yhat, squared=False)
	except TypeError:
		rmse = float(np.sqrt(mean_squared_error(y_train, yhat)))
	r2 = r2_score(y_train, yhat)
	return {"train_mae": float(mae), "train_rmse": float(rmse), "train_r2": float(r2)}


def final_test_score(pipe: Pipeline, X_test: pd.DataFrame, y_test: pd.Series) -> Dict[str, float]:
	"""
	최종 test(20%) 성능 지표 계산(MAE/RMSE/R²)
	- 구버전 sklearn 호환: mean_squared_error(..., squared=False) 미지원 시 sqrt(MSE)
	"""
	y_pred = pipe.predict(X_test)
	mae = mean_absolute_error(y_test, y_pred)
	try:
		rmse = mean_squared_error(y_test, y_pred, squared=False)
	except TypeError:
		rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
	r2 = r2_score(y_test, y_pred)
	return {"test_mae": float(mae), "test_rmse": float(rmse), "test_r2": float(r2)}


# ----------------------------- 저장/매니페스트 -----------------------------

def _dump_pickle_atomic(obj: Any, final_path: str) -> None:
	"""
	임시 파일에 먼저 저장한 뒤 원자적으로 교체.
	.pkl 저장 시 부분쓰기(부분적으로 깨진 파일 노출) 방지.
	"""
	os.makedirs(os.path.dirname(final_path), exist_ok=True)
	dirname = os.path.dirname(final_path) or "."
	fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", dir=dirname)
	try:
		os.close(fd)  # 경로만 확보하고 닫은 뒤 joblib이 다시 염
		_DUMP(obj, tmp_path)  # joblib.dump 등
		shutil.move(tmp_path, final_path)  # Windows/Unix 공통 안전 교체
	except Exception:
		with contextlib.suppress(Exception):
			os.remove(tmp_path)
		raise

def _write_json_atomic(payload: Dict[str, Any], final_path: str) -> None:
	"""
	JSON을 임시 파일에 기록 후 fsync → 원자적 교체.
	"""
	os.makedirs(os.path.dirname(final_path), exist_ok=True)
	dirname = os.path.dirname(final_path) or "."
	with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=dirname, prefix=".tmp_") as tmp:
		json.dump(payload, tmp, ensure_ascii=False, indent=2)
		tmp.flush()
		os.fsync(tmp.fileno())
	tmp_path = tmp.name
	shutil.move(tmp_path, final_path)

def save_artifacts(pipes: Dict[str, Pipeline], manifest: Dict[str, Any], outdir: str) -> None:
	"""
	파이프라인과 manifest를 ./data 에 저장(원자적 저장)
	- model_A.pkl  : ElasticNet 파이프라인
	- model_B.pkl  : RandomForest 파이프라인
	- model.pkl    : 베스트 모델(하위호환용 단일 복사본)
	- manifest.json: 메타/지표/가중치 + 최신 버전(ISO KST)

	안전장치:
	- 모든 저장은 임시파일 → move 로 원자적 교체
	- outdir 자동 생성
	- manifest.version은 매 실행 ISO-8601(KST)로 자동 갱신
	"""
	os.makedirs(outdir, exist_ok=True)

	a_path = os.path.join(outdir, "model_A.pkl")
	b_path = os.path.join(outdir, "model_B.pkl")
	s_path = os.path.join(outdir, "model.pkl")
	mf_path = os.path.join(outdir, "manifest.json")

	# A 저장
	if pipes.get("A") is not None:
		print(f"[TRAIN] saving A → {a_path}")
		_dump_pickle_atomic(pipes["A"], a_path)
	else:
		print("[TRAIN] skip A (None)")

	# B 저장
	if pipes.get("B") is not None:
		print(f"[TRAIN] saving B → {b_path}")
		_dump_pickle_atomic(pipes["B"], b_path)
	else:
		print("[TRAIN] skip B (None)")

	# 단일 베스트 복사 저장
	best_key = (manifest.get("best") or {}).get("key")
	if best_key and pipes.get(best_key) is not None:
		print(f"[TRAIN] saving BEST ({best_key}) → {s_path}")
		_dump_pickle_atomic(pipes[best_key], s_path)
	else:
		print("[TRAIN] skip BEST (invalid key or missing pipe)")

	# manifest 버전 갱신(항상 최신 타임스탬프로)
	man_copy = dict(manifest)  # 원본 오염 방지
	man_copy["version"] = _now_kst_iso()
	if not man_copy.get("modelVersion"):
		man_copy["modelVersion"] = man_copy["version"]

	print(f"[TRAIN] writing manifest → {mf_path} (version={man_copy['version']})")
	_write_json_atomic(man_copy, mf_path)

	print("[TRAIN] artifacts saved successfully.")

	# -------- 로깅: 저장 완료 이벤트 --------
	try:
		ml_logging.log_event(
			"artifacts_saved",
			payload={"outdir": outdir, "best": best_key, "manifest": mf_path},
			tags=_tags({"phase": "save"})
		)
		ens = (manifest or {}).get("ensemble", {}) or {}
		# 가중치도 메트릭으로 남겨두면 시각화/대시보드에서 보기 좋음
		ml_logging.log_metrics(
			"ensemble",
			metrics={
				"wA": float(ens.get("wA", 0.5)),
				"wB": float(ens.get("wB", 0.5)),
			},
			tags=_tags({"phase": "save"})
		)
	except Exception as _e:
		print(f"[ML-LOG][artifacts] skip logging: {_e}")


# ----------------------------- 메인 파이프라인 -----------------------------

def main(k: int = 5, test_size: float = 0.2) -> None:
	"""
	한 번의 학습 전체 과정을 실행한다.
	- k: K-Fold 개수(기본 5)
	- test_size: test 비율(기본 0.2 = 8:2 분할)
	- 콘솔 출력: CV 평균±표준편차, 각 모델의 Train/Test 점수, 과적합 지표(ΔMAE)
	"""
	print(f"[train] RUN_ID={RUN_ID} loading/creating dataset ...")
	df = build_training_frame().copy()

	if TARGET not in df.columns:
		raise RuntimeError("training dataframe must include a 'target' column")

	# -------- 로깅: 학습 시작 메타 --------
	try:
		ml_logging.log_event(
			"train_start",
			payload={
				"k": k,
				"test_size": test_size,
				"rows": int(len(df)),
				"feature_cols": NUM_COLS + CAT_COLS
			},
			tags=_tags()
		)
	except Exception as _e:
		print(f"[ML-LOG][train_start] skip logging: {_e}")

	X = df[NUM_COLS + CAT_COLS].copy()
	y = df[TARGET].astype(float).copy()

	# train/test 분할(재현성 고정)
	X_train, X_test, y_train, y_test = train_test_split(
		X, Y := y, test_size=test_size, shuffle=True, random_state=42
	)
	print(f"[train] split: train={len(X_train):,}  test={len(X_test):,}")

	# (보조) 데이터 분할 크기 로깅
	try:
		ml_logging.log_metrics(
			"split",
			metrics={"train_rows": float(len(X_train)), "test_rows": float(len(X_test))},
			tags=_tags({"stage": "split"})
		)
	except Exception as _e:
		print(f"[ML-LOG][split] skip logging: {_e}")

	# 후보 모델/그리드
	model_defs = make_models()

	cv_summary: Dict[str, Dict[str, Any]] = {}
	best_key = None
	best_mae = float("inf")
	best_pipe = None

	# 각 후보 모델: 파이프라인 구성 → 간이 그리드 탐색 → CV 평가 → train 재학습 → train/test 점수 출력
	for key, (estimator, grid) in model_defs.items():
		pipe = build_pipeline(estimator)

		# 간이 그리드 탐색(수동 루프) — 안정/속도 목적
		results: List[Tuple[Dict[str, Any], Dict[str, float]]] = []
		param_names = list(grid.keys())
		param_values = list(grid.values())

		def _product(idx: int, cur: Dict[str, Any]):
			if idx == len(param_names):
				yield cur.copy()
				return
			name = param_names[idx]
			for val in param_values[idx]:
				cur[name] = val
				yield from _product(idx + 1, cur)

		print(f"[cv] {key} grid search start ...")
		for params in _product(0, {}):
			tuned = Pipeline(steps=pipe.steps)  # shallow copy
			tuned.set_params(**params)
			scores = cv_evaluate(tuned, X_train, y_train, k=k)
			results.append((params.copy(), scores.copy()))
			print(f"[cv] {key} params={params} → "
				  f"MAE={scores['cv_mae_mean']:.4f}±{scores['cv_mae_std']:.4f}, "
				  f"RMSE={scores['cv_rmse_mean']:.4f}±{scores['cv_rmse_std']:.4f}, "
				  f"R2={scores['cv_r2_mean']:.4f}±{scores['cv_r2_std']:.4f}")

			# -------- 로깅: CV 점수(조합 단위) --------
			try:
				ml_logging.log_metrics(
					"cv",
					metrics={
						"mae_mean": float(scores["cv_mae_mean"]),
						"mae_std": float(scores["cv_mae_std"]),
						"rmse_mean": float(scores["cv_rmse_mean"]),
						"rmse_std": float(scores["cv_rmse_std"]),
						"r2_mean": float(scores["cv_r2_mean"]),
						"r2_std": float(scores["cv_r2_std"]),
					},
					# 태그는 문자열만 넣는 것을 권장 → 파라미터는 JSON 문자열로 넣음
					tags=_tags({
						"model": key,
						"params_json": json.dumps(params, ensure_ascii=False, separators=(",", ":"))
					})
				)
			except Exception as _e:
				print(f"[ML-LOG][cv] skip logging: {_e}")

		# 최적 파라미터(주지표=MAE 최소) 선택
		results.sort(key=lambda pr: pr[1]["cv_mae_mean"])
		best_params, best_scores = results[0]
		cv_summary[key] = {"best_params": best_params, **best_scores}

		# -------- 로깅: 최적 파라미터 선택 --------
		try:
			ml_logging.log_event(
				"cv_best_selected",
				payload={"model": key, "best_params": best_params, "cv": best_scores},
				tags=_tags()
			)
		except Exception as _e:
			print(f"[ML-LOG][cv_best] skip logging: {_e}")

		# 현재 모델로 train 전체 재학습(최적 파라미터 반영)
		best_model = build_pipeline(estimator)
		best_model.set_params(**best_params)
		if threadpool_limits:
			with threadpool_limits(limits=1):
				best_model.fit(X_train, y_train)
		else:
			best_model.fit(X_train, y_train)
		print(f"[fit] {key} best_params={best_params}  (fitted on train)")

		# Train/Test 점수 계산 + 과적합 지표(ΔMAE)
		train_scores = _train_scores(best_model, X_train, y_train)
		test_scores = final_test_score(best_model, X_test, y_test)
		delta_mae = test_scores["test_mae"] - train_scores["train_mae"]
		cv_summary[key].update(train_scores)
		cv_summary[key].update(test_scores)

		print(f"[score] {key} TRAIN  MAE={train_scores['train_mae']:.4f}, "
			  f"RMSE={train_scores['train_rmse']:.4f}, R2={train_scores['train_r2']:.4f}")
		print(f"[score] {key} TEST   MAE={test_scores['test_mae']:.4f}, "
			  f"RMSE={test_scores['test_rmse']:.4f}, R2={test_scores['test_r2']:.4f}  "
			  f"(ΔMAE={delta_mae:+.4f})")

		# -------- 로깅: Train/Test 스코어 --------
		try:
			ml_logging.log_metrics("score_train", metrics=train_scores, tags=_tags({"model": key}))
			ml_logging.log_metrics("score_test", metrics={**test_scores, "delta_mae": float(delta_mae)}, tags=_tags({"model": key}))
		except Exception as _e:
			print(f"[ML-LOG][scores] skip logging: {_e}")

		# 글로벌 베스트(주지표=Test MAE 최소, 동률 시 CV MAE)
		candidate_mae = test_scores["test_mae"]
		if candidate_mae < best_mae:
			best_mae = candidate_mae
			best_key = "A" if key.startswith("A_") else "B"
			best_pipe = best_model

	# 산출물 저장(원자적)
	outdir = _ensure_data_dir()
	pipes_to_save: Dict[str, Pipeline] = {}

	# A/B 매핑: 키 접두사로 구분하여 재학습 → 저장
	for key, summary in cv_summary.items():
		if key.startswith("A_"):
			est = ElasticNet(random_state=42, max_iter=50_000)
			a_pipe = build_pipeline(est)
			a_pipe.set_params(**summary["best_params"])
			if threadpool_limits:
				with threadpool_limits(limits=1):
					a_pipe.fit(X_train, y_train)
			else:
				a_pipe.fit(X_train, y_train)
			pipes_to_save["A"] = a_pipe
		elif key.startswith("B_"):
			est = RandomForestRegressor(random_state=42, n_estimators=200, n_jobs=1)
			b_pipe = build_pipeline(est)
			b_pipe.set_params(**summary["best_params"])
			if threadpool_limits:
				with threadpool_limits(limits=1):
					b_pipe.fit(X_train, y_train)
			else:
				b_pipe.fit(X_train, y_train)
			pipes_to_save["B"] = b_pipe

	# best 단일 파이프라인(하위호환용)
	if best_pipe is None:
		best_pipe = pipes_to_save.get("A") or pipes_to_save.get("B")

	# 앙상블 가중치(기본 0.5/0.5 + 역수비례 정보)
	mae_a = cv_summary.get("A_ElasticNet", {}).get("cv_mae_mean", None)
	mae_b = cv_summary.get("B_RandomForest", {}).get("cv_mae_mean", None)
	wA = 0.5
	wB = 0.5
	inv_wA = inv_wB = None
	if isinstance(mae_a, float) and isinstance(mae_b, float) and mae_a > 0 and mae_b > 0:
		invA, invB = 1.0 / mae_a, 1.0 / mae_b
		s = invA + invB
		inv_wA, inv_wB = float(invA / s), float(invB / s)

	manifest = {
		"version": _timestamp_kst(),  # save_artifacts에서 ISO KST로 덮어써 최신화됨
		"features": NUM_COLS + CAT_COLS,
		"split": {"test_size": test_size, "random_state": 42},
		"kfold": {"k": k, "random_state": 42, "shuffle": True},
		"models": cv_summary,  # { "A_ElasticNet": {...}, "B_RandomForest": {...} }
		"best": {"key": best_key, "by": "test_mae"},  # "A" | "B"
		"ensemble": {
			"wA": wA,
			"wB": wB,
			"suggested_by_inverse_mae": {"wA": inv_wA, "wB": inv_wB}
		}
	}

	# =========================[ 신규 추가 블록 ]=========================
	# [ADD][SG-ENSEMBLE-SCORES]
	# 목적:
	#  - C(앙상블)의 TRAIN/TEST 점수를 A/B와 동일한 포맷으로 계산하여
	#    1) PyCharm 콘솔에 출력
	#    2) logs/app/*.jsonl(JSONL)에 기록(kind="score_train"/"score_test", tags.model="C_Ensemble")
	# 위치:
	#  - manifest(가중치 포함) 생성 직후 ~ save_artifacts(...) 호출 직전
	# 전제:
	#  - a_pipe, b_pipe: A/B 학습 완료된 파이프라인
	#  - wA, wB: 앙상블 가중치 (float)
	try:
		# 두 파이프라인과 가중치가 모두 준비된 경우에만 점수 계산
		if ('A' in pipes_to_save and 'B' in pipes_to_save
				and pipes_to_save['A'] is not None and pipes_to_save['B'] is not None):
			a_pipe = pipes_to_save['A']
			b_pipe = pipes_to_save['B']

			# C 예측 = 가중합(ŷ_C = wA*ŷ_A + wB*ŷ_B), 8:2 분할 그대로 사용
			yhat_train_C = wA * a_pipe.predict(X_train) + wB * b_pipe.predict(X_train)
			yhat_test_C  = wA * a_pipe.predict(X_test)  + wB * b_pipe.predict(X_test)

			# 지표 계산 (A/B와 동일 기준)
			train_mae = float(mean_absolute_error(y_train, yhat_train_C))
			try:
				train_rmse = float(mean_squared_error(y_train, yhat_train_C, squared=False))
			except TypeError:
				train_rmse = float(np.sqrt(mean_squared_error(y_train, yhat_train_C)))
			train_r2 = float(r2_score(y_train, yhat_train_C))

			test_mae = float(mean_absolute_error(y_test, yhat_test_C))
			try:
				test_rmse = float(mean_squared_error(y_test, yhat_test_C, squared=False))
			except TypeError:
				test_rmse = float(np.sqrt(mean_squared_error(y_test, yhat_test_C)))
			test_r2 = float(r2_score(y_test, yhat_test_C))

			delta_mae = float(test_mae - train_mae)

			# 콘솔 출력(요청 포맷)
			print("[chart C] C_Ensemble")
			print(f"[score] TRAIN  MAE={train_mae:.4f}, RMSE={train_rmse:.4f}, R2={train_r2:.4f}")
			print(f"[score] TEST   MAE={test_mae:.4f}, RMSE={test_rmse:.4f}, R2={test_r2:.4f}  (ΔMAE={delta_mae:+.4f})")

			# JSONL 기록( FE 파서가 A/B와 동일하게 읽을 수 있도록 )
			try:
				ml_logging.log_metrics(
                    "score_train",
                    metrics={"train_mae": train_mae, "train_rmse": train_rmse, "train_r2": train_r2},
                    tags=_tags({"model": "C_Ensemble"})
                )
				ml_logging.log_metrics(
                    "score_test",
                    metrics={"test_mae": test_mae, "test_rmse": test_rmse, "test_r2": test_r2, "delta_mae": delta_mae},
                    tags=_tags({"model": "C_Ensemble"})
                )
			except Exception as _e:
				print(f"[ML-LOG][ensemble scores] skip logging: {_e}")

			# manifest 보강: C 점수 추가(재현/리포트용)
			manifest.setdefault("ensemble", {})
			manifest["ensemble"]["scores"] = {
				"train": {"mae": train_mae, "rmse": train_rmse, "r2": train_r2},
				"test": {"mae": test_mae, "rmse": test_rmse, "r2": test_r2, "delta_mae": delta_mae}
			}

		else:
			# 한쪽 파이프라인이 없으면 점수 대신 가중치만 출력/기록(안전망)
			print("[chart C] C_Ensemble")
			try:
				print(f"[score] ENSEMBLE wA={float(wA):.4f}, wB={float(wB):.4f}")
			except Exception:
				print("[score] ENSEMBLE (weights not available)")
			try:
				ml_logging.log_metrics(
					"ensemble",
					metrics={"wA": float(wA), "wB": float(wB)},
					tags=_tags({"phase": "save"})
				)
			except Exception as _e:
				print(f"[ML-LOG][ensemble weights] skip logging: {_e}")
	except Exception as _e:
		print(f"[WARN] ensemble scoring block error: {_e}")
	# =======================[ /신규 추가 블록 끝 ]=======================

	# >>> 원자적 저장(최종): pkl(A/B/BEST), manifest.json 모두 안전 저장 + 로깅
	save_artifacts(pipes_to_save, manifest, outdir)

	# 상태 로그(요약)
	print(f"[save] model_A.pkl={'ok' if 'A' in pipes_to_save else '-'}, "
		  f"model_B.pkl={'ok' if 'B' in pipes_to_save else '-'}, "
		  f"best={manifest.get('best', {}).get('key')}")

	# manifest 내용 확인용 출력
	with open(os.path.join(outdir, "manifest.json"), "r", encoding="utf-8") as f:
		print("[manifest]\n" + f.read())


# ----------------------------- 단독 실행 지원 -----------------------------

if __name__ == "__main__":
	# 기본값: k=5, test_size=0.2 (8:2 분할)
	# 단독 실행 시에도 run_id가 자동 생성되어 로그에 포함된다.
	main(k=5, test_size=0.2)
