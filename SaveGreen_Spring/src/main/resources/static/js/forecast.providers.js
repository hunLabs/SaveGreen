/* =========================================================
 * forecast.providers.js (FINAL)
 * - 단일 진입점: getBuildingContext()
 * - 소스 우선순위: page → localStorage/sessionStorage → url → vworld  (auto 기준)
 * - builtYear=0 은 유효값으로 취급하지 않음 (양수만 허용)
 *
 * [개요]
 * 이 모듈은 Forecast 페이지가 시작될 때 "건물 컨텍스트
 * (buildingId, builtYear, pnu, 좌표, 기간 등)"를 일관된 구조로
 * 수집/정규화하는 단일 진입점을 제공합니다.
 *
 * [동작 흐름]
 * 1) pickStrategy()
 *    - 컨텍스트 소스 우선순위를 결정합니다.
 *    - sessionStorage/localStorage 의 'source' 키로 강제 가능
 *      ('local' | 'url' | 'vworld'); 기본은 'auto'
 * 2) trySource(kind)
 *    - kind 순서대로 page/local/url/vworld 를 조회합니다.
 * 3) isValid()
 *    - 최소 유효성 검사(기간 from/to + 대상 식별자/좌표 중 1개 이상)
 * 4) normalize()
 *    - 숫자/문자 필드 표준화(양수/숫자 변환 및 대체 키 수렴)
 *
 * [정규화 결과 필드]
 * - buildingId : 숫자 또는 undefined
 * - builtYear  : 양수(정수) 또는 undefined (0은 무효)
 * - useName    : 용도명(문자열) 또는 undefined
 * - floorArea  : 연면적(숫자) 또는 undefined
 * - area       : 면적(보조, 숫자) 또는 undefined
 * - pnu        : 지번 고유 식별자(문자열) 또는 undefined
 * - from/to    : 예측 구간(문자열) — 기본값: 현재연도 ~ 현재연도+10
 * - lat/lon    : 좌표(숫자) 또는 undefined
 *
 * [주의]
 * - GreenFinder가 sessionStorage 중심으로 값을 남기므로 세션 스니핑 지원
 * - /api/ext/vworld/* 프록시를 통해 도로명/지번/건물명 보강(enrichContext)
 * - 이 파일은 “컨텍스트 수집/정규화”에 집중(로더/차트/KPI는 별도)
 * ========================================================= */

