# ============================================================
# SaveGreen / FastAPI 엔트리
# ------------------------------------------------------------
# - /health : 생존 상태 + 모델상태 반환(dummy/loaded)
# - /predict: 스프링 표준화 입력 → 예측 응답
# - 앱 기동 시 모델 싱글톤 준비
# ============================================================

from fastapi import FastAPI
from .schema import PredictRequest, PredictResponse
from .model import ModelManager

_model: ModelManager | None = None

def get_model() -> ModelManager:
	global _model
	if _model is None:
		_model = ModelManager()
	return _model

app = FastAPI(title="SaveGreen ML API", version="0.1.1")

@app.get("/health")
def health():
	m = get_model()
	return {"status": "ok", "model": m.status(), "version": "0.1.1"}

@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
	m = get_model()
	out = m.predict(req.model_dump())
	print(f"[ML] type={req.type} floor={req.floorAreaM2} builtYear={req.builtYear} -> {out}")
	return PredictResponse(**out)

@app.get("/favicon.ico")
def favicon():
	return {}
