# ml_logging.py — NDJSON(줄 단위 JSON) ML 로그 유틸 (개선)
# -----------------------------------------------------------------------------
# 설계 목적
# - ML 학습/예측 과정에서 발생하는 주요 이벤트를 "한 줄 = 하나의 JSON" 형식으로
#   파일에 순차 append 한다.
# - 프런트엔드는 FastAPI tail API(커서 기반)로 이 파일을 읽어와 콘솔처럼
#   "한 줄씩 올라오는" UI를 구현할 수 있다.
#
# 디렉터리 구조 (권장)
#   project-root/
#    ├─ data/              # 모델·데이터 아티팩트
#    └─ logs/
#       ├─ app/            # 애플리케이션(스프링/플랫폼) 로그
#       └─ ml/             # ML 작업 NDJSON 로그  ← 이 모듈이 쓰는 위치(기본)
#
# 경로 결정 우선순위
# - 환경변수 SG_ML_LOG_DIR 가 설정되어 있으면 그 경로를 사용
# - 없으면, 현재 파일 기준 프로젝트 루트 추정 → "<project-root>/logs/ml" 사용
#   (이 때 편의상 "<project-root>/logs/app" 디렉터리도 함께 생성)
#
# 로그 파일 이름 규칙
# - "{job_id}.jsonl"  (작업 단위 분리; 병렬 작업 충돌 최소화)
#
# 레코드(각 줄) 스키마
#     {
#       "t":       "2025-10-22T03:12:34Z",  # UTC ISO8601(초 단위) + 'Z'
#       "status":  "START"|"SPLIT"|"CV"|"FIT"|"SCORE"|"SAVE"|"DONE"|"ERROR",
#       "progress": 0..100,                 # 정수 진행률(러프 추정 가능)
#       "message": "사람이 읽을 짧은 설명"
#     }
#
# 주의/운영 포인트
# - job_id는 파일명에 쓰이므로 안전한 문자만 사용(영숫자, 하이픈 등).
# - 멀티프로세스에서 동일 job_id로 동시 append 지양(필요 시 파일락/큐).
# - message에 민감정보(토큰/내부경로) 금지.
# - 작업 종료 후 보관 기간에 따라 압축/삭제(크론/스케줄러) 권장.
# -----------------------------------------------------------------------------

# app/ml_logging.py
from __future__ import annotations

import json
import os
import uuid
from dataclasses import is_dataclass, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import numpy as np
except Exception:
    np = None  # numpy 없어도 동작

# ────────────────────────────────────────────────────────────
# 경로 설정: 프로젝트 루트/logs/<area>/<YYYY-MM-DD>.jsonl
# ────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parents[1]   # 프로젝트 루트(= app 상위)
LOG_ROOT = BASE_DIR / "logs"                     # logs/
DEFAULT_AREA = "app"                             # 기본 영역

def _kst_now() -> datetime:
    return datetime.now(timezone(timedelta(hours=9)))

def _logfile(area: str) -> Path:
    area = (area or DEFAULT_AREA).strip().lower()
    d = _kst_now().strftime("%Y-%m-%d")
    p = LOG_ROOT / area
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{d}.jsonl"

# ────────────────────────────────────────────────────────────
# JSON 직렬화 보조
# ────────────────────────────────────────────────────────────
def _to_plain(obj: Any) -> Any:
    """numpy, dataclass, set 등 직렬화 불가 타입을 안전 변환."""
    try:
        if obj is None:
            return None
        if isinstance(obj, (str, int, float, bool)):
            return obj
        if isinstance(obj, (list, tuple)):
            return [_to_plain(x) for x in obj]
        if isinstance(obj, dict):
            return {str(k): _to_plain(v) for k, v in obj.items()}
        if is_dataclass(obj):
            return _to_plain(asdict(obj))
        if isinstance(obj, set):
            return sorted([_to_plain(x) for x in obj])
        # numpy 호환
        if np is not None:
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, (np.ndarray,)):
                return [_to_plain(x) for x in obj.tolist()]
        # datetime
        if isinstance(obj, datetime):
            return obj.isoformat()
        # 마지막 폴백
        return str(obj)
    except Exception:
        return str(obj)

def _write_record(area: str, rec: Dict[str, Any]) -> Optional[Path]:
    """한 줄 JSON 레코드를 파일에 append. 실패해도 예외 전파 안 함."""
    try:
        path = _logfile(area)
        rec_plain = _to_plain(rec)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec_plain, ensure_ascii=False) + "\n")
        return path
    except Exception as e:
        # 로깅 실패는 본 기능을 막지 않음
        print(f"[ml_logging] write failed: {e}")
        return None

# ────────────────────────────────────────────────────────────
# 공개 API
# ────────────────────────────────────────────────────────────
def log_event(
    kind: str,
    payload: Optional[Dict[str, Any]] = None,
    tags: Optional[Dict[str, str]] = None,
    area: str = DEFAULT_AREA,
    id: Optional[str] = None,
) -> Optional[Path]:
    """
    임의 이벤트 로깅.
    - kind: 'train_start' / 'predict' / 'artifacts_saved' 등 이벤트 이름
    - payload: 임의의 컨텍스트(사전)
    - tags: 필터링/인덱싱용 경량 문자열 태그(딕셔너리; 값은 문자열 권장)
    - area: 파일 분리용 영역('app' | 'ml' 등)
    - id: 없으면 자동(uuid4)
    """
    rec = {
        "id": id or uuid.uuid4().hex,
        "ts": _kst_now().isoformat(timespec="seconds"),
        "type": "event",
        "kind": str(kind),
        "area": area or DEFAULT_AREA,
        "payload": payload or {},
        "tags": tags or {},
    }
    return _write_record(area, rec)

def log_metrics(
    kind: str,
    metrics: Dict[str, Any],
    tags: Optional[Dict[str, str]] = None,
    area: str = DEFAULT_AREA,
    id: Optional[str] = None,
) -> Optional[Path]:
    """
    수치 지표 로깅.
    - kind: 'cv' / 'score_train' / 'score_test' / 'predict' 등
    - metrics: 수치 위주 딕셔너리(MAE, RMSE, R2 등)
    - tags: 필터링/인덱싱용 문자열 태그(예: {'model':'A_ElasticNet'})
    - area: 파일 분리용 영역('ml' 권장)
    """
    rec = {
        "id": id or uuid.uuid4().hex,
        "ts": _kst_now().isoformat(timespec="seconds"),
        "type": "metrics",
        "kind": str(kind),
        "area": area or DEFAULT_AREA,
        "metrics": metrics or {},
        "tags": tags or {},
    }
    return _write_record(area, rec)