;(function (global) {
	'use strict';

	/* ---------- 상수 ---------- */
	// from/to 기본값으로 사용할 현재 연도와 예측 수평선(10년)
	const NOW_YEAR = new Date().getFullYear();
	const HORIZON_YEARS = 10;

	/* ---------- 공용 스토리지 헬퍼 (세션 우선, 로컬 폴백) ---------- */
	/**
	 * storageGet(key)
	 * - sessionStorage 에서 먼저 찾고, 없으면 localStorage 에서 찾는다.
	 * - GreenFinder 의 세션 단위 동작과 잘 맞음(탭 격리).
	 */
	function storageGet(key) {
		try {
			const v = sessionStorage.getItem(key);
			if (v !== null && v !== undefined) return v;
		} catch {}
		try {
			return localStorage.getItem(key);
		} catch {}
		return null;
	}

	/* ---------- GreenFinder 세션 스니핑 ---------- */
	/**
	 * sniffSessionForBuilding()
	 * - GreenFinder(선행 검색)에서 sessionStorage 에 남긴 정보를 모아
	 *   Forecast 컨텍스트의 씨앗으로 사용한다.
	 * - 하나라도 값이 있으면 객체를 반환; 전무하면 null.
	 */
	function sniffSessionForBuilding() {
		try {
			// GreenFinder 가 남기는 키들(스냅샷 기준)
			const get = (k) => (sessionStorage.getItem(k) || '').toString().trim();

			const ldCodeNm = get('ldCodeNm');				// 예: '대전광역시 서구 둔산동'
			const mnnmSlno = get('mnnmSlno');				// 예: '1268'
			const pnu = get('pnu');							// 예: '3017011200112680000'
			const latStr = get('lat');						// 위도(문자열)
			const lonRaw = get('lon') || get('lng');		// 경도 키 호환(lon | lng)
			const buildingName = get('buildingName') || get('buldNm') || '';

			// ✨ 추가: 사용승인일/연식 스니핑(세션 읽기 전용)
			const useConfmDe = get('useConfmDe');			// 예: '1996-12-05'
			const builtYearRaw = get('builtYear');			// 예: '1996'
			const builtYear = (() => {
				if (/^\d{4}$/.test(builtYearRaw)) return builtYearRaw;
				if (/^\d{4}/.test(useConfmDe)) return useConfmDe.slice(0, 4);
				return '';
			})();

			// 지번주소 조립(둘 다 있을 때만)
			const jibunAddr = (ldCodeNm && mnnmSlno) ? `${ldCodeNm} ${mnnmSlno}` : '';

			// 숫자 변환(NaN 방지)
			const latNum = Number(latStr);
			const lonNum = Number(lonRaw);

			const o = {
                // 표준 필드
				pnu: pnu || undefined,
				jibunAddr: jibunAddr || undefined,
				lat: Number.isFinite(latNum) ? latNum : undefined,
				lon: Number.isFinite(lonNum) ? lonNum : undefined,
				buildingName: buildingName || undefined,

				// ✨ 연식/사용승인일(있을 때만)
				builtYear: builtYear || undefined,
				useConfmDe: useConfmDe || undefined,

				// from/to 기본값(검증 편의를 위해 항상 주입)
				from: String(NOW_YEAR),
				to: String(NOW_YEAR + HORIZON_YEARS)
			};

			return Object.values(o).some(v => v != null && String(v).trim() !== '') ? o : null;
		} catch (e) {
			console.warn('[provider] sniffSessionForBuilding error:', e);
			return null;
		}
	}

	/* ---------- 컨텍스트 보강(도로명/지번/건물명) ---------- */
	/**
	 * enrichContext(ctx)
	 * - seed 로 받은 좌표(lon/lat) 또는 pnu 만으로 부족할 때
	 *   서버 프록시(/api/ext/vworld/*)를 이용해 도로명/지번/건물명을 보강.
	 * - FE 는 원본 JSON 을 수용하고, 키는 방어적으로 매핑한다.
	 */
	async function enrichContext(ctx) {
		// 원본 변조 방지
		const out = { ...ctx };

		try {
			// 1) 좌표 → 도로명/지번
			if (!out.roadAddr && out.lon != null && out.lat != null) {
				const url = `/api/ext/vworld/revgeo?lat=${encodeURIComponent(out.lat)}&lon=${encodeURIComponent(out.lon)}`;
				const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
				if (r.ok) {
					const j = await r.json();
					// 다양한 응답 키에 대응(프로젝트 프록시/원본 API 혼용 대비)
					out.roadAddr  = out.roadAddr  || j.roadAddr   || j.roadAddress   || j.road_name || j.road || '';
					out.jibunAddr = out.jibunAddr || j.jibunAddr  || j.parcelAddress || j.parcel    || j.jibun || '';
				}
			}

			// 2) PNU → 건물명
			if (!out.buildingName && out.pnu) {
				try {
					const r2 = await fetch(`/api/ext/vworld/parcel?pnu=${encodeURIComponent(out.pnu)}`, { headers: { 'Accept': 'application/json' } });
					if (r2.ok) {
						const j2 = await r2.json();
						out.buildingName = j2?.buldNm || j2?.buildingName || j2?.buld_name || out.buildingName;
					}
				} catch (e2) {
					console.warn('[provider] buildingName fetch skipped:', e2);
				}
			}
		} catch (e) {
			console.warn('[provider] enrichContext error:', e);
		}

		return out;
	}

	/* 네임스페이스로 보강 API 노출(디버깅/수동 보강) */
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};
	window.SaveGreen.Forecast.providers = window.SaveGreen.Forecast.providers || {};
	window.SaveGreen.Forecast.providers.enrichContext = enrichContext;

	/* ---------- config & useName → 표준 타입 매핑 유틸 ---------- */
	(function () {
		window.SaveGreen = window.SaveGreen || {};
		window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};
		window.SaveGreen.Forecast.providers = window.SaveGreen.Forecast.providers || {};

		const DAE_CONFIG_URL = '/config/dae.json';
		let __daeConfigCache = null;

		// 한/영 혼용 용도명 → 표준 타입(factory|school|hospital|office)
		const USE_TYPE_MAP = {
			// factory
			'공장':'factory','제조':'factory','산업':'factory','factory':'factory',
			// school
			'학교':'school','초등학교':'school','중학교':'school','고등학교':'school','대학교':'school','교육':'school','school':'school',
			// hospital
			'병원':'hospital','의료':'hospital','의원':'hospital','종합병원':'hospital','hospital':'hospital',
			// office
			'오피스':'office','사무':'office','사무실':'office','업무':'office','office':'office'
		};
		const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase().replace(/\s+/g, ''));

		function mapUseNameToType(useName) {
			const key = norm(useName);
			if (!key) return null;
			if (USE_TYPE_MAP[key]) return USE_TYPE_MAP[key];
			for (const k in USE_TYPE_MAP) {
				if (key.includes(norm(k))) return USE_TYPE_MAP[k];
			}
			return null;
		}

		// 건물명/주소 키워드로 휴리스틱 추론(용도명 없을 때 보조)
		function mapFromTextHeuristics(txt) {
			const s = norm(txt);
			if (!s) return null;
			if (s.includes('병원') || s.includes('의료') || s.includes('치과') || s.includes('의원')) return 'hospital';
			if (s.includes('초등학교') || s.includes('중학교') || s.includes('고등학교') || s.includes('대학교') || s.includes('학교')) return 'school';
			if (s.includes('공장') || s.includes('산업') || s.includes('제조')) return 'factory';
			if (s.includes('오피스') || s.includes('사무') || s.includes('업무')) return 'office';
			return null;
		}

		// 컨텍스트에서 표준 타입 결정(우선순위: useName → buildingName → address → ctx.type)
		function pickTypeFromContext(ctx) {
			let t = mapUseNameToType(ctx?.useName);
			if (!t) t = mapFromTextHeuristics(ctx?.buildingName);
			if (!t) t = mapFromTextHeuristics(ctx?.address || ctx?.jibunAddr || ctx?.roadAddr);
			if (!t && ['factory','school','hospital','office'].includes(norm(ctx?.type))) t = norm(ctx?.type);
			try { console.log('[providers] type pick:', { useName: ctx?.useName, buildingName: ctx?.buildingName, addr: ctx?.address || ctx?.jibunAddr, mapped: t }); } catch {}
			return t;
		}

		// dae.json 1회 로드
		async function loadDaeConfig() {
			if (__daeConfigCache) return __daeConfigCache;
			const res = await fetch(DAE_CONFIG_URL, { cache: 'no-cache' });
			if (!res.ok) throw new Error('[providers] dae.json load fail: ' + res.status);
			const json = await res.json();
			__daeConfigCache = json;
			try { console.log('[providers] dae.json loaded:', json?.version || '(no-version)', 'mode=', json?.euiRules?.mode); } catch {}
			return json;
		}

		// 타입별 base 추출
		function getBaseAssumptions(daeConfig, type) {
			return daeConfig?.types?.[type]?.base || null;
		}

        // [추가]
        // euiRules 추출: dae.json의 등급/EUI/PEF 규칙 블록을 그대로 반환
        function getEuiRules(daeConfig) {
            return daeConfig?.euiRules || null;
        }


		// 공개
		window.SaveGreen.Forecast.mapUseNameToType = mapUseNameToType;
		window.SaveGreen.Forecast.loadDaeConfig = loadDaeConfig;
		window.SaveGreen.Forecast.getBaseAssumptions = getBaseAssumptions;
        // [추가]
        window.SaveGreen.Forecast.getEuiRules = getEuiRules;


		// (선택) 외부에서 타입 추론이 필요할 때 노출
		window.SaveGreen.Forecast.providers.pickTypeFromContext = pickTypeFromContext;
	})();

	/* ---------- 소스 우선순위 결정 ---------- */
	/**
	 * pickStrategy()
	 * - session/local 의 'source' 값으로 강제 가능 ('local'|'url'|'vworld')
	 * - 없으면 auto: ['page','local','url','vworld']
	 */
	function pickStrategy() {
		const pref = (storageGet('source') || 'auto').toLowerCase();
		if (pref === 'local')  return ['local', 'page', 'url', 'vworld'];
		if (pref === 'url')    return ['url', 'page', 'local', 'vworld'];
		if (pref === 'vworld') return ['vworld', 'page', 'local', 'url'];
		return ['page', 'local', 'url', 'vworld']; // auto
	}

	/* ---------- 소스 시도기 ---------- */
	/**
	 * trySource(kind)
	 * - kind: 'page' | 'local' | 'url' | 'vworld'
	 * - vworld 는 네트워크 호출(프록시) — seed(최소 pnu 또는 좌표)가 없으면 null
	 */
	async function trySource(kind) {
		if (kind === 'page')   return readFromPage();
		if (kind === 'local')  return readFromLocal();
		if (kind === 'url')    return readFromUrl();
		if (kind === 'vworld') return fetchFromVWorldProxy();
		return null;
	}

	/* ---------- 단일 진입점 ---------- */
	/**
	 * getBuildingContext()
	 * - 우선순위대로 소스를 조회하여 최초 유효 컨텍스트를 normalize() 후 반환.
	 * - 어떤 소스에서도 얻지 못하면 예외를 던진다(상위에서 더미/폴백 처리).
	 */
	async function getBuildingContext() {
		const order = pickStrategy();
		console.info('[provider] order =', order.join(' → '));

		for (const s of order) {
			try {
				const v = await trySource(s);
				if (isValid(v)) {
					const ctx = normalize(v);
					console.info(`[provider] hit = ${s}`, ctx);
					return ctx;
				}
				console.debug(`[provider] ${s} → empty or invalid`, v);
			} catch (e) {
				console.warn(`[provider] ${s} failed:`, e);
			}
		}
		throw new Error('No context source available (page/local/url/vworld)');
	}

	/* ------------------------ Sources ------------------------ */

	/**
	 * readFromPage()
	 * - 서버 템플릿이 심어둔 #forecast-root 의 data-* 를 읽어 컨텍스트 구성.
	 * - 서버에서 이미 정규화된 값을 받을 수 있어 신뢰도가 높음.
	 */
	function readFromPage() {
		const root = document.getElementById('forecast-root');
		if (!root) return null;

		const o = {
			buildingId: nvPos(root.dataset.bid) ?? parseIdFromForecastPath(),
			builtYear:  nvPos(root.dataset.builtYear),	// 양수만
			useName:    sv(root.dataset.use),
			floorArea:  nv(root.dataset.floorArea),
			area:       nv(root.dataset.area),
			pnu:        sv(root.dataset.pnu),
			from:       sv(root.dataset.from) || String(NOW_YEAR),
			to:         sv(root.dataset.to)   || String(NOW_YEAR + HORIZON_YEARS),
			lat:        nv(root.dataset.lat),
			lon:        nv(root.dataset.lon)
		};
		return hasAny(o) ? o : null;
	}

	/**
	 * parseIdFromForecastPath()
	 * - /forecast/{id} 형태의 URL에서 {id}를 추출하여 buildingId 후보로 사용.
	 */
	function parseIdFromForecastPath() {
		try {
			const m = String(location.pathname).match(/^\/forecast\/(\d+)(?:\/)?$/);
			return m ? Number(m[1]) : undefined;
		} catch { return undefined; }
	}

	/**
	 * readFromLocal()
	 * - 저장 스냅샷(JSON) + GreenFinder 세션 스니핑을 병합.
	 * - 규칙: 저장 스냅샷(JSON, readFromLocalStorage)이 세션 스니핑보다 우선.
	 * - from/to 비어 있으면 NOW_YEAR ~ NOW_YEAR+10으로 보강.
	 */
	function readFromLocal() {
		const a = readFromLocalStorage() || {};		// 스냅샷(있으면 우선)
		const b = sniffSessionForBuilding() || {};	// 세션 스니핑

		const merged = { ...b, ...a };

		if (!merged.from) merged.from = String(NOW_YEAR);
		if (!merged.to)   merged.to   = String(NOW_YEAR + HORIZON_YEARS);

		return Object.values(merged).some(v => v != null && String(v).trim() !== '')
			? merged
			: null;
	}

	/**
	 * readFromLocalStorage()
	 * - (세션 우선, 로컬 폴백) 'forecast.ctx' JSON 을 파싱.
	 * - builtYear===0 은 무효 처리.
	 */
	function readFromLocalStorage() {
		const raw = storageGet('forecast.ctx');
		if (!raw) return null;
		try {
			const o = JSON.parse(raw);
			if (o && Number(o.builtYear) === 0) delete o.builtYear;
			return hasAny(o) ? o : null;
		} catch (e) {
			console.warn('[provider] forecast.ctx JSON parse error:', e);
			return null;
		}
	}

	/**
	 * readFromUrl()
	 * - 쿼리스트링 기반 컨텍스트(예: /forecast?builtYear=1999&...).
	 * - from/to 비어 있으면 기본값 보강.
	 */
	function readFromUrl() {
		try {
			const q = new URLSearchParams(location.search);
			const o = {
				buildingId: nvPos(q.get('bid')) ?? nvPos(q.get('id')),
				builtYear:  nvPos(q.get('builtYear')),	// 양수만
				useName:    sv(q.get('useName') || q.get('use')),
				floorArea:  nv(q.get('floorArea')),
				area:       nv(q.get('area')),
				pnu:        sv(q.get('pnu')),
				from:       sv(q.get('from')) || String(NOW_YEAR),
				to:         sv(q.get('to'))   || String(NOW_YEAR + HORIZON_YEARS),
				lat:        nv(q.get('lat')),
				lon:        nv(q.get('lon'))
			};
			return hasAny(o) ? o : null;
		} catch { return null; }
	}

	/**
	 * fetchFromVWorldProxy()
	 * - seed(페이지/로컬/URL 중 하나) 가 있을 때, /api/ext/vworld/* 프록시로
	 *   역지오코딩/필지 조회를 수행하여 컨텍스트 보강.
	 * - seed 필요조건: pnu 또는 (lat, lon) 중 하나.
	 */
	async function fetchFromVWorldProxy() {
		const seed = readFromPage() || readFromLocalStorage() || readFromUrl();
		if (!seed) return null;

		const pnu = seed.pnu && String(seed.pnu).trim();
		const lat = isFiniteNum(seed.lat) ? Number(seed.lat) : undefined;
		const lon = isFiniteNum(seed.lon) ? Number(seed.lon) : undefined;

		let url = null;
		if (pnu) url = `/api/ext/vworld/parcel?pnu=${encodeURIComponent(pnu)}`;
		else if (lat != null && lon != null) url = `/api/ext/vworld/revgeo?lat=${lat}&lon=${lon}`;
		else return null;

		console.debug('[provider] vworld GET', url);
		const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
		if (!res.ok) throw new Error(`VWorld ${res.status}`);

		const v = await res.json();
		return { ...seed, ...v };
	}

	/* ------------------------ Helpers ------------------------ */

	/**
	 * isValid(v)
	 * - 최소 요건:
	 *   (1) from/to 존재,
	 *   (2) (양수 builtYear) | (양수 buildingId) | (pnu 문자열) | (좌표) 중 1개 이상
	 */
	function isValid(v) {
		if (!v) return false;
		const hasFT = nonEmpty(v.from) && nonEmpty(v.to);
		const hasKey =
			(nvPos(v.builtYear) !== undefined) ||
			(nvPos(v.buildingId) !== undefined) ||
			nonEmpty(v.pnu) ||
			isFiniteNum(v.lat) || isFiniteNum(v.lon);
		return !!(hasFT && hasKey);
	}

	/**
	 * normalize(v)
	 * - 숫자/문자 필드 정규화 및 대체 키(use_name 등) 수렴.
	 * - builtYear 는 양수만 인정, 면적류는 숫자 변환.
	 */
	function normalize(v) {
		const by = nvPos(v.builtYear);
		return {
			buildingId: nvPos(v.buildingId),
			builtYear:  by,
			useName:    v.useName ?? v.use_name ?? undefined,
			floorArea:  nv(v.floorArea) ?? nv(v.area),
			area:       nv(v.area),
			pnu:        sv(v.pnu),
			from:       String(v.from ?? NOW_YEAR),
			to:         String(v.to   ?? (NOW_YEAR + HORIZON_YEARS)),
			lat:        isFiniteNum(v.lat) ? Number(v.lat) : undefined,
			lon:        isFiniteNum(v.lon) ? Number(v.lon) : undefined
		};
	}

	/* ---- 미세 유틸 ---- */

	// 숫자 변환(공백/빈문자/null → undefined, 숫자 아님 → undefined)
	function nv(x) {
		if (x == null) return undefined;
		const s = String(x).trim();
		if (s === '') return undefined;
		const n = Number(s);
		return Number.isFinite(n) ? n : undefined;
	}

	// 양수 숫자만 허용 (0/음수/NaN → undefined)
	function nvPos(x) {
		const n = nv(x);
		return (Number.isFinite(n) && n > 0) ? n : undefined;
	}

	// 문자열 정규화(공백/빈문자/null → undefined)
	function sv(x) {
		if (x == null) return undefined;
		const s = String(x).trim();
		return s ? s : undefined;
	}

	// 문자열 존재/비공백 여부
	function nonEmpty(x) { return x != null && String(x).trim() !== ''; }

	// 유한 숫자 여부(문자 입력도 숫자로 변환 가능하면 true)
	function isFiniteNum(x) { const n = Number(x); return Number.isFinite(n); }

	// 객체에 의미있는 값이 하나라도 있는지
	function hasAny(o) { return !!(o && Object.values(o).some(v => v != null && String(v) !== '')); }

	/* ------------------------ 전역 노출 ------------------------ */
	/**
	 * - global.getBuildingContext: 간편 호출용(레거시/테스트)
	 * - window.SG.providers.getBuildingContext: 앱 내부 표준 접근 경로
	 * - CommonJS(module.exports) 호환: 테스트/빌드 환경
	 */
	global.getBuildingContext = getBuildingContext;
	if (typeof window !== 'undefined') {
		window.SG = window.SG || {};
		window.SG.providers = { getBuildingContext };
	}
	if (typeof exports === 'object' && typeof module !== 'undefined') {
		module.exports = { getBuildingContext };
	}
})(window);
