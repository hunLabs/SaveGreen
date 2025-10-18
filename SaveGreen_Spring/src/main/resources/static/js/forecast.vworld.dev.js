// forecast.vworld.dev.js — VWorld 브리지(개발/시연용, 전역 노출)
(function () {
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

	/* ---------- VWorld Bridge (개발용) ---------- */
	const VWORLD_KEY = "AED66EDE-3B3C-3034-AE11-9DBA47236C69"; // 운영 전 키 주의

	async function getPnuFromLonLat(lon, lat) {
		const url = new URL('https://api.vworld.kr/req/data');
		url.search = new URLSearchParams({
			service: 'data',
			request: 'GetFeature',
			data: 'LP_PA_CBND',
			format: 'json',
			size: '1',
			key: VWORLD_KEY,
			crs: 'EPSG:4326',
			geometry: 'false',
			geomFilter: `point(${lon} ${lat})`
		}).toString();

		const res = await fetch(url);
		if (!res.ok) throw new Error('PNU 조회 실패');
		const j = await res.json();
		const feats = j?.response?.result?.featureCollection?.features;
		const props = feats && feats[0]?.properties;
		return props?.PNU || props?.pnu || null;
	}

	async function getBuildingInfo(pnu) {
		if (!pnu) return null;
		const url = new URL('https://api.vworld.kr/ned/data/getBuildingUse');
		url.search = new URLSearchParams({
			key: VWORLD_KEY,
			format: 'json',
			pnu,
			numOfRows: '1'
		}).toString();

		const res = await fetch(url);
		if (!res.ok) throw new Error('건물 정보 조회 실패');
		const j = await res.json();

		const items =
			j?.response?.result?.item ||
			j?.response?.result?.featureCollection?.features ||
			[];
		const first = items[0]?.properties || items[0] || null;
		return first;
	}

	function extractBuiltYear(info) {
		const ymd = info?.useConfmDe || info?.USECFMDE;
		if (!ymd) return null;
		const s = String(ymd);
		return s.length >= 4 ? Number(s.slice(0, 4)) : null;
	}

	// 좌표 → PNU → 연식 세팅 → 재렌더 (개발/시연용)
	window.savegreenSetBuiltYearFromCoord = async function (lon, lat) {
		try {
			const pnu = await getPnuFromLonLat(lon, lat);
			if (!pnu) { alert('이 지점의 고유번호(PNU) 정보를 찾지 못했습니다.'); return; }

			const info = await getBuildingInfo(pnu);
			const by = extractBuiltYear(info);
			if (!by) { alert('준공연도(useConfmDe) 정보를 찾지 못했습니다.'); return; }

			window.savegreen = window.savegreen || {};
			window.savegreen.builtYear = by;

			const root = document.getElementById('forecast-root');
			if (root) {
				root.dataset.builtYear = String(by);
				root.dataset.builtYearFrom = 'vworld';
				root.dataset.pnu = pnu;
				root.dataset.pnuFrom = 'vworld';
			}

			renderBuildingCard();
			await reloadForecast();
		} catch (e) {
			console.error('[vworld] builtYear set failed : ', e);
			alert('연식 자동 감지 중 오류가 발생했습니다.');
		}
	};

	// PNU → 연식 세팅 → 재렌더 (개발/시연용)
	window.savegreenSetBuiltYearFromPnu = async function (pnu) {
		try {
			const info = await getBuildingInfo(pnu);
			const by = extractBuiltYear(info);
			if (!by) { alert('준공연도(useConfmde) 정보를 찾지 못했습니다.'); return; }

			window.savegreen = window.savegreen || {};
			window.savegreen.builtYear = by;

			const root = document.getElementById('forecast-root');
			if (root) {
				root.dataset.builtYear = String(by);
				root.dataset.builtYearFrom = 'vworld';
				root.dataset.pnu = pnu;
				root.dataset.pnuFrom = 'vworld';
			}

			renderBuildingCard();
			await reloadForecast();
		} catch (e) {
			console.error('[vworld] builtYear set (from pnu) failed : ', e);
			alert('연식 자동 감지 중 오류가 발생했습니다.');
		}
	};
})();
