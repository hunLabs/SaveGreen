# ============================================================
# SaveGreen / app/main.py — FastAPI 엔트리 + 학습 잡 API(시작/상태) + variant 스텁
# ------------------------------------------------------------
# 역할(요약)
# 1) 헬스체크(/health)
# 2) 예측(/predict): 스프링 표준화 입력(JSON)을 받아 KPI에 필요한 값을 반환
#    - 이번 스텝에서 variant=A|B|C 쿼리 파라미터를 **받기만** 하며,
#      현재 구현은 모든 variant가 동일(C처럼) 동작한다. (다음 스텝에서 실제 분기 구현)
# 3) 학습 시작(/train): "시작하기" 버튼과 연결. 즉시 jobId를 응답하고,
#    실제 학습은 백그라운드 스레드에서 비동기로 수행(trainer 모듈).
# 4) 학습 상태(/train/status/{jobId}): FE 로더(20/40/60/80/100%)와 매핑하여 폴링.
#
# 설계 포인트
# - /predict?variant=A|B|C 를 추가하되, 현재 ModelManager는 단일 모델을 사용.
#   → 본 스텝에서는 variant를 **로그에만 기록**하고 예측은 기존 로직으로 수행.
#   → 다음 스텝에서 model.py를 수정하여 A/B/C(모델 A·B·앙상블C) 분기를 실제 적용.
# - /train 은 "즉시 응답"(jobId) → /train/status 폴링 구조 유지.
#
# 사용 팁
# - 개발 중엔 server.py를 실행(uvicorn.run("app.main:app", reload=True))
# - 브라우저: http://localhost:8000/health , /docs 로 스웨거 확인
# ============================================================

from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal

from fastapi import FastAPI, Query, Body
from pydantic import BaseModel, Field

from .schema import PredictRequest, PredictResponse
from .model import ModelManager
from .trainer import start_training, get_status, TrainJob
from . import ml_logging


# ------------------------ 공통 run_id (예측용) ------------------------
# 서버 프로세스가 뜰 때 한 번 생성되는 run_id.
# - /predict 로 남는 로그에는 이 값이 공통으로 붙는다.
# - /train 은 jobId 자체를 run_id로 사용(아래 train_start 참조).
SERVER_RUN_ID = datetime.now().strftime("%Y%m%d-%H%M%S")


# ------------------------ 앱/모델 싱글톤 ------------------------

_model: Optional[ModelManager] = None

def get_model() -> ModelManager:
    """
    모델 매니저 싱글톤을 지연 생성(lazy init)하여 반환.
    - 서버 기동 직후에도 호출 가능.
    - model.pkl이 없으면 ModelManager가 내부에서 DUMMY(룰 기반)로 폴백 처리.
    """
    global _model
    _model = _model or ModelManager()
    return _model


# ---------------------- API 스키마(학습 잡) ----------------------

class TrainStartResponse(BaseModel):
    """
    /train 시작 응답 스키마.
    - jobId: 학습 작업 식별자(폴링에 사용)
    - startedAt: 서버 기준 시작 시각(ISO8601)
    - mode: quick/full 등 모드 문자열(확장용)
    - k: K-Fold 수(확장용)
    """
    jobId: str = Field(..., description="학습 작업 ID")
    startedAt: str = Field(..., description="시작 시각(ISO8601, 서버 기준)")
    mode: str = Field(..., description="학습 모드(quick/full 등)")
    k: int = Field(..., description="K-Fold 수(향후 CV에서 사용)")

class TrainStatusState(BaseModel):
    """
    /train/status 응답 내부 상태 스키마.
    - state: 현재 상태(QUEUED/TRAINING/EVALUATING/SAVING/READY/FAILED)
    - progress: 0~100
    - log: 사람이 읽을 수 있는 진행 로그(최근→과거 순 아님, 단순 append)
    - error: 실패 시 에러 메시지(없으면 null)
    - startedAt/finishedAt: 서버 기준 시각(ISO8601)
    """
    state: Literal["QUEUED", "TRAINING", "EVALUATING", "SAVING", "READY", "FAILED"]
    progress: int = Field(..., ge=0, le=100)
    log: List[str]
    error: Optional[str] = None
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None

