# ============================================================
# SaveGreen / trainer.py — 학습 잡(Train Job) & 상태 관리 스캐폴드
# ------------------------------------------------------------
# 역할(요약)
# - FastAPI에서 "시작하기" 버튼을 누르면 즉시 응답을 주고, 실제 학습은
#   백그라운드 스레드에서 비동기로 진행하기 위한 잡(작업) 관리 모듈.
# - 상태(QUEUED/TRAINING/EVALUATING/SAVING/READY/FAILED)와
#   진행도(progress: 0~100), 로그(log)를 메모리에 보관하여
#   /train/status/{jobId} 폴링 시 FE 로더(20/40/60/80/100%)와 연결.
#
# 설계 포인트
# 1) 최소 침습: 현재의 train.py(main 함수는 model.pkl 1개 저장)와 호환.
#    - 1단계: trainer가 train.main()을 호출하여 기본 학습 파이프라인 실행
#    - 2단계: 이후 K-Fold, A/B/C(모델 2종+manifest)로 확장 예정
# 2) 안정성: 예외 발생 시 state=FAILED, error에 사유 저장
# 3) 동시성: 간단한 dict 기반 in-memory 저장(데모/시연용).
#    - 운영에서는 Redis/DB 등 외부 저장/락 적용 권장.
#
# 사용 흐름(1단계)
# - start_training(mode='quick', k=5) → jobId 즉시 반환
# - get_status(jobId) → state/progress/log 응답
# - (내부) _run_job(): 단계별 progress 업데이트 → train.main() 호출
#
# 이후 확장(2단계에서 구현 예정)
# - KFold CV, 후보모델 비교, model_A.pkl / model_B.pkl 저장
# - manifest.json에 성능/버전 기록, 앙상블 가중치
# ============================================================

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Literal

# 현재 단계에서는 기존 train.py의 main()을 호출해 model.pkl을 저장합니다.
# 다음 단계에서 K-Fold/A/B/C 로직을 이 모듈 안에서 직접 구현하도록 확장합니다.
from . import train


# --------- 타입 정의 ---------
JobState = Literal[
	"QUEUED",       # 대기열 진입
	"TRAINING",     # 학습 시작
	"EVALUATING",   # (2단계) 교차검증/비교 단계 — 1단계에서는 짧게 통과 형태
	"SAVING",       # 모델/아티팩트 저장
	"READY",        # 완료
	"FAILED"        # 실패
]


@dataclass
class TrainJob:
	"""단일 학습 작업의 상태를 보관하는 데이터 클래스(메모리 저장)."""
	job_id: str
	mode: str = "quick"              # 모드(quick/full 등) — 2단계 확장 대비
	k: int = 5                       # K-Fold 수 — 2단계에서 사용
	state: JobState = "QUEUED"
	progress: int = 0                # 0~100
	log: List[str] = field(default_factory=list)
	started_at: datetime = field(default_factory=lambda: datetime.now())
	finished_at: Optional[datetime] = None
	error: Optional[str] = None

	def push(self, msg: str) -> None:
		"""사소한 상태도 남겨서 FE 디버깅에 활용."""
		self.log.append(msg)

	def set(self, state: JobState, progress: int, msg: Optional[str] = None) -> None:
		self.state = state
		self.progress = max(0, min(progress, 100))
		if msg:
			self.log.append(msg)

	def done(self) -> None:
		self.finished_at = datetime.now()


# --------- 전역(메모리) 잡 저장소 ---------
# 데모/시연 단계에서는 in-memory 딕셔너리로 충분합니다.
# 운영 환경에선 Redis/DB 등으로 대체 권장.
_JOBS: Dict[str, TrainJob] = {}
_LOCK = threading.Lock()


def start_training(mode: str = "quick", k: int = 5) -> str:
	"""
	학습을 비동기 스레드로 시작하고, 즉시 jobId를 반환한다.
	- mode: 'quick'|'full' 등 확장용 플래그
	- k   : K-Fold 수(2단계 확장 시 사용)
	"""
	job_id = _new_job_id()
	job = TrainJob(job_id=job_id, mode=mode, k=k)

	with _LOCK:
		_JOBS[job_id] = job

	# 백그라운드 스레드에서 실제 학습 실행
	th = threading.Thread(target=_run_job, args=(job_id,), daemon=True)
	th.start()

	return job_id


def get_status(job_id: str) -> Optional[TrainJob]:
	"""잡 상태 조회(없으면 None)."""
	with _LOCK:
		return _JOBS.get(job_id)


def _new_job_id() -> str:
	"""사람이 보기 쉬운 형태의 잡 ID 생성(날짜+UUID 앞부분)."""
	ts = datetime.now().strftime("%Y%m%d-%H%M%S")
	uid = uuid.uuid4().hex[:6].upper()
	return f"{ts}-{uid}"


def _sleep_with_heartbeat(job: TrainJob, seconds: float, tick: float = 0.25) -> None:
	"""
	로더 단계 시연을 위해 잠시 대기하면서도 '살아 있다'는 로그를 남김.
	- 실제 학습이 오래 걸릴 수 있으므로, 이 함수로 짧게 쪼개 기다립니다.
	"""
	elapsed = 0.0
	while elapsed < seconds:
		time.sleep(min(tick, seconds - elapsed))
		elapsed += min(tick, seconds - elapsed)
		job.push(f"heartbeat +{elapsed:.1f}s")


def _run_job(job_id: str) -> None:
	"""
	실제 학습 본문(백그라운드 스레드).
	1단계: 기존 train.main()을 호출해 data/model.pkl 저장.
	2단계: 여기서 K-Fold/A/B/C + manifest.json까지 수행하도록 확장.
	"""
	job = get_status(job_id)
	if not job:
		return  # 이례적: 생성 직후 소실된 경우

	try:
		# Step 1) 대기열 → TRAINING
		job.set("TRAINING", 20, "[TRAIN] queued → training")
		_sleep_with_heartbeat(job, 0.5)

		# Step 2) (2단계에서 의미 있게 사용)
		job.set("EVALUATING", 40, "[TRAIN] preparing evaluation (K-Fold reserved)")
		_sleep_with_heartbeat(job, 0.5)

		# Step 3) 실제 학습 — 현재는 기존 train.main() 실행
		job.set("TRAINING", 60, "[TRAIN] running train.main() to build model.pkl")
		# 여기서 실제 학습 수행(데이터 로드→피처→학습→성능로그→model.pkl 저장)
		train.main()
		job.push("[TRAIN] train.main() finished")

		# Step 4) 저장 단계 — model/manifest 저장(2단계 확장 포인트)
		job.set("SAVING", 80, "[TRAIN] saving artifacts (model/manifest)")
		_sleep_with_heartbeat(job, 0.4)

		# Step 5) 완료
		job.set("READY", 100, "[TRAIN] job completed successfully")
		job.done()

	except Exception as e:
		job.set("FAILED", job.progress, f"[ERROR] {e!r}")
		job.error = str(e)
		job.done()
