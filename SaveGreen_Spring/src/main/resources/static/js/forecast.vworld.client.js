// vworldClient.js
// 역할: VWorld로 PNU/건물정보 조회 → builtYear 설정 → 화면/예측 갱신(전역 함수 제공)

(function () {
	// ▼ 반드시 본인 키로 교체(운영은 서버 프록시 권장)
	const VWORLD_KEY = "AED66EDE-3B3C-3034-AE11-9DBA47236C69";

	/* ---------- 내부 유틸 ---------- */

	// 좌표(lon, lat) → PNU (지번 경계)
	async function getPnuFromLonLat(lon, lat) {
		const url = new URL("https://api.vworld.kr/req/data");
		url.search = new URLSearchParams({
			service: "data",
			request: "GetFeature",
			data: "LP_PA_CBND",      // 지번(지적) 경계 표준 레이어
			format: "json",
			size: "1",
			key: VWORLD_KEY,
			crs: "EPSG:4326",
			geometry: "false",
			geomFilter: `point(${lon} ${lat})`
		}).toString();

		const r = await fetch(url);
		if (!r.ok) throw new Error("PNU 조회 실패");
		const j = await r.json();
		const feats = j?.response?.result?.featureCollection?.features;
		const props = feats && feats[0]?.properties;
		return props?.PNU || props?.pnu || null;
	}

	// PNU → 건물정보
	async function getBuildingInfo(pnu) {
		if (!pnu) return null;
		const url = new URL("https://api.vworld.kr/ned/data/getBuildingUse");
		url.search = new URLSearchParams({
			key: VWORLD_KEY,
			format: "json",
			pnu,
			numOfRows: "1"
		}).toString();

		const r = await fetch(url);
		if (!r.ok) throw new Error("건물정보 조회 실패");
		const j = await r.json();

		// 다양한 응답 스키마 안전 대응
		const item1 = j?.response?.result?.item;
		if (item1) return item1;

		const items2 = j?.response?.result?.items; // 혹시 모를 변형
		if (Array.isArray(items2) && items2.length) {
			return items2[0]?.properties || items2[0] || null;
		}

		const feats = j?.response?.result?.featureCollection?.features;
		if (Array.isArray(feats) && feats.length) {
			return feats[0]?.properties || null;
		}
		return null;
	}

	// 응답 → 연도만 추출
	function extractBuiltYear(buildingInfo) {
		const ymd = buildingInfo?.useConfmDe || buildingInfo?.USECFMDE;
		if (!ymd) return null;
		const s = String(ymd).replace(/\D/g, "");
		return s.length >= 4 ? Number(s.slice(0, 4)) : null;
	}

	// DOM/상태 갱신 + 재렌더
	function applyBuiltYearAndRefresh({ by, pnu, from }) {
		window.savegreen = window.savegreen || {};
		window.savegreen.builtYear = by;

		const root = document.getElementById("forecast-root");
		if (root) {
			root.dataset.builtYear = String(by);
			root.dataset.builtYearFrom = from || "vworld";
			if (pnu) {
				root.dataset.pnu = pnu;
				root.dataset.pnuFrom = from || "vworld";
			}
		}

		if (typeof renderBuildingCard === "function") renderBuildingCard();
		if (typeof reloadForecast === "function") reloadForecast();
	}

	/* ---------- 공개 함수(전역) ---------- */

	// 지도 클릭 등: 좌표로부터 PNU→builtYear 설정
	window.savegreenSetBuiltYearFromCoord = async function (lon, lat) {
		try {
			const pnu = await getPnuFromLonLat(lon, lat);
			if (!pnu) { alert("이 지점의 PNU 정보를 찾지 못했습니다."); return; }

			const info = await getBuildingInfo(pnu);
			const by = extractBuiltYear(info);
			if (!by) { alert("준공연도(useConfmDe) 정보를 찾지 못했습니다."); return; }

			applyBuiltYearAndRefresh({ by, pnu, from: "vworld" });
		} catch (e) {
			console.error("[vworld] set from coord failed:", e);
			alert("연식 자동 감지 중 오류가 발생했습니다.");
		}
	};

	// PNU로 직접 설정
	window.savegreenSetBuiltYearFromPnu = async function (pnu) {
		try {
			const info = await getBuildingInfo(pnu);
			const by = extractBuiltYear(info);
			if (!by) { alert("준공연도(useConfmDe) 정보를 찾지 못했습니다."); return; }

			applyBuiltYearAndRefresh({ by, pnu, from: "vworld" });
		} catch (e) {
			console.error("[vworld] set from pnu failed:", e);
			alert("연식 자동 감지 중 오류가 발생했습니다.");
		}
	};
})();