class TrainStatusResponse(BaseModel):
    """
    /train/status 최상위 응답 스키마.
    - jobId: 상태를 조회한 대상 작업 ID
    - detail: TrainStatusState
    """
    jobId: str
    detail: TrainStatusState


# --------------------------- FastAPI 앱 ---------------------------

app = FastAPI(title="SaveGreen ML API", version="0.3.0")


# ------------------------- 라우트: 헬스체크 ------------------------

@app.get("/health")
def health():
    """
    서버 생존 상태와 모델 로드 상태를 반환.
    - status: "ok" 고정
    - model: ModelManager.status()
    - version: API 버전
    """
    m = get_model()
    return {"status": "ok", "model": m.status(), "version": "0.3.0"}


# -------------------------- 라우트: 예측 --------------------------

@app.post("/predict", response_model=PredictResponse)
def predict(
    req: PredictRequest,
    variant: Literal["A", "B", "C"] = Query(
        default="C",
        description="예측 모델 선택(A=선형/해석성, B=트리/성능, C=앙상블). 현재 스텝에선 스텁(모두 동일)."
    )
):
    """
    표준화된 입력(req)을 받아 모델/룰 기반으로 KPI에 필요한 값을 반환.
    - 이번 스텝: variant 파라미터를 받고 **로그에 기록만** 하며, 실제 예측은 기존 단일 모델 로직 사용.
    - 다음 스텝: model.py를 확장하여 A/B/C 분기(모델 A·B·C) 실제 적용.
    """
    m = get_model()

    # [로그] variant 수신 기록 — 현재는 스텁(동일 로직)
    print(f"[ML] variant={variant} type={req.type} floor={req.floorAreaM2} builtYear={req.builtYear}")

    # 현재 ModelManager.predict는 variant를 받지 않음 → 그대로 호출(내부에서 분기 처리하는 predict_variant 사용)
    out = m.predict_variant(req.model_dump(), variant=variant)

    # [ML-LOG] 예측 이벤트 + KPI 메트릭 기록 (실패해도 예측 흐름은 지속)
    try:
        # 이벤트 컨텍스트
        ml_logging.log_event(
            "predict",
            payload={
                "variant": variant,
                "type": req.type,
                "region": req.region,
                "builtYear": req.builtYear,
                "floorAreaM2": req.floorAreaM2,
                "energy_kwh": req.energy_kwh,
                "eui_kwh_m2y": req.eui_kwh_m2y,
            },
            # ★ run_id를 공통 태그로 부여 — 학습(jobId)과 구분됨(서버 세션 단위)
            tags={"endpoint": "/predict", "run_id": SERVER_RUN_ID}
        )
        # 응답 KPI 메트릭
        ml_logging.log_metrics(
            "predict",
            metrics={
                "savingPct": float(out.get("savingPct", 0.0)),
                "savingKwhYr": float(out.get("savingKwhYr", 0.0)),
                "savingCostYr": float(out.get("savingCostYr", 0.0)),
                "paybackYears": float(out.get("paybackYears", 0.0)),
            },
            tags={"variant": variant, "run_id": SERVER_RUN_ID}
        )
    except Exception as _e:
        # 로깅 실패는 예측 흐름에 영향 주지 않음
        print(f"[ML-LOG][predict] skip logging: {_e}")

    return PredictResponse(**out)


# ------------------------ 라우트: 학습 시작 -----------------------

@app.post("/train", response_model=TrainStartResponse)
def train_start(
    mode: str = Query(default="quick", description="학습 모드(quick/full 등)"),
    k: int = Query(default=5, ge=2, le=10, description="K-Fold 개수(확장 예정)"),
):
    """
    '시작하기' 버튼과 연결되는 학습 트리거.
    - 동작: 백그라운드 스레드에서 학습을 시작하고, 즉시 jobId를 반환.
    - FE/스프링은 받은 jobId로 /train/status/{jobId} 폴링 → 진행도 갱신.
    """
    job_id = start_training(mode=mode, k=k)
    now_iso = datetime.now().isoformat(timespec="seconds")

    # (옵션) 학습 트리거 자체도 이벤트로 남겨 다음 단계에서 시간축 분석 가능
    try:
        # ★ 여기서는 jobId를 그대로 run_id로 사용한다(학습 세션 단위 식별).
        ml_logging.log_event(
            "train_trigger",
            payload={"mode": mode, "k": k, "jobId": job_id},
            tags={"run_id": job_id}
        )
    except Exception as _e:
        print(f"[ML-LOG][train_trigger] skip logging: {_e}")

    return TrainStartResponse(jobId=job_id, startedAt=now_iso, mode=mode, k=k)


