/* =========================================================
 * SaveGreen / forecast.providers.js (FINAL)
 * ---------------------------------------------------------
 * [역할/설계]
 * - Forecast 페이지의 "건물 컨텍스트"를 수집/정규화하는 단일 진입점 제공.
 * - 소스 우선순위: page → localStorage/sessionStorage → url → vworld
 * - 카탈로그 주입: ml_dataset.json 항목의 type/eui_kwh_m2y/energy_kwh를
 *   컨텍스트로 먼저 주입(오탈자 보정 포함), preset(type) 우선 확정.
 * - 타입 확정 우선순위:
 *   type(영문 core) → buildingType2 → useName → buildingType1 → (이름/주소) → unknown
 *   ※ office 폴백 금지(unknown 유지), 단 코어타입이면 즉시 확정.
 *
 * [주요 공개 API]
 * - getBuildingContext(): Promise<Context>
 * - window.SaveGreen.Forecast.providers.applyCatalogToContext(item, ctx)
 * - window.SaveGreen.Forecast.loadDaeConfig(), getEuiRules*, getBaseAssumptions()
 *
 * [주의]
 * - builtYear=0 은 유효하지 않음(양수만 허용).
 * - 네임스페이스 가드 필수: window.SaveGreen/Forecast/providers 보장 후 export.
 * - 콘솔 로그는 SaveGreen.log.* 사용(존재 시).
 * ========================================================= */

