# ============================================================
# SaveGreen / server.py (단일 파일 런처)
# ------------------------------------------------------------
# 목적
# - PyCharm에서 이 파일만 "실행(▶)"해도 FastAPI 서버가 뜨도록 함.
# - uvicorn을 코드로 실행하므로, Run Configuration 없이도 동작.
# 사용
# - 그냥 실행: 127.0.0.1:8000
# - 브라우저: http://localhost:8000/health
# ============================================================

import uvicorn

if __name__ == "__main__":
	uvicorn.run(
		"app.main:app",
		host="127.0.0.1",
		port=8000,
		reload=False,
		workers=1
	)