# ------------------------ 라우트: 학습 상태 -----------------------

@app.get("/train/status/{job_id}", response_model=TrainStatusResponse)
def train_status(job_id: str):
    """
    학습 상태/진행도를 반환. FE 로더 5단계와 매핑:
    - 20%: TRAINING 초기
    - 40%: EVALUATING 준비(2단계에서 K-Fold 본격화)
    - 60%: TRAINING 본문(train.main 실행)
    - 80%: SAVING(아티팩트 저장)
    - 100%: READY(완료)
    """
    job: Optional[TrainJob] = get_status(job_id)
    if job is None:
        # 존재하지 않는 jobId 응답 — 프런트에서 예외 처리(토스트 등)
        return TrainStatusResponse(
            jobId=job_id,
            detail=TrainStatusState(
                state="FAILED",
                progress=0,
                log=["job not found"],
                error="job not found",
                startedAt=None,
                finishedAt=None
            )
        )

    start_iso = job.started_at.isoformat(timespec="seconds") if job.started_at else None
    finish_iso = job.finished_at.isoformat(timespec="seconds") if job.finished_at else None

    return TrainStatusResponse(
        jobId=job.job_id,
        detail=TrainStatusState(
            state=job.state,
            progress=int(job.progress),
            log=job.log,
            error=job.error,
            startedAt=start_iso,
            finishedAt=finish_iso
        )
    )

# ============================================================
# 추가 엔드포인트 — 모델 상태 조회 & 리로드 & 배치 예측
# ------------------------------------------------------------
# - GET /model/status : A/B 로드 여부, manifest 경로, 현재 C 가중치 확인
# - POST /admin/reload-model : 학습 산출물을 다시 읽어 메모리 갱신
# - POST /predict/batch : 여러 건 한 번에 예측(시연/리포트용)
# ============================================================
@app.get("/model/status", summary="모델/가중치 상태 조회")
def model_status():
    """
    현재 메모리에 로드된 모델 상태를 확인한다.
    - has_A / has_B : 파이프라인 로드 여부
    - manifest      : 사용 중인 manifest.json 경로
    - ensemble_weights_effective : C(앙상블) 실제 적용 가중치(wA, wB)
    """
    m = get_model()
    return m.status()

@app.post("/admin/reload-model", summary="학습 산출물 재로딩")
def reload_model():
    """
    ./data의 model_A.pkl, model_B.pkl, manifest.json 을 다시 읽는다.
    /train 완료 직후 FE/스프링에서 한 번 호출해주면,
    /predict?variant=C가 바로 최신 추천 가중치로 동작한다.
    """
    global _model
    _model = None
    m = get_model()
    return {"status": "ok", "loaded": m.status()}

@app.post("/predict/batch", summary="여러 건을 일괄 예측")
def predict_batch(
    variant: Literal["A", "B", "C"] = "C",
    items: List[PredictRequest] = Body(...)
):
    m = get_model()
    results = []
    for it in items:
        results.append(m.predict_variant(it.model_dump(), variant=variant))
    return {"count": len(results), "variant": variant, "results": results}


# ---------------- 파비콘(개발 중 404 소음 방지) ------------------

@app.get("/favicon.ico")
def favicon():
    """
    개발 중 브라우저 404 소음을 줄이기 위한 더미 핸들러.
    """
    return {}

# ---------------- 더미 WebSocket(개발 편의용) ----------------
# 역할:
# - 일부 브라우저/확장/개발툴이 /ws/ws 로 접속을 시도할 때
#   403 경고가 뜨는 것을 조용히 흡수한다.
# - 운영 기능과 무관. 테스트 시 소음 제거용.
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/ws")
async def _dummy_ws(ws: WebSocket):
    # 모든 오리진 허용(개발용). 필요하면 오리진 체크 추가 가능.
    await ws.accept()
    try:
        while True:
            # 들어오는 메시지를 그냥 버퍼만 읽고 버림(에코도 안 함)
            await ws.receive_text()
    except WebSocketDisconnect:
        # 클라이언트가 정상 종료하면 여기로 옴
        pass