;(function (global) {
	'use strict';

	/* ---------- 상수 ---------- */
	const NOW_YEAR = new Date().getFullYear();
	const HORIZON_YEARS = 10;

	// 컨텍스트 캐시(프리로드 ↔ runForecast 공유) + 카탈로그 URL
    let __CTX_CACHE = null;
    const CATALOG_URLS = [
    	'/dummy/ml_dataset.json',   // 1순위: ML용 카탈로그
    	'/dummy/green.json'         // 2순위: 보조(있으면)
    ];

	/* =========================================================
	 * 1) 타입 매핑 테이블/유틸
	 * ---------------------------------------------------------
	 * - USE_TYPE_MAP: 한글/영문/약어 동시 지원 (core: factory|school|hospital|office)
	 * - findCoreTypeByIncludes(): 문자열에 키가 포함되면 core 타입 반환
	 * ========================================================= */
	const USE_TYPE_MAP = {
		// 공장
		"공장": "factory", "일반공장": "factory", "제조": "factory", "산업": "factory",
		"factory": "factory", "industrial": "factory", "산단": "factory", "플랜트": "factory",
		"물류": "factory", "창고": "factory",
		// 학교
		"학교": "school", "초등학교": "school", "중학교": "school", "고등학교": "school",
		"대학교": "school", "campus": "school", "school": "school", "교육": "school",
		// 병원
		"병원": "hospital", "종합병원": "hospital", "의원": "hospital", "클리닉": "hospital",
		"의료원": "hospital", "요양": "hospital", "치과": "hospital", "한방": "hospital",
		"medical": "hospital", "clinic": "hospital", "hospital": "hospital", "의료": "hospital",
		// 사무/업무/오피스
		"사무": "office", "업무": "office", "오피스": "office", "office": "office",
		"오피스텔": "office", "행정": "office"
	};

	function findCoreTypeByIncludes(s) {
		if (!s) return null;
		const text = String(s).toLowerCase();
		for (const k in USE_TYPE_MAP) {
			if (text.includes(k)) return USE_TYPE_MAP[k];
		}
		return null;
	}

	/* =========================================================
	 * 2) 공용 스토리지 헬퍼 (세션 우선, 로컬 폴백)
	 * ========================================================= */
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

	/* =========================================================
	 * 3) 카탈로그 → 컨텍스트 주입(타입/에너지/EUI) + 정규화
	 * ---------------------------------------------------------
	 * - Type | type | buildingType2(문자열/콤마/배열)에서 코어타입 추출
	 * - 오탈자 보정(factroy 등)
	 * - eui_kwh_m2y / energy_kwh 숫자 필드 주입
	 * - SaveGreen.Forecast.providers.applyCatalogToContext 로 export
	 * ========================================================= */
	function applyCatalogToContext(item, ctx = {}) {
		// 0) 안전 가드
		if (!item || typeof item !== 'object') return ctx;

		// 1) type 후보 모으기
		const rawType = [
			item.Type, item.type, item.TYPE,
			item.buildingType2, item.building_type2
		].filter(v => v != null);

		let tokens = [];
		for (const v of rawType) {
			if (Array.isArray(v)) tokens.push(...v);
			else if (typeof v === 'string') tokens.push(...String(v).split(/[,\s]+/));
			else tokens.push(v);
		}
		tokens = tokens.map(t => String(t||'').trim().toLowerCase()).filter(Boolean);

		// 2) 오탈자 보정 + 코어타입 선별
		const fix = (s) => s
			.replace(/factroy|facotry|fatory/g, 'factory')
			.replace(/hosiptal|hosptial/g, 'hospital')
			.replace(/scholl|scohol/g, 'school')
			.replace(/offcie|ofice/g, 'office');

		const CORE = ['factory','hospital','school','office'];
		const mappedByToken = tokens
			.map(fix)
			.map(t => {
				// 한글 키워드 매핑
				if (/공장|제조|산단|플랜트|물류|창고/.test(t)) return 'factory';
				if (/병원|의료|의원|요양|치과|한방/.test(t)) return 'hospital';
				if (/학교|교육|초중고|대학교|캠퍼스/.test(t)) return 'school';
				if (/오피스|사무|업무|행정/.test(t)) return 'office';
				return t;
			})
			.find(t => CORE.includes(t)) || null;

		// 3) ctx에 주입(preset 경로)
		if (mappedByToken) ctx.type = mappedByToken;

		// 4) 숫자 필드(EUI/에너지) 주입
		if (Number.isFinite(Number(item.eui_kwh_m2y))) {
			ctx.eui_kwh_m2y = Number(item.eui_kwh_m2y);
		}
		if (Number.isFinite(Number(item.energy_kwh))) {
			ctx.energy_kwh = Number(item.energy_kwh);
		}

		// 5) 로그
		try {
			SaveGreen.log.kv('catalog', 'matched', {
				type: mappedByToken || null,
				eui: ctx.eui_kwh_m2y ?? null,
				energy_kwh: ctx.energy_kwh ?? null
			}, ['type','eui','energy_kwh']);
		} catch {}

		return ctx;
	}

	// 네임스페이스 가드 후 export
	if (typeof window !== 'undefined') {
		window.SaveGreen = window.SaveGreen || {};
		window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};
		window.SaveGreen.Forecast.providers = window.SaveGreen.Forecast.providers || {};
		window.SaveGreen.Forecast.providers.applyCatalogToContext = applyCatalogToContext;
	}

	/* =========================================================
     * 3-1) 카탈로그 적재/매칭/바인딩
     *  - loadCatalogs(): URL 배열에서 JSON 로드 → 하나의 배열로 머지
     *  - findCatalogItem(ctx): pnu → buildingName → 주소 순으로 매칭
     *  - attachCatalog(ctx): 매칭되면 applyCatalogToContext로 타입/EUI/에너지 주입
     * ========================================================= */
    let __CATALOG_CACHE = null;

    async function loadCatalogs() {
    	if (__CATALOG_CACHE) return __CATALOG_CACHE;
    	const lists = [];
    	for (const url of CATALOG_URLS) {
    		try {
    			const r = await fetch(url, { cache: 'no-store', headers: { 'Accept':'application/json' } });
    			if (!r.ok) continue;
    			const j = await r.json();
    			const arr = Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : []);
    			if (arr.length) lists.push(arr);
    		} catch {}
    	}
    	__CATALOG_CACHE = lists.flat();
    	try { SaveGreen.log?.info && SaveGreen.log.info('catalog', `loaded = ${__CATALOG_CACHE.length}`); } catch {}
    	return __CATALOG_CACHE;
    }

    function normStr(s) {
    	return (s == null) ? '' : String(s).trim().toLowerCase();
    }

    function findCatalogItem(ctx, items) {
    	const pnu = normStr(ctx.pnu);
    	const name = normStr(ctx.buildingName);
    	const addr = normStr(ctx.roadAddr || ctx.jibunAddr);

    	// 1) PNU 완전일치
    	if (pnu) {
    		const hit = items.find(it => normStr(it.pnu) === pnu);
    		if (hit) return { item: hit, how: 'pnu' };
    	}
    	// 2) buildingName (완전일치 우선 → 포함)
    	if (name) {
    		let hit = items.find(it => normStr(it.buildingName) === name || normStr(it.buldNm) === name);
    		if (hit) return { item: hit, how: 'name' };
    		hit = items.find(it => normStr(it.buildingName).includes(name) || normStr(it.buldNm).includes(name));
    		if (hit) return { item: hit, how: 'name~' };
    	}
    	// 3) 주소 포함 매칭(느슨)
    	if (addr) {
    		const hit = items.find(it => {
    			const a = normStr(it.roadAddr || it.roadAddress || it.parcelAddress || it.jibunAddr);
    			return a && (a.includes(addr) || addr.includes(a));
    		});
    		if (hit) return { item: hit, how: 'addr~' };
    	}
    	return { item: null, how: 'none' };
    }

    async function attachCatalog(ctx) {
    	try {
    		const items = await loadCatalogs();
    		if (!items || !items.length) return ctx;

    		const { item, how } = findCatalogItem(ctx, items);
    		if (!item) {
    			try { SaveGreen.log?.info && SaveGreen.log.info('catalog', 'no-match', { pnu: !!ctx.pnu, name: !!ctx.buildingName }); } catch {}
    			return ctx;
    		}

    		// 카탈로그 필드 주입(type/eui/energy) — 기존 함수 재사용
    		applyCatalogToContext(item, ctx);

    		// 이미 ctx.type이 있으면 보존, 없으면 catalog에서 확정
    		if (!ctx.type && ctx.mappedType) ctx.type = ctx.mappedType;
    		if (!ctx.mappedType && ctx.type) ctx.mappedType = ctx.type;

    		try { SaveGreen.log?.kv && SaveGreen.log.kv('catalog', `matched by ${how}`, { pnu: ctx.pnu || null, buildingName: ctx.buildingName || null }); } catch {}
    		return ctx;
    	} catch (e) {
    		SaveGreen.log?.warn && SaveGreen.log.warn('catalog', 'attachCatalog failed', e);
    		return ctx;
    	}
    }

	/* =========================================================
	 * 4) GreenFinder 세션 스니핑
	 * - 세부용도/용도 후보 키를 넓게 스캔하여 useName/buildingType2 보강
	 * ========================================================= */
	function sniffSessionForBuilding() {
		try {
			const get = (k) => (sessionStorage.getItem(k) || '').toString().trim();

			const ldCodeNm     = get('ldCodeNm');
			const mnnmSlno     = get('mnnmSlno');
			const pnu          = get('pnu');
			const latStr       = get('lat');
			const lonRaw       = get('lon') || get('lng');
			const buildingName = get('buildingName') || get('buldNm') || '';

			const useConfmDe   = get('useConfmDe');
			const builtYearRaw = get('builtYear');
			const builtYear = (() => {
				if (/^\d{4}$/.test(builtYearRaw)) return builtYearRaw;
				if (/^\d{4}/.test(useConfmDe)) return useConfmDe.slice(0, 4);
				return '';
			})();

			const jibunAddr = (ldCodeNm && mnnmSlno) ? `${ldCodeNm} ${mnnmSlno}` : '';

			const latNum = Number(latStr);
			const lonNum = Number(lonRaw);

			// 세부용도 후보 키
			const useCandidates = [
				get('detailUse'), get('세부용도'), get('useName'), get('use'),
				get('mainPrpos'), get('bldgPrpos'), get('bldgUse')
			].filter(Boolean);
			const useName = useCandidates[0] || '';
			const buildingType2 = useName || '';

			const o = {
				pnu: pnu || undefined,
				jibunAddr: jibunAddr || undefined,
				lat: Number.isFinite(latNum) ? latNum : undefined,
				lon: Number.isFinite(lonNum) ? lonNum : undefined,
				buildingName: buildingName || undefined,

				builtYear: builtYear || undefined,
				useConfmDe: useConfmDe || undefined,

				useName: useName || undefined,
				buildingType2: buildingType2 || undefined,

				from: String(NOW_YEAR),
				to: String(NOW_YEAR + HORIZON_YEARS)
			};

			const __ok = Object.values(o).some(v => v != null && String(v).trim() !== '');
			return __ok ? o : (SaveGreen.log?.info && SaveGreen.log.info('provider', 'session (GreenFinder) provided no usable seed → proxy(vworld) may be used'), null);
		} catch (e) {
			SaveGreen.log?.warn && SaveGreen.log.warn('provider', 'session sniff error', e);
			return null;
		}
	}

	/* =========================================================
	 * 5) 컨텍스트 보강(도로명/지번/건물명) — VWorld 프록시 사용
	 * ========================================================= */
	async function enrichContext(ctx) {
		const out = { ...ctx };
		try {
			if (!out.roadAddr && out.lon != null && out.lat != null) {
				const url = `/api/ext/vworld/revgeo?lat=${encodeURIComponent(out.lat)}&lon=${encodeURIComponent(out.lon)}`;
				const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
				if (r.ok) {
					const j = await r.json();
					out.roadAddr  = out.roadAddr  || j.roadAddr   || j.roadAddress   || j.road_name || j.road || '';
					out.jibunAddr = out.jibunAddr || j.jibunAddr  || j.parcelAddress || j.parcel    || j.jibun || '';
				}
			}

			if (!out.buildingName && out.pnu) {
				try {
					const r2 = await fetch(`/api/ext/vworld/parcel?pnu=${encodeURIComponent(out.pnu)}`, { headers: { 'Accept': 'application/json' } });
					if (r2.ok) {
						const j2 = await r2.json();
						out.buildingName = j2?.buldNm || j2?.buildingName || j2?.buld_name || out.buildingName;
					}
				} catch (e2) {
					SaveGreen.log?.warn && SaveGreen.log.warn('provider', 'buildingName fetch skipped', e2);
				}
			}
		} catch (e) {
			SaveGreen.log?.warn && SaveGreen.log.warn('provider', 'enrichContext failed (proxy/vworld unreachable or invalid response)', e);
		}
		return out;
	}

	/* =========================================================
	 * 6) DAE 설정 접근 유틸(dae.json)
	 * ========================================================= */
	(function () {
		window.SaveGreen = window.SaveGreen || {};
		window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};
		window.SaveGreen.Forecast.providers = window.SaveGreen.Forecast.providers || {};

		const DAE_CONFIG_URL = '/config/dae.json';
		let __daeConfigCache = null;

		async function loadDaeConfig() {
			if (__daeConfigCache) return __daeConfigCache;
			const rsp = await fetch(DAE_CONFIG_URL, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
			if (!rsp.ok) throw new Error('dae.json HTTP ' + rsp.status);
			__daeConfigCache = await rsp.json();
			return __daeConfigCache;
		}

		function getBaseAssumptions(dae, type) {
			if (!dae || !type) return null;
			const t = String(type).toLowerCase();
			return (dae?.types?.[t]?.base) || (dae?.base?.[t]) || null;
		}

		function getEuiRules(dae) {
			if (!dae || typeof dae !== 'object') return null;
			return dae.euiRules || dae.rules || null;
		}

		function getEuiRulesForType(dae, type) {
			if (!dae || typeof dae !== 'object') return null;
			const byType = dae.rulesByType && type ? dae.rulesByType[String(type).toLowerCase()] : null;
			return byType || getEuiRules(dae);
		}

		function getDefaults(dae) {
			return dae?.defaults || null;
		}

		// 외부 노출
		window.SaveGreen.Forecast.loadDaeConfig = loadDaeConfig;
		window.SaveGreen.Forecast.getBaseAssumptions = getBaseAssumptions;
		window.SaveGreen.Forecast.getEuiRules = getEuiRules;
		window.SaveGreen.Forecast.getDefaults = getDefaults;
		window.SaveGreen.Forecast.getEuiRulesForType = getEuiRulesForType;
	})();

	/* =========================================================
	 * 7) 컨텍스트 소스 우선순위 / 단일 진입점
	 * ========================================================= */
	function pickStrategy() {
		const pref = (storageGet('source') || 'auto').toLowerCase();
		if (pref === 'local')  return ['local', 'page', 'url', 'vworld'];
		if (pref === 'url')    return ['url', 'page', 'local', 'vworld'];
		if (pref === 'vworld') return ['vworld', 'page', 'local', 'url'];
		return ['page', 'local', 'url', 'vworld']; // auto
	}

	async function trySource(kind) {
		if (kind === 'page')   return readFromPage();
		if (kind === 'local')  return readFromLocal();
		if (kind === 'url')    return readFromUrl();
		if (kind === 'vworld') return fetchFromVWorldProxy();
		return null;
	}

	async function getBuildingContext() {
        // 캐시 빠른 반환(프리로드와 runForecast 동일 컨텍스트 보장)
        if (__CTX_CACHE) {
            try { return JSON.parse(JSON.stringify(__CTX_CACHE)); } catch { return { ...__CTX_CACHE }; }
        }

		const order = pickStrategy();
		SaveGreen.log?.info && SaveGreen.log.info('provider', `order = ${order.join(' → ')}`);
		const __tried = [];

		for (const s of order) {
			try {
				const v = await trySource(s);
				if (isValid(v)) {
					const ctx = normalize(v);
					__tried.push({ source: s, ok: true });
					SaveGreen.log?.info && SaveGreen.log.info('provider', `hit = ${s}`);
					if (s === 'vworld') {
						const prev = __tried.filter(t => t.source !== 'vworld').map(t => t.source).join(', ');
						SaveGreen.log?.info && SaveGreen.log.info('provider', `fallback via proxy (VWorld). previous sources empty/invalid : ${prev || 'n/a'}`);
					}


					// 카탈로그 주입 → 타입 재확정(이미 있으면 보존)
                    await attachCatalog(ctx);
                    const retype = pickTypeFromContext(ctx, true);
                    if (!ctx.type || ctx.type === 'unknown') {
                        // 카탈로그/휴리스틱 결과로만 채움(임의 폴백 금지)
                        ctx.type = retype;
                    }
                    ctx.mappedType = ctx.type;

                    // 컨텍스트 캐시 저장
                    __CTX_CACHE = { ...ctx };
					return ctx;
				}
				__tried.push({ source: s, ok: false });
				SaveGreen.log?.debug && SaveGreen.log.debug('provider', `${s} → empty/invalid`);
			} catch (e) {
				__tried.push({ source: s, ok: false, err: true });
				SaveGreen.log?.warn && SaveGreen.log.warn('provider', `${s} failed`, e);
			}
		}
		throw new Error('No context source available (page/local/url/vworld)');
	}

	/* =========================================================
	 * 8) 각 소스 구현 (page/local/url/vworld)
	 * ========================================================= */
	function readFromPage() {
		const root = document.getElementById('forecast-root');
		if (!root) return null;

		const o = {
			buildingId: nvPos(root.dataset.bid) ?? parseIdFromForecastPath(),
			builtYear:  nvPos(root.dataset.builtYear),
			useName:    sv(root.dataset.use),
			floorArea:  nv(root.dataset.floorArea),
			area:       nv(root.dataset.area),
			pnu:        sv(root.dataset.pnu),
			from:       sv(root.dataset.from) || String(NOW_YEAR),
			to:         sv(root.dataset.to)   || String(NOW_YEAR + HORIZON_YEARS),
			lat:        nv(root.dataset.lat),
			lon:        nv(root.dataset.lon),
			buildingName: sv(root.dataset.buildingName) || sv(root.dataset.bname),
			roadAddr:     sv(root.dataset.roadAddr),
			jibunAddr:    sv(root.dataset.jibunAddr)
		};
		return hasAny(o) ? o : null;
	}

	function readFromLocal() {
		const a = readFromLocalStorage() || {};
		const b = sniffSessionForBuilding() || {};
		const merged = { ...b, ...a };

		if (!merged.from) merged.from = String(NOW_YEAR);
		if (!merged.to)   merged.to   = String(NOW_YEAR + HORIZON_YEARS);

		return Object.values(merged).some(v => v != null && String(v).trim() !== '')
			? merged
			: null;
	}

	function readFromLocalStorage() {
		const raw = storageGet('forecast.ctx');
		if (!raw) return null;
		try {
			const o = JSON.parse(raw);
			if (o && Number(o.builtYear) === 0) delete o.builtYear;
			return hasAny(o) ? o : null;
		} catch (e) {
			SaveGreen.log?.warn && SaveGreen.log.warn('provider', 'forecast.ctx JSON parse error', e);
			return null;
		}
	}

	function readFromUrl() {
		try {
			const urlp = new URLSearchParams(location.search);
			const o = {
				pnu:        sv(urlp.get('pnu')),
				builtYear:  nvPos(urlp.get('builtYear')),
				useName:    sv(urlp.get('useName') || urlp.get('use')),
				floorArea:  nv(urlp.get('floorArea') || urlp.get('area')),
				area:       nv(urlp.get('area')),
				from:       sv(urlp.get('from')) || String(NOW_YEAR),
				to:         sv(urlp.get('to'))   || String(NOW_YEAR + HORIZON_YEARS),
				lat:        nv(urlp.get('lat')),
				lon:        nv(urlp.get('lon') || urlp.get('lng')),
				buildingName: sv(urlp.get('buildingName') || urlp.get('bname')),
				roadAddr:     sv(urlp.get('roadAddr') || urlp.get('roadAddress')),
				jibunAddr:    sv(urlp.get('jibunAddr') || urlp.get('parcelAddress'))
			};
			return hasAny(o) ? o : null;
		} catch (e) {
			SaveGreen.log?.warn && SaveGreen.log.warn('provider', 'readFromUrl failed', e);
			return null;
		}
	}

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

		SaveGreen.log?.debug && SaveGreen.log.debug('provider', `vworld GET ${url}`);
		const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
		if (!res.ok) {
			SaveGreen.log?.warn && SaveGreen.log.warn('provider', `proxy(vworld) HTTP ${res.status} — seed:`, { pnu: !!pnu, lat: !!lat, lon: !!lon });
			throw new Error(`VWorld ${res.status}`);
		}

		const v = await res.json();

		// 서버가 내려준 run_id를 세션/전역에 저장(존재 시)
		try {
			const rid =
				(v && (v.run_id || v.runId)) ||
				(v && v.tags && v.tags.run_id) ||
				(v && v.payload && v.payload.run_id) ||
				null;
			if (rid && window.SaveGreen?.MLLogs?.setRunId) {
				window.SaveGreen.MLLogs.setRunId(rid);
				console.debug('[logs] train runId =', rid);
			} else {
				console.warn('[logs] train response without run_id', v);
			}
		} catch (e) {
			console.warn('[logs] train setRunId failed:', e);
		}

		const out = { ...seed, ...v };
		try {
			SaveGreen.log?.info && SaveGreen.log.info('provider', 'proxy(vworld) success', {
				seed: { pnu: !!pnu, lat: !!lat, lon: !!lon },
				filled: {
					buildingName: !!(out.buldNm || out.buildingName),
					roadAddr: !!(out.roadAddr || out.roadAddress),
					jibunAddr: !!(out.jibunAddr || out.parcelAddress)
				}
			});
		} catch {}
		return out;
	}

	/* =========================================================
	 * 9) 정합성 검사/정규화/타입 확정
	 * ========================================================= */
	function isValid(v) {
		if (!v) return false;
		const hasFT = nonEmpty(v.from) && nonEmpty(v.to);
		const hasKey =
			(nvPos(v.builtYear) !== undefined) ||
			(nvPos(v.buildingId) !== undefined) ||
			nonEmpty(v.pnu) ||
			(isFiniteNum(v.lat) && isFiniteNum(v.lon));
		return !!(hasFT && hasKey);
	}

	// 우선순위: preset(type|mappedType) → buildingType2 → useName → buildingType1 → 건물명/주소
	function pickTypeFromContext(ctx, quiet = true) {
		const preset = String(ctx?.type || ctx?.mappedType || '').toLowerCase();
		if (preset && ['factory','school','hospital','office'].includes(preset)) return preset;

		const t2  = (ctx.buildingType2 || '').toString().trim();
		const t1  = (ctx.buildingType1 || '').toString().trim();
		const use = (ctx.useName       || '').toString().trim();

		let core = findCoreTypeByIncludes(t2) || findCoreTypeByIncludes(use) || findCoreTypeByIncludes(t1);
		if (core) return core;

		const name = (ctx.buildingName || '').toString();
		const addr = (ctx.roadAddr || ctx.jibunAddr || '').toString();
		core = findCoreTypeByIncludes(`${name} ${addr}`);
		if (core) return core;

		if (!quiet && window.SaveGreen?.log?.kv) {
			window.SaveGreen.log.kv('type', 'mapping miss', { t1, t2, use, name, addr });
		}
		return 'unknown';
	}

	function normalize(v) {
		const by = nvPos(v.builtYear);
		const useName = v.useName ?? v.use_name ?? undefined;
		const out = {
			buildingId: nvPos(v.buildingId),
			builtYear:  by,
			useName:    useName,
			// buildingType1/2 보존(타입 확정용)
			buildingType1: sv(v.buildingType1),
			buildingType2: sv(v.buildingType2),

			floorArea:  nv(v.floorArea) ?? nv(v.area),
			area:       nv(v.area),
			pnu:        sv(v.pnu),
			from:       String(v.from ?? NOW_YEAR),
			to:         String(v.to   ?? (NOW_YEAR + HORIZON_YEARS)),
			lat:        isFiniteNum(v.lat) ? Number(v.lat) : undefined,
			lon:        isFiniteNum(v.lon) ? Number(v.lon) : undefined,
			buildingName: sv(v.buildingName),
			roadAddr:     sv(v.roadAddr),
			jibunAddr:    sv(v.jibunAddr)
		};

		// core type 확정(명시 목적, unknown 허용)
		out.type = pickTypeFromContext(out, true);   // factory|school|hospital|office|unknown
		out.mappedType = out.type;
		return out;
	}

	/* =========================================================
	 * 10) 미세 유틸
	 * ========================================================= */
	function nv(x) {
		if (x == null) return undefined;
		const s = String(x).trim();
		if (s === '') return undefined;
		const n = Number(s);
		return Number.isFinite(n) ? n : undefined;
	}

	function nvPos(x) {
		const n = nv(x);
		if (!Number.isFinite(n)) return undefined;
		if (n <= 0) return undefined;
		return Math.round(n);
	}

	function sv(x) {
		if (x == null) return undefined;
		const s = String(x).trim();
		return s === '' ? undefined : s;
	}

	function nonEmpty(x) {
		return x != null && String(x).trim() !== '';
	}

	function hasAny(o) {
		return !!o && Object.values(o).some(v => v != null && String(v).trim() !== '');
	}

	function isFiniteNum(x) {
		return Number.isFinite(Number(x));
	}

	function parseIdFromForecastPath() {
		try {
			const m = String(location.pathname || '').match(/\/forecast\/(\d+)/);
			return m ? Number(m[1]) : undefined;
		} catch { return undefined; }
	}

	/* =========================================================
	 * 11) 외부 노출
	 * ========================================================= */
	global.getBuildingContext = getBuildingContext;
	if (typeof window !== 'undefined') {
		window.SG = window.SG || {};
		window.SG.providers = { getBuildingContext };
	}
	if (typeof exports === 'object' && typeof module !== 'undefined') {
		module.exports = { getBuildingContext };
	}
})(window);
