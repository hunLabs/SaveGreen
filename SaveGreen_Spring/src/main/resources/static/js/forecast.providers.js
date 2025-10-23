/* =========================================================
 * forecast.providers.js (FINAL)
 * - 단일 진입점: getBuildingContext()
 * - 소스 우선순위: page → localStorage/sessionStorage → url → vworld  (auto 기준)
 * - builtYear=0 은 유효값으로 취급하지 않음 (양수만 허용)
 * ========================================================= */

;(function (global) {
    'use strict';

    /* ---------- 상수 ---------- */
    const NOW_YEAR = new Date().getFullYear();
    const HORIZON_YEARS = 10;

    /* ---------- 공용 스토리지 헬퍼 (세션 우선, 로컬 폴백) ---------- */
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

            const o = {
                pnu: pnu || undefined,
                jibunAddr: jibunAddr || undefined,
                lat: Number.isFinite(latNum) ? latNum : undefined,
                lon: Number.isFinite(lonNum) ? lonNum : undefined,
                buildingName: buildingName || undefined,

                builtYear: builtYear || undefined,
                useConfmDe: useConfmDe || undefined,

                from: String(NOW_YEAR),
                to: String(NOW_YEAR + HORIZON_YEARS)
            };

            const __ok = Object.values(o).some(v => v != null && String(v).trim() !== '');
            return __ok ? o : (SaveGreen.log.info('provider', 'session (GreenFinder) provided no usable seed → proxy(vworld) may be used'), null);
        } catch (e) {
            SaveGreen.log.warn('provider', 'session sniff error', e);
            return null;
        }
    }

    /* ---------- 컨텍스트 보강(도로명/지번/건물명) ---------- */
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
                    SaveGreen.log.warn('provider', 'buildingName fetch skipped', e2);
                }
            }
        } catch (e) {
            SaveGreen.log.warn('provider', 'enrichContext failed (proxy/vworld unreachable or invalid response)', e);
        }
        return out;
    }

    /* ---------- 타입 매핑/dae.json 접근 유틸 ---------- */
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

    /* ---------- 소스 우선순위 결정 ---------- */
    function pickStrategy() {
        const pref = (storageGet('source') || 'auto').toLowerCase();
        if (pref === 'local')  return ['local', 'page', 'url', 'vworld'];
        if (pref === 'url')    return ['url', 'page', 'local', 'vworld'];
        if (pref === 'vworld') return ['vworld', 'page', 'local', 'url'];
        return ['page', 'local', 'url', 'vworld']; // auto
    }

    /* ---------- 소스 시도기 ---------- */
    async function trySource(kind) {
        if (kind === 'page')   return readFromPage();
        if (kind === 'local')  return readFromLocal();
        if (kind === 'url')    return readFromUrl();
        if (kind === 'vworld') return fetchFromVWorldProxy();
        return null;
    }

    /* ---------- 단일 진입점 ---------- */
    async function getBuildingContext() {
        const order = pickStrategy();
        SaveGreen.log.info('provider', `order = ${order.join(' → ')}`);
        const __tried = [];

        for (const s of order) {
            try {
                const v = await trySource(s);
                if (isValid(v)) {
                    const ctx = normalize(v);
                    __tried.push({ source: s, ok: true });
                    SaveGreen.log.info('provider', `hit = ${s}`);
                    if (s === 'vworld') {
                        const prev = __tried.filter(t => t.source !== 'vworld').map(t => t.source).join(', ');
                        SaveGreen.log.info('provider', `fallback via proxy (VWorld). previous sources empty/invalid : ${prev || 'n/a'}`);
                    }
                    return ctx;
                }
                __tried.push({ source: s, ok: false });
                SaveGreen.log.debug('provider', `${s} → empty/invalid`);
            } catch (e) {
                __tried.push({ source: s, ok: false, err: true });
                SaveGreen.log.warn('provider', `${s} failed`, e);
            }
        }
        throw new Error('No context source available (page/local/url/vworld)');
    }

    /* ---------- readFromPage (서버 템플릿 data-*) ---------- */
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

    /* ---------- readFromLocal (forecast.ctx + 세션 병합) ---------- */
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
            SaveGreen.log.warn('provider', 'forecast.ctx JSON parse error', e);
            return null;
        }
    }

    /* ---------- readFromUrl (qs) ---------- */
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
            SaveGreen.log.warn('provider', 'readFromUrl failed', e);
            return null;
        }
    }

    /* ---------- vworld 프록시 ---------- */
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

        SaveGreen.log.debug('provider', `vworld GET ${url}`);
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
            SaveGreen.log.warn('provider', `proxy(vworld) HTTP ${res.status} — seed:`, { pnu: !!pnu, lat: !!lat, lon: !!lon });
            throw new Error(`VWorld ${res.status}`);
        }

        const v = await res.json();

        // ★ [SG-LOGS] 서버가 내려준 run_id를 세션/전역에 저장(하드코딩 없음)
        try {
            const rid =
                (js && (js.run_id || js.runId)) ||
                (js && js.tags && js.tags.run_id) ||
                (js && js.payload && js.payload.run_id) ||
                null;
            if (rid) {
                window.SaveGreen.MLLogs.setRunId(rid);   // ← 전역+세션 저장
                console.debug('[logs] train runId =', rid);
            } else {
                console.warn('[logs] train response without run_id', js);
            }
        } catch (e) {
            console.warn('[logs] train setRunId failed:', e);
        }


        const out = { ...seed, ...v };
        try {
            SaveGreen.log.info('provider', 'proxy(vworld) success', {
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

    /* ---------- 정합성 검사/정규화 ---------- */
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

    function normalize(v) {
        const by = nvPos(v.builtYear);

        // 1) 그대로 전달 (추론/보정 없음)
        const useName = v.useName ?? v.use_name ?? undefined;

        return {
            buildingId: nvPos(v.buildingId),
            builtYear:  by,
            useName:    useName,
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
    }


    // -------------------------------------------------------
    // ml_dataset.json 기반 카달로그 선택 → ML에 필요한 필드 정규화
    // -------------------------------------------------------
    (function () {
        function mapMlType(name = '') {
            const s = String(name).trim();
            if (s.includes('공장') || s.includes('제조')) return 'factory';
            if (s.includes('창고')) return 'warehouse';
            if (s.includes('사무') || s.includes('오피스')) return 'office';
            if (s.includes('병원') || s.includes('의료')) return 'hospital';
            if (s.includes('학교') || s.includes('교육')) return 'school';
            return 'factory';
        }

        function toRegionRaw(address) {
            if (!address) return '대전';
            const parts = String(address).trim().split(/\s+/);
            const city = (parts[0] || '').replace('광역시','').replace('특별시','');
            return [city || '대전', parts[1] || ''].filter(Boolean).join(' ');
            }

        function applyCatalogToContext(item, ctx) {
            if (!item || !ctx) return ctx;

            ctx.buildingName = item.buildingName || ctx.buildingName || '';
            ctx.roadAddr     = item.address     || ctx.roadAddr     || '';
            ctx.jibunAddr    = ctx.jibunAddr || '';
            ctx.pnu          = item.pnu || ctx.pnu;

            const area = Number(item.floorAreaM2);
            if (Number.isFinite(area) && area > 0) ctx.floorAreaM2 = area;

            const by = Number(item.usageYear);
            if (Number.isFinite(by) && by > 0) ctx.builtYear = by;

            ctx.yearlyConsumption  = Array.isArray(item.yearlyConsumption)  ? item.yearlyConsumption  : (ctx.yearlyConsumption  || []);
            ctx.monthlyConsumption = Array.isArray(item.monthlyConsumption) ? item.monthlyConsumption : (ctx.monthlyConsumption || []);

            const useName = item.buildingType2 || item.buildingType1 || ctx.useName || '공장';
            ctx.useName    = useName;
            ctx.typeRaw    = useName;
            ctx.mappedType = mapMlType(useName);

            ctx.regionRaw  = toRegionRaw(item.address || ctx.address);

            const areaFromRec = Number(item?.floorAreaM2 ?? item?.floorArea ?? item?.area);
            if (!Number.isFinite(Number(ctx.floorAreaM2)) && Number.isFinite(areaFromRec) && areaFromRec > 0) {
                ctx.floorAreaM2 = areaFromRec;
            }

            ctx.catalogItem = item;
            return ctx;
        }

        window.SaveGreen = window.SaveGreen || {};
        window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};
        window.SaveGreen.Forecast.providers = window.SaveGreen.Forecast.providers || {};
        window.SaveGreen.Forecast.providers.applyCatalogToContext = applyCatalogToContext;
    })();

    /* ---- 미세 유틸 ---- */
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

    /* ---------- 외부 노출 ---------- */
    global.getBuildingContext = getBuildingContext;
    if (typeof window !== 'undefined') {
        window.SG = window.SG || {};
        window.SG.providers = { getBuildingContext };
    }
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = { getBuildingContext };
    }
})(window);
