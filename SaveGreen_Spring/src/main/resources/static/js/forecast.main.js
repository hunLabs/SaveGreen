/* =========================
 * forecast.main.js (FINAL)
 * =========================
 *
 * 개요(단계):
 * 1) 헤더 오프셋 자동계산
 * 2) 프리로드 패널(건물 컨텍스트/예측 가정/리스크) 렌더
 * 3) 초기화(init): 스토리지→dataset 부트스트랩, 세션→dataset 보강, QS 반영, VWorld(enrich) 보강
 * 4) 시작 버튼(있으면) 결선 → runForecast() 실행(없으면 자동)
 * 5) runForecast(): 컨텍스트 수집→dae.json 가정 주입→카탈로그 힌트→예측데이터 로드
 * 6) KPI/등급 산정(EUI 룰 우선, 폴백 포함) → 배너/요약/차트
 * 7) 유틸(수 포맷, 눈금 헬퍼 등)
 */

/* ───────────────────────────────────────────────────────────
 * 전역 상수/네임스페이스/헬퍼
 * ─────────────────────────────────────────────────────────── */

// 전역 카탈로그 경로 (정적 리소스 기준)
// - 에너지 카탈로그(샘플/더미) JSON을 한 번만 내려받아 세션 캐시에 보관
const CATALOG_URL = '/dummy/buildingenergydata.json';

window.SaveGreen = window.SaveGreen || {};
window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

// JS 켜짐 표시(헤더 스페이서 CSS 토글용)
document.documentElement.classList.add('js');

/* =========================================================
 * SaveGreen Logger (lightweight)
 * - window.SaveGreen.log 로 노출
 * - 레벨: 'silent' < 'error' < 'warn' < 'info' < 'debug'
 * - 태그 필터: log.enableTags('provider','catalog') 등
 * - 타임스탬프: KST(Asia/Seoul)
 * - 컬러: 태그별 색상
 * ========================================================= */
(function () {
	'use strict';
	window.SaveGreen = window.SaveGreen || {};
	const LEVELS = { silent:0, error:1, warn:2, info:3, debug:4 };
	let level = LEVELS.info;
	let allowTags = null; // null=전체 허용, Set[...]이면 해당 태그만

	function setLevel(lv){ level = LEVELS[lv] ?? level; }
	function enableTags(){ allowTags = new Set([].slice.call(arguments)); }
	function clearTags(){ allowTags = null; }
	function _ok(lv, tag){
		if ((LEVELS[lv] ?? 0) > level) return false;
		if (!allowTags) return true;
		return allowTags.has(String(tag||'').toLowerCase());
	}
	// ▼ KST 타임스탬프 (HH:MM:SS)
	function _stamp(){
		try {
			return new Intl.DateTimeFormat('ko-KR',{
				timeZone:'Asia/Seoul', hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'
			}).format(new Date());
		} catch { return ''; }
	}
	// ▼ 태그별 색상 팔레트
	const TAG_STYLE = {
		provider: 'color:#8bc34a;font-weight:600',  // 연두
		main:     'color:#03a9f4;font-weight:600',  // 하늘
		catalog:  'color:#ff9800;font-weight:600',  // 주황
		chart:    'color:#9c27b0;font-weight:600',  // 보라
		kpi:      'color:#f44336;font-weight:600',  // 빨강
		default:  'color:#9e9e9e;font-weight:600'   // 회색
	};
	function _sty(tag){ return TAG_STYLE[String(tag||'').toLowerCase()] || TAG_STYLE.default; }

	// ─ ctx()가 한 줄이 아니라 '키: 값' 줄바꿈 블록으로 출력되도록 변경
    // - LABELS 표의 순서대로 출력하고, 값이 없는 항목은 건너뜀
    // - 마지막에 개행을 붙여 가독성을 높임
    const LABELS = [
    	['pnu','PNU'],
    	['builtYear','사용연도'],
    	['buildingId','BuildingId'],
    	['useName','용도'],
    	['floorArea','연면적㎡'],
    	['area','면적㎡'],
    	['roadAddr','도로명'],
    	['jibunAddr','지번'],
    	['lat','lat'],
    	['lon','lon'],
    	['from','from'],
    	['to','to']
    ];

    // ▽ 객체를 '키 : 값' 들의 여러 줄 문자열로 변환
    function _fmtCtx(o){
    	if (!o || typeof o !== 'object') return String(o ?? '');
    	const lines = [];
    	for (const [k,label] of LABELS){
    		let v = o[k];
    		if (v == null || String(v).trim() === '') continue;
    		if ((k === 'floorArea' || k === 'area') && Number.isFinite(Number(v))) {
    			v = new Intl.NumberFormat('ko-KR').format(Number(v));
    		}
    		lines.push(`${label} : ${v}`);
    	}
    	return lines.join('\n');
    }

    // ▽ 실제 출력: 라벨 헤더 + 줄바꿈 + '키 : 값' 블록
    function ctx(label, obj, tag){
    	if(!_ok('info',tag)) return;
    	const block = _fmtCtx(obj);
    	console.info(`%c[${_stamp()}][${label}]%c\n${block}\n`, _sty(tag), 'color:inherit');
    }

    // [추가] 어떤 객체든 '키 : 값' 형식의 멀티라인으로 출력하는 유틸
    // - title: 이 블록의 제목(예: 'base', 'kpi snapshot')
    // - obj  : 출력할 객체
    // - order: 출력 순서 배열(지정 없으면 Object.keys 순)
    function kv(tag, title, obj, order) {
        if(!_ok('info', tag)) return;
        const o = obj || {};
        const keys = (Array.isArray(order) && order.length) ? order : Object.keys(o);
        const lines = [];
        for (const k of keys) {
            if (!(k in o)) continue;
            let v = o[k];
            if (v == null) continue;
            // 숫자는 한국어 포맷 적용(금액·면적 같은 값 가독성 ↑)
            if (typeof v === 'number' && Number.isFinite(v)) {
                try { v = new Intl.NumberFormat('ko-KR').format(v); } catch {}
            }
            lines.push(`${k} : ${v}`);
        }
        // 라벨/태그 헤더 + 줄바꿈 + '키 : 값' 블록
        console.info(`%c[${_stamp()}][${tag}]%c ${title}\n${lines.join('\n')}\n`, _sty(tag), 'color:inherit');
    }



	// [수정] ...rest 스프레드로 구조 페이로드를 정상 출력
	function debug(){ const [tag,msg,...rest]=arguments; if(_ok('debug',tag)) console.debug(`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest); }
	function info (){ const [tag,msg,...rest]=arguments; if(_ok('info' ,tag)) console.info (`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest); }
	function warn (){ const [tag,msg,...rest]=arguments; if(_ok('warn' ,tag)) console.warn (`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest); }
	function error(){ const [tag,msg,...rest]=arguments; if(_ok('error',tag)) console.error(`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest); }

	// kv는 위에서 이미 정의돼 있음(멀티라인 키:값 블록 출력)
    // export에 포함하지 않으면 SaveGreen.log.kv 호출 시 undefined 에러 발생
    window.SaveGreen.log = { setLevel, enableTags, clearTags, debug, info, warn, error, ctx, kv };

})();



// 전역 clamp 폴리필(없으면 등록)
if (typeof window.clamp !== 'function') window.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// DOM 헬퍼(이 파일 전용)
const $el  = (s, root=document) => root.querySelector(s);
const $$el = (s, root=document) => Array.from(root.querySelectorAll(s));

/* 예측 기간 상수 */
const NOW_YEAR = new Date().getFullYear();
const HORIZON_YEARS = 10;

/* 배너 텍스트 */
const BANNER_TEXTS = {
	recommend: '연식과 향후 비용 리스크를 고려할 때, 리모델링을 권장합니다.',
	conditional: '일부 항목은 적정하나, 향후 효율과 수익성 검토가 필요합니다.',
	'not-recommend': '현재 조건에서 리모델링 효과가 제한적입니다.'
};



/* ==========================================================
 * 1) 헤더 오프셋 자동계산
 * ========================================================== */

/**
 * 화면 상단을 겹치는 모든 바(헤더/네비 등)의 "실제 표시 높이"를 합산해서
 * CSS 변수 --header-height 에 반영하고, 본문(.wrap) 시작 패딩을 조정.
 * - 대상: #menubar, nav.navbar
 * - 겹침 기준: position:fixed 또는 sticky && rect.top <= 0
 */
function applyHeaderOffset() {
	const menubar = document.getElementById('menubar');
	const navbar	= document.querySelector('nav.navbar');
	const spacer	= document.querySelector('.header-spacer');
	const wrap		= document.querySelector('main.wrap');
	if (!wrap) return;

	const rootCS = getComputedStyle(document.documentElement);
	const extra	= parseInt(rootCS.getPropertyValue('--header-extra-gap')) || 16;

	const getBarH = (el) => {
		if (!el) return 0;
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
		const rect = el.getBoundingClientRect();
		const isFixed = cs.position === 'fixed';
		const isStickyNow = cs.position === 'sticky' && rect.top <= 0;
		return (isFixed || isStickyNow) ? Math.round(rect.height) : 0;
	};

	const baseH = getBarH(menubar) + getBarH(navbar);

	document.documentElement.style.setProperty('--header-height', baseH + 'px');

	const topPad = (baseH + extra) + 'px';
	wrap.style.paddingTop = topPad;

	// JS on이면 스페이서 숨김
	if (document.documentElement.classList.contains('js') && spacer) {
		spacer.style.display = 'none';
		spacer.style.height	 = '0px';
		spacer.style.padding = '0';
		spacer.style.margin	 = '0';
		spacer.style.border	 = '0';
	} else if (spacer) {
		spacer.style.display = 'block';
		spacer.style.height	 = topPad;
	}
}

/** 헤더 오프셋 초기화/바인딩 */
function initHeaderOffset() {
	applyHeaderOffset();

	let ticking = false;
	const request = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => { applyHeaderOffset(); ticking = false; });
	};

	window.addEventListener('resize', request);
	window.addEventListener('orientationchange', request);
	window.addEventListener('scroll', request, { passive: true });

	const wrap = document.querySelector('main.wrap');
	if (wrap) wrap.addEventListener('scroll', request, { passive: true });

	const menubar = document.getElementById('menubar');
	const navbar  = document.querySelector('nav.navbar');
	if (window.ResizeObserver) {
		const ro = new ResizeObserver(request);
		if (menubar) ro.observe(menubar);
		if (navbar)  ro.observe(navbar);
	}
}



/* ==========================================================
 * 2) 프리로드 패널(컨텍스트/가정/리스크) 렌더
 * ========================================================== */

/**
 * 상태 패널 텍스트 및 페이지 상태 클래스 토글
 * state: idle / running / complete
 */
function setPreloadState(state) {
	document.body.classList.remove('is-idle','is-running','is-complete');
	document.body.classList.add(`is-${state}`);
	const el = document.getElementById('preload-status');
	if (!el) return;
	const MAP = {
		idle: '대기 중 · 시작 버튼을 눌러 예측을 시작하세요',
		running: '연산 중… 잠시만 기다려주세요.',
		complete: '완료'
	};
	el.textContent = MAP[state] || '';
}

/**
 * 프리로드 정보 패널:
 * ① 건물 컨텍스트(명/주소/용도…) ② 예측 가정(1·2줄) ③ 리스크 배지
 */
function renderPreloadInfoAndRisks() {
	const root = document.getElementById('forecast-root');
	if (!root) return;
	const ds   = root.dataset || {};
	const ls   = (k) => localStorage.getItem('forecast.' + k) || '';
	const pick = (k) => (ds[k] || ls(k) || '').toString().trim();
	const numOk = (v) => v !== '' && !isNaN(parseFloat(v));

	/* ① 건물 컨텍스트 카드 */
	const bmap = {
		buildingName: pick('buildingName') || ds.bname || '',
		roadAddr:     pick('roadAddr') || pick('jibunAddr') || '',
		useName:      pick('use') || pick('useName') || '',
		builtYear:    pick('builtYear') || '',
		floorArea:    pick('area') || pick('floorArea') || '',
		pnu:          '' // 사용자 혼란 방지로 비노출
	};

	const box = document.getElementById('preload-building');
	if (box) {
		box.querySelectorAll('li[data-k]').forEach((li) => {
			const key = li.getAttribute('data-k');
			let val = bmap[key] || '';
			if (key === 'floorArea' && val) {
				const n = Number(String(val).replace(/,/g, ''));
				if (!isNaN(n)) val = n.toLocaleString('ko-KR') + ' ㎡';
			}
			if (!val) {
				li.style.display = 'none';
			} else {
				const vEl = li.querySelector('.v');
				if (vEl) vEl.textContent = val;
				li.style.display = '';
			}
		});
	}

    /* 우측 예측 가정(KV) — 데이터셋/기본값 기반 선 채움 */
    {
        const root = document.getElementById('forecast-root') || {};
        const ds   = root.dataset || {};
        const numOk = (v) => v !== '' && !isNaN(parseFloat(v));

        // 단가 표시: dataset.unitPrice 있으면 사용, 없으면 '기본(가정)'
        const unit = ds.unitPrice;
        const tariffText = (unit && numOk(unit)) ? `${nf(unit)} 원/kWh (가정)` : '기본(가정)';

        // 계산 기준: (초기 렌더 시 ctx 없음) → 전역 보관 룰만 참조
        let basisText = 'EUI 기준 산출';
        try {
            const rules = window.SaveGreen?.Forecast?._euiRules || null;
            if (rules?.mode === 'primary') basisText = '1차에너지 기준 산출';
        } catch {}

        const t = $el('#assump-tariff'); if (t) t.textContent = tariffText;
        const bEl = $el('#assump-basis'); if (bEl) bEl.textContent = basisText;
    }



	/* ② 예측 가정(1줄: 단가/상승률/할인율) */
	{
		const unit        = pick('unitPrice') || '기본';
		const escalatePct = pick('tariffEscalationPct');
		const discountPct = pick('discountRatePct');
		const unitText = (unit === '기본') ? '기본(가정)' : `${unit}원/kWh`;
		const parts = [`전력단가 : ${unitText}`];
		if (numOk(escalatePct)) parts.push(`상승률 : ${parseFloat(escalatePct)}%/년`);
		if (numOk(discountPct)) parts.push(`할인율 : ${parseFloat(discountPct)}%/년`);
		const line1 = parts.join(' · ');
		const el1 = document.getElementById('assumption-line-1');
		if (el1) { el1.textContent = line1; el1.style.display = line1 ? '' : 'none'; }
	}

	/* ② 예측 가정(2줄: 배출계수/효율개선 또는 요금제/가동률) */
	{
		const co2Factor   = pick('co2Factor');
		const effGainPct  = pick('efficiencyGainPct');
		const tariffType  = pick('tariffType');
		const utilPct     = pick('utilizationPct');

		let parts2 = [];
		if (co2Factor || effGainPct) {
			if (co2Factor) parts2.push(`배출계수 : ${co2Factor} kgCO₂/kWh`);
			if (numOk(effGainPct)) parts2.push(`효율 개선 : ${parseFloat(effGainPct)}%`);
		} else if (tariffType || numOk(utilPct)) {
			if (tariffType) parts2.push(`요금제 : ${tariffType}`);
			if (numOk(utilPct)) parts2.push(`가동률 : ${parseFloat(utilPct)}%`);
		}
		const line2 = parts2.join(' · ');
		const el2 = document.getElementById('assumption-line-2');
		if (el2) { el2.textContent = line2; el2.style.display = line2 ? '' : 'none'; }
	}

	/* ③ 리스크 배지(노후/소면적/용도 미지정) */
	{
		const wrap = document.getElementById('risk-badges');
		if (wrap) {
			wrap.innerHTML = '';
			const badges = [];
			const nowY = NOW_YEAR;

			const by = parseInt(pick('builtYear'), 10);
			if (Number.isFinite(by) && nowY - by >= 20) badges.push({ t: '노후 리스크 ↑', c: 'warn' });

			const area = parseFloat(pick('area') || pick('floorArea'));
			if (Number.isFinite(area) && area > 0 && area < 500) badges.push({ t: '표본 작음', c: 'muted' });

			const useName = pick('use') || pick('useName');
			if (!useName) badges.push({ t: '용도 미지정', c: 'info' });

			badges.slice(0, 3).forEach(b => {
				const el = document.createElement('span');
				el.className = `badge ${b.c}`;
				el.textContent = b.t;
				wrap.appendChild(el);
			});
		}
	}

    // ---------------------------------------------------------
    // [추가] 필수 필드 미존재 시 경고 배지 + (추론) 라벨 보강
    //  - useName 없으면: 타입 추론 후 "(추론) type"으로 우측 카드/칩에 표기
    //  - floorArea/lat/lon 없으면: 좌측 카드 하단에 경고 배지 추가
    // ---------------------------------------------------------
    // [보강] useName 비면 '(추론) type'만 표시 — 경고 배지는 완전 제거
    (function () {
    	const root = document.getElementById('forecast-root');
    	const ds = (root?.dataset) || {};
    	const pick = (k) => (ds[k] || '').toString().trim();

    	if (!pick('use') && !pick('useName')) {
    		try {
    			const ctxLite = {
    				useName: undefined,
    				buildingName: pick('buildingName') || pick('bname'),
    				roadAddr: pick('roadAddr'),
    				jibunAddr: pick('jibunAddr')
    			};
    			const guessed = window.SaveGreen?.Forecast?.providers?.pickTypeFromContext?.(ctxLite);
    			if (guessed) {
    				const label = `(추론) ${guessed}`;
    				const el = document.querySelector('#preload-building .kv [data-field="useName"]');
    				if (el) el.textContent = label;
    			}
    		} catch {}
    	}

    	// 기존 경고 배지 생성/삽입/제거 로직은 전부 삭제됨
    })();
}

/** 가정 라인(1·2줄) 스타일링 보정 */
function styleAssumptionLines() {
    const root = document.getElementById('preload-assumption');
    if (!root) return;

    root.querySelectorAll('p, .mono').forEach((p) => {
        const raw = (p.textContent || "").trim();
        if (!raw) return;

        const parts = raw.split('·').map(s => s.trim()).filter(Boolean);
        const container = document.createElement('span');
        container.className = 'assump-line';

        parts.forEach((seg, i) => {
            const m = seg.split(':');
            if (m.length >= 2) {
                const kEl = document.createElement('span');
                kEl.className = 'k';
                kEl.textContent = m.shift().trim() + ':';

                const vEl = document.createElement('span');
                vEl.className = 'v';
                vEl.textContent = ' ' + m.join(':').trim();

                container.appendChild(kEl);
                container.appendChild(vEl);
            } else {
                container.appendChild(document.createTextNode(seg));
            }
            if (i < parts.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'sep';
                sep.textContent = ' · ';
                container.appendChild(sep);
            }
        });

        p.textContent = '';
        p.appendChild(container);
    });
}



/* ==========================================================
 * 3) 초기화(init): 스토리지/세션/쿼리스트링/VWorld 보강
 * ========================================================== */

async function init() {
    // init() 맨 처음에 추가
    document.getElementById('preload-warn-badges')?.remove();

	initHeaderOffset();

	const root = document.getElementById('forecast-root');

	// 3-1) localStorage → dataset 부트스트랩
	bootstrapContextFromStorage(root);

	// 3-2) 세션 → dataset 보충 (그린파인더 세션 값)
	{
		if (root) {
			const sget = (k) => (sessionStorage.getItem(k) || '').toString().trim();

			const ldCodeNm = sget('ldCodeNm');
			const mnnmSlno = sget('mnnmSlno');
			const lat      = sget('lat');
			const lon      = sget('lon');
			const pnu      = sget('pnu');
			const bname    = sget('buildingName') || sget('buldNm') || '';

			// builtYear: 세션 builtYear 우선, 없으면 useConfmDe 앞 4자리
			const builtYear = (() => {
				const by = (sessionStorage.getItem('builtYear') || '').trim();
				if (/^\d{4}$/.test(by)) return by;
				const u = (sessionStorage.getItem('useConfmDe') || '').trim();
				return (/^\d{4}/.test(u) ? u.slice(0, 4) : '');
			})();

			const jibun = [ldCodeNm, mnnmSlno].filter(Boolean).join(' ');

			const setIfEmpty = (key, val, fromKey) => {
                if (!root.dataset[key] && val) {
                    root.dataset[key] = val;
                    root.dataset[key + 'From'] = fromKey;
                }
            };

			setIfEmpty('jibunAddr', jibun, 'session');
			setIfEmpty('lat', lat, 'session');
			setIfEmpty('lon', lon, 'session');
			setIfEmpty('pnu', pnu, 'session');
			setIfEmpty('buildingName', bname, 'session');
			setIfEmpty('builtYear', builtYear, 'session');

			if (!root.dataset.addr && (root.dataset.roadAddr || root.dataset.jibunAddr)) {
				root.dataset.addr = root.dataset.roadAddr || root.dataset.jibunAddr;
				root.dataset.addrFrom = root.dataset.roadAddr ? 'dataset' : 'session';
			}
		}
	}

	// 3-3) 주소창 쿼리스트링 → dataset 보충(QS 우선)
	{
		const urlp = new URLSearchParams(location.search);
		if (root && !root.dataset.pnu && urlp.get('pnu')) {
			root.dataset.pnu = urlp.get('pnu');
			root.dataset.pnuFrom = 'qs';
		}
		if (root && !root.dataset.builtYear && urlp.get('builtYear')) {
			root.dataset.builtYear = urlp.get('builtYear');
			root.dataset.builtYearFrom = 'qs';
		}
		if (root && !root.dataset.from && urlp.get('from')) root.dataset.from = urlp.get('from');
		if (root && !root.dataset.to && urlp.get('to')) root.dataset.to = urlp.get('to');
	}

	// 3-4) VWorld(enrich)로 도로명/건물명 보강(가능 시, 비어있을 때만 채움)
	if (window.SaveGreen?.Forecast?.providers?.enrichContext && root) {
		const ds = root.dataset || {};
		const ctx0 = {
			from: ds.from,
			to: ds.to,
			pnu: ds.pnu,
			lat: ds.lat ? Number(ds.lat) : undefined,
			lon: ds.lon ? Number(ds.lon) : undefined,
			buildingName: ds.buildingName || ds.bname || '',
			roadAddr: ds.roadAddr || '',
			jibunAddr: ds.jibunAddr || ''
		};
		const enriched = await window.SaveGreen.Forecast.providers.enrichContext(ctx0);
		const setIfEmpty = (k, v) => { if (!root.dataset[k] && v) root.dataset[k] = String(v); };
		setIfEmpty('buildingName', enriched?.buildingName);
		setIfEmpty('roadAddr', enriched?.roadAddr);
		setIfEmpty('jibunAddr', enriched?.jibunAddr);
	}

	// 3-5) 페이지 상단의 빌딩 카드(컨텍스트 보조 정보), 프리로드 렌더
	renderBuildingCard();
	setPreloadState('idle');
	renderPreloadInfoAndRisks();

    // [추가] 시작 전에 세션→카탈로그 매칭을 미리 시도하고 로그 남김(있으면 히어로/칩도 하이드레이트)
    if (window.SaveGreen?.Forecast?.bindPreloadFromSessionAndCatalog) {
    	SaveGreen.log.info('provider', 'preload: try session → catalog bind');
    	try {
    		await window.SaveGreen.Forecast.bindPreloadFromSessionAndCatalog();
    		SaveGreen.log.info('provider', 'preload: session → catalog bind done');
    	} catch (e) {
    		SaveGreen.log.warn('provider', 'preload: session → catalog bind failed', e);
    	}
    }

	// [추가] 시작 전 프리로그: 페이지 dataset/세션/URL에서 씨드 요약을 한 번 찍는다.
    {
    	const root = document.getElementById('forecast-root');
    	const ds = root?.dataset || {};
    	const sget = (k) => (sessionStorage.getItem(k) || '').toString().trim();
    	const urlp = new URLSearchParams(location.search);
        const bi = window.BUILDING_INFO || {}; // 카드에 쓰이는 정보까지 보조소스에 포함

    	// 빈 문자열은 undefined로 반환 → kv 로그에서 자동 스킵
        const pick = (...arr) => {
        	for (const v of arr) {
        		if (v == null) continue;
        		const s = String(v).trim();
        		if (s !== '') return s;
        	}
        	return undefined;
        };

        const seeds = {
            buildingName: pick(ds.buildingName, ds.bname, bi.buildingName, bi.buldNm, sget('buildingName'), urlp.get('buildingName'), urlp.get('bname')),
            roadAddr:     pick(ds.roadAddr, bi.roadAddr, bi.roadAddress, urlp.get('roadAddr'), urlp.get('roadAddress')),
            jibunAddr:    pick(ds.jibunAddr, bi.jibunAddr, bi.parcelAddress, urlp.get('jibunAddr'), urlp.get('parcelAddress')),
            pnu:          pick(ds.pnu, bi.pnu, sget('pnu'), urlp.get('pnu')),
            builtYear:    pick(ds.builtYear, bi.builtYear, sget('builtYear'), urlp.get('builtYear')),
            useName:      pick(ds.use, ds.useName, bi.use, bi.useName, sget('useName'), urlp.get('useName'), urlp.get('use')),
            floorArea:    pick(ds.floorArea, ds.area, bi.floorArea, sget('floorArea'), urlp.get('floorArea'), urlp.get('area')),
            lat:          pick(ds.lat, bi.lat, sget('lat'), urlp.get('lat')),
            lon:          pick(ds.lon, bi.lon, sget('lon') || sget('lng'), urlp.get('lon') || urlp.get('lng')),
            from:         pick(ds.from, urlp.get('from')),
            to:           pick(ds.to, urlp.get('to'))
        };

        SaveGreen.log.kv('provider', 'preflight seeds (after bind)', seeds, [
            'buildingName','roadAddr','jibunAddr','pnu','builtYear','useName','floorArea','lat','lon','from','to'
        ]);
    }




	// 3-6) 시작 버튼 결선(없으면 자동 시작)
	wireStartButtonAndFallback();

	// 3-7) 메타 패널 기간 칩 초기화
	primeMetaRangeFromDataset();
}

/** localStorage → dataset 부트스트랩 */
function bootstrapContextFromStorage(rootEl) {
	if (!rootEl) return;

	const STORAGE_KEYS = {
		pnu: 'forecast.pnu',
		builtYear: 'forecast.builtYear',
		floorArea: 'forecast.floorArea',
		useName: 'forecast.useName',
		buildingName: 'forecast.buildingName',
		roadAddr: 'forecast.roadAddr',
		jibunAddr: 'forecast.jibunAddr',
		lat: 'forecast.lat',
		lon: 'forecast.lon'
	};
	const read = (k) => window.localStorage.getItem(k) ?? '';
	const ctx = {
		pnu: read(STORAGE_KEYS.pnu),
		builtYear: read(STORAGE_KEYS.builtYear),
		floorArea: read(STORAGE_KEYS.floorArea),
		useName: read(STORAGE_KEYS.useName),
		buildingName: read(STORAGE_KEYS.buildingName),
		roadAddr: read(STORAGE_KEYS.roadAddr),
		jibunAddr: read(STORAGE_KEYS.jibunAddr),
		lat: read(STORAGE_KEYS.lat),
		lon: read(STORAGE_KEYS.lon)
	};

	if (ctx.pnu && !rootEl.dataset.pnu) rootEl.dataset.pnu = ctx.pnu;
	if (ctx.builtYear && !rootEl.dataset.builtYear) rootEl.dataset.builtYear = ctx.builtYear;
	if (ctx.floorArea && !rootEl.dataset.area) rootEl.dataset.area = ctx.floorArea;
	if (ctx.useName && !rootEl.dataset.use) rootEl.dataset.use = ctx.useName;

	if (ctx.buildingName) {
		if (!rootEl.dataset.bname) rootEl.dataset.bname = ctx.buildingName;
		if (!rootEl.dataset.buildingName) rootEl.dataset.buildingName = ctx.buildingName;
	}
	if (ctx.roadAddr && !rootEl.dataset.roadAddr) rootEl.dataset.roadAddr = ctx.roadAddr;
	if (ctx.jibunAddr && !rootEl.dataset.jibunAddr) rootEl.dataset.jibunAddr = ctx.jibunAddr;
	if (ctx.lat && !rootEl.dataset.lat) rootEl.dataset.lat = ctx.lat;
	if (ctx.lon && !rootEl.dataset.lon) rootEl.dataset.lon = ctx.lon;

	try {
	} catch {}
}

/** 시작 버튼 결선(없으면 자동 시작) */
function wireStartButtonAndFallback() {
	const btn = document.getElementById('forecast-start');

	setPreloadState('idle');
	renderPreloadInfoAndRisks();

	if (btn) {
		// [수정] 클릭 시 runForecast() 실제 호출 누락 보강
		btn.addEventListener('click', () => {
			setPreloadState('running');
			// [추가]
			runForecast().catch(e => SaveGreen.log.error('forecast', 'run failed', e));
		});
	} else {
		setPreloadState('running');
		// [수정] 버튼 없을 때 자동 실행에서도 runForecast() 누락 보강
		runForecast().catch(e => SaveGreen.log.error('forecast', 'run failed', e));
	}
}

// DOMContentLoaded 시 init 실행(+가정 라인 스타일 보정)
document.addEventListener('DOMContentLoaded', () => {
	init()
		.then(() => { styleAssumptionLines(); })
		.catch(err => SaveGreen.log.error('forecast', 'init failed', err));
});



/* ==========================================================
 * 4) 카탈로그 유틸(세션 파싱/매칭/컨텍스트 라벨링)
 * ========================================================== */

(function () {
	'use strict';

	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

	let _catalog = null;

	const qs = (s, r=document) => r.querySelector(s);
	const _normalizeAddr = (s) => (s||'')
		.replace(/\s*\([^)]*\)\s*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	function readSessionKeys() {
		const get = (k) => sessionStorage.getItem(k) || '';
		const payload = {
			roadAddr: get('gf:roadAddr') || get('roadAddr') || '',
			jibunAddr: get('gf:jibunAddr') || get('jibunAddr') || '',
			lat: parseFloat(get('gf:lat') || get('lat') || '') || null,
			lng: parseFloat(get('gf:lng') || get('lng') || '') || null,
			featureId: get('gf:featureId') || get('featureId') || '',
			buildingName: get('gf:buildingName') || get('buildingName') || ''
		};
		payload.norm = {
			road: _normalizeAddr(payload.roadAddr),
			jibun: _normalizeAddr(payload.jibunAddr)
		};
		return payload;
	}

	async function loadCatalogOnce() {
		if (_catalog) return _catalog;
		const res = await fetch(CATALOG_URL, { cache: 'no-store' });
		if (!res.ok) throw new Error('catalog fetch failed: ' + res.status);
		_catalog = await res.json();
		return _catalog;
	}

	function _isNear(a, b, radiusM=30) {
		if (!a || !b || a.lat==null || a.lng==null || b.lat==null || b.lng==null) return false;
		const dx = (a.lng - b.lng) * 111320 * Math.cos(((a.lat+b.lat)/2) * Math.PI/180);
		const dy = (a.lat - b.lat) * 111320;
		return Math.hypot(dx, dy) <= radiusM;
	}

	function matchCatalogRecord(session, catalog) {
		if (!Array.isArray(catalog)) return null;
		const road = session.norm.road;
		const jibun = session.norm.jibun;

		let candidates = catalog;

		if (road || jibun) {
			candidates = candidates.filter(it => {
				const itRoad = _normalizeAddr(it.roadAddr || '');
				const itJibun = _normalizeAddr(it.jibunAddr || '');
				return (road && itRoad && itRoad === road) || (jibun && itJibun && itJibun === jibun);
			});
		}

		if ((!candidates || candidates.length === 0) && (session.lat!=null && session.lng!=null)) {
			candidates = catalog.filter(it => _isNear(
				{ lat: session.lat, lng: session.lng },
				{ lat: parseFloat(it.lat), lng: parseFloat(it.lng) },
				30
			));
		}

		if (!candidates || candidates.length === 0) {
			const bname = (session.buildingName || '').trim();
			if (bname) {
				const lw = bname.toLowerCase();
				candidates = catalog.filter(it => (it.buildingName||'').toLowerCase().includes(lw));
			}
		}

		if (!candidates || candidates.length === 0) return null;
		return candidates[0];
	}

	function buildChartContextLine(rec) {
		const name = (rec?.buildingName && String(rec.buildingName).trim()) || '건물명 없음';
		const addr = _normalizeAddr(rec?.roadAddr || rec?.jibunAddr || '');
		const use  = (rec?.useName || rec?.use || '').toString().trim();
		const parts = [name];
		if (addr) parts.push(addr);
		if (use) parts.push(use);
		return parts.join(' → ');
	}

	function hydratePreloadUI(rec) {
		try {
			const dateEl = qs('#chipDataDate');
			if (dateEl && rec?.meta?.dataDate) dateEl.textContent = rec.meta.dataDate;

			if (typeof window.renderPreloadInfoAndRisks === 'function') {
				const root = qs('#forecast-root');
				if (root) {
					if (rec.buildingName) root.dataset.buildingName = rec.buildingName;
					if (rec.roadAddr) root.dataset.roadAddr = rec.roadAddr;
					if (rec.jibunAddr) root.dataset.jibunAddr = rec.jibunAddr;
					if (rec.useName) root.dataset.useName = rec.useName;
					if (rec.builtYear) root.dataset.builtYear = rec.builtYear;
					if (rec.floorArea) root.dataset.floorArea = rec.floorArea;
					if (rec.pnu) root.dataset.pnu = rec.pnu;
				}
				window.renderPreloadInfoAndRisks();
			}

			const ctxLine = buildChartContextLine(rec);
			const h1 = qs('#hero-title');
			if (h1 && ctxLine) h1.textContent = ctxLine;

		} catch (e) {
			SaveGreen.log.warn('forecast', 'hydratePreloadUI error', e);
		}
	}

	async function bindPreloadFromSessionAndCatalog() {
		try {
			const session = readSessionKeys();
			const catalog = await loadCatalogOnce();
			const rec = matchCatalogRecord(session, catalog);
			if (rec) {
				hydratePreloadUI(rec);
			}
		} catch (e) {
			// [수정] console.warn → SaveGreen.log.warn (첫 발생만 주석)
			SaveGreen.log.warn('forecast', 'bindPreloadFromSessionAndCatalog error', e);
		}
	}

	window.SaveGreen.Forecast.bindPreloadFromSessionAndCatalog = bindPreloadFromSessionAndCatalog;
})();

// ---------------------------------------------------------
// [새 함수] 카탈로그 품질 검증 리포트
//  - 기본 경로: /dummy/buildingenergydata.json
//  - 콘솔 테이블 + 미흡 레코드 JSON 다운로드
// 사용법: SaveGreen.Catalog.report();  또는 SaveGreen.Catalog.report('/api/dummy/buildingenergydata.json')
// ---------------------------------------------------------
window.SaveGreen = window.SaveGreen || {};
SaveGreen.Catalog = SaveGreen.Catalog || {};

SaveGreen.Catalog.report = async function (url = '/dummy/buildingenergydata.json') {
	try {
		const rsp = await fetch(url, { cache: 'no-store' });
		const rows = await rsp.json();
		if (!Array.isArray(rows)) {
			console.warn('[catalog] not an array');
			return;
		}
		const bad = [];
		let ok = 0;
		for (const r of rows) {
			const miss = [];
			if (!r.useName) miss.push('useName');
			if (!r.floorArea) miss.push('floorArea');
			if (!r.lat || !r.lon) miss.push('lat/lon');
			if (!r.builtYear) miss.push('builtYear');
			if (miss.length) bad.push({ id: r.pnu || r.buildingName || '(unknown)', miss, rec: r });
			else ok++;
		}
		console.info(`[catalog] total=${rows.length}, ok=${ok}, bad=${bad.length}`);
		if (bad.length) {
			console.table(bad.map(x => ({ id: x.id, miss: x.miss.join(', ') })));
			// 다운로드 파일 제공
			const blob = new Blob([JSON.stringify(bad, null, 2)], { type: 'application/json' });
			const href = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = href; a.download = 'catalog_quality_issues.json';
			document.body.appendChild(a); a.click(); a.remove();
			URL.revokeObjectURL(href);
		}
	} catch (e) {
		console.warn('[catalog] report failed', e);
	}
};


/* ===== HOTFIX: runForecast에서 참조하는 카탈로그 헬퍼들 ===== */
// 1) loadCatalog(): 내부 IIFE의 loadCatalogOnce()를 감싼 별칭 + sessionStorage 캐시
async function loadCatalog() {
	const CACHE_KEY = 'catalog.cache.v1';
	try {
		const cached = sessionStorage.getItem(CACHE_KEY);
		if (cached) {
			const arr = JSON.parse(cached);
			if (Array.isArray(arr)) return arr;
		}
		// loadCatalogOnce 는 위 IIFE(카탈로그 유틸)에서 정의된 함수
		const list = await (window.SaveGreen?.Forecast?.bindPreloadFromSessionAndCatalog
			? (async () => {
				// IIFE 내부의 _catalog 캐시에 접근할 수 없으므로 직접 fetch
				const rsp = await fetch(CATALOG_URL, { cache: 'no-store' });
				if (!rsp.ok) throw new Error('catalog fetch failed: ' + rsp.status);
				const json = await rsp.json();
				return Array.isArray(json) ? json : [];
			})()
			: (async () => {
				const rsp = await fetch(CATALOG_URL, { cache: 'no-store' });
				if (!rsp.ok) throw new Error('catalog fetch failed: ' + rsp.status);
				const json = await rsp.json();
				return Array.isArray(json) ? json : [];
			})()
		);
		sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
		return list;
	} catch (e) {
		SaveGreen.log.warn('catalog', 'load error', e);
		return [];
	}
}

// 2) matchCatalogItem(ctx, list): runForecast용 시그니처
//    (이미 IIFE에 있는 matchCatalogRecord와 유사하지만, 여기선 ctx를 바로 받도록 구현)
function matchCatalogItem(ctx, list) {
	if (!ctx || !Array.isArray(list) || !list.length) return null;

	// 비교용 키 추출
	const pnu = (ctx.pnu || '').trim();
	const ra  = (ctx.roadAddr || ctx.roadAddress || '').trim();
	const ja  = (ctx.jibunAddr || '').trim();
	const bn  = (ctx.buildingName || '').trim();
	const lat = Number(ctx.lat ?? ctx.latitude);
	const lon = Number(ctx.lon ?? ctx.lng ?? ctx.longitude);

	// 문자열 정규화
	const norm = (s) => (s || '')
		.replace(/\s+/g, '')
		.replace(/[-–—]/g, '')
		.replace(/[()]/g, '')
		.toLowerCase();

	// 1) PNU 완전일치
	if (pnu) {
		const byPnu = list.find(it => String(it.pnu || '').trim() === pnu);
		if (byPnu) return byPnu;
	}

	// 2) 주소 정규화 일치
	const raN = norm(ra), jaN = norm(ja);
	if (raN || jaN) {
		const byAddr = list.find(it => {
			const itRaN = norm(it.roadAddr || it.roadAddress);
			const itJaN = norm(it.jibunAddr);
			return (raN && itRaN && raN === itRaN) || (jaN && itJaN && jaN === itJaN);
		});
		if (byAddr) return byAddr;
	}

	// 3) 좌표 근접(하버사인 근사, 120m 이내)
	const roughDistM = (a, b) => {
		if (![a.lat, a.lon, b.lat, b.lon].every(v => Number.isFinite(Number(v)))) return Infinity;
		const R = 6371000, toRad = d => (Number(d) * Math.PI) / 180;
		const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
		const A = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
		return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A));
	};
	if (Number.isFinite(lat) && Number.isFinite(lon)) {
		let best = null, bestD = Infinity;
		for (const it of list) {
			const d = roughDistM({ lat, lon }, { lat: Number(it.lat), lon: Number(it.lon) });
			if (d < bestD) { best = it; bestD = d; }
		}
		if (best && bestD <= 120) return best;
	}

	// 4) 느슨한 빌딩명
	if (bn) {
		const bnN = norm(bn);
		const byBn = list.find(it => norm(it.buildingName) === bnN);
		if (byBn) return byBn;
	}

	return null;
}

// 3) applyCatalogHints(ctx): 프리로드 칩/가정(KV) 보강(값이 비어 있을 때만)
async function applyCatalogHints(ctx) {
	if (!ctx || !ctx.catalog) return;

	// 상단 칩(데이터 기간)만 보강
	try {
		const wrap = document.querySelector('.chips');
		const { period } = ctx.catalog || {};
		if (wrap && period?.startYear && period?.endYear) {
			let chip = document.getElementById('chip-data-period');
			const label = `데이터 기간`;
			const value = `${period.startYear}–${period.endYear}`;
			if (!chip) {
				chip = document.createElement('div');
				chip.className = 'chip';
				chip.id = 'chip-data-period';
				chip.innerHTML = `<span class="dot">●</span><strong>${label}</strong><span>${value}</span>`;
				wrap.appendChild(chip);
			} else {
				const last = chip.querySelector('span:last-of-type');
				if (last && !last.textContent.trim()) last.textContent = value;
			}
		}
	} catch (e) {
		SaveGreen.log.warn('catalog', 'chip update skipped', e);
	}

	// ▼ 우측 KV(전력단가/계산 기준) 텍스트 보강
	//    - 지금 마크업은 #assump-tariff, #assump-basis 이므로 여기에만 채움
	try {
		const b = ctx?.daeBase || {};
		const unit = (b?.tariff?.unit ?? b?.tariff);
		const tariffText = (unit != null) ? `${nf(unit)} 원/kWh (가정)` : '기본(가정)';

		let basisText = 'EUI 기준 산출';
		try {
			const rules = ctx?.euiRules
				|| await SaveGreen.Forecast.loadDaeConfig().then(SaveGreen.Forecast.getEuiRules);
			if (rules?.mode === 'primary') basisText = '1차에너지 기준 산출';
		} catch {}

		const t = $el('#assump-tariff');
		const bEl = $el('#assump-basis');
		if (t && !t.textContent.trim())   t.textContent = tariffText;
		if (bEl && !bEl.textContent.trim()) bEl.textContent = basisText;
	} catch (e) {
		SaveGreen.log.warn('catalog', 'assumption kv fill skipped', e);
	}
}

/* ===== HOTFIX END ===== */

// === ML 브리지 호출(POST /api/forecast/ml) ===
async function callMl(payload) {
	const res = await fetch('/api/forecast/ml', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) throw new Error('ML ' + res.status);
	return res.json(); // { savingKwhYr, savingCostYr, savingPct, paybackYears, label }
}

// === FE가 받은 data로 ML 페이로드 구성 ===
function buildMlPayload(ctx, data) {
	const fromYear = Number(ctx.from ?? new Date().getFullYear());
	const floor = Number(ctx.floorAreaM2 ?? ctx.floorArea ?? 0);

	// 현재 기준 사용량(kWh/yr) 추정: after[0] + saving[0]
	let baselineKwh = 0;
	try {
		const a0 = Number(data?.series?.after?.[0] ?? 0);
		const s0 = Number(data?.series?.saving?.[0] ?? 0);
		baselineKwh = Math.max(0, Math.round(a0 + s0));
	} catch {}

	return {
		typeRaw:   ctx.useName || ctx.mappedType || ctx.typeRaw || '사무동',
		regionRaw: ctx.regionRaw || '대전 서구',
		builtYear: Number(ctx.builtYear ?? (fromYear - 13)),
		floorAreaM2: floor > 0 ? floor : 1500,
		yearlyConsumption: baselineKwh > 0 ? [{ year: fromYear, electricity: baselineKwh }] : [],
		monthlyConsumption: ctx.monthlyConsumption || []
	};
}


/* ==========================================================
 * 5) runForecast(): 컨텍스트 수집→가정 주입→데이터 로드→차트
 * ========================================================== */

/**
 * dataset → 프로바이더 쿼리스트링 변환
 */
function buildCtxQuery(ctx) {
	const params = new URLSearchParams();
	params.set('from', String(ctx.from ?? NOW_YEAR));
	params.set('to', String(ctx.to ?? (NOW_YEAR + HORIZON_YEARS)));
	if (Number(ctx.builtYear) > 0) params.set('builtYear', String(ctx.builtYear));
	setIf(params, 'useName', ctx.useName);
	setIf(params, 'floorArea', ctx.floorArea);
	setIf(params, 'area', ctx.area);
	setIf(params, 'pnu', ctx.pnu);
	return params.toString();
}
function setIf(params, key, value) {
	if (value == null || String(value).trim() === '') return;
	params.set(key, String(value));
}

/** 계산 가정 주입
 * - 표시용(dataset)은 비어있을 때만 채움(문자열)
 * - 계산용 숫자는 window.__FORECAST_ASSUMP__ 에 통일
 */
function applyAssumptionsToDataset(rootEl, ctx) {
	const ds = (rootEl?.dataset) || {};
	const base = ctx?.daeBase || {};

	// (1) 표시용(dataset)
	{
		const defaults = ctx?.daeDefaults || {};
		if (!ds.unitPrice) {
			const unit = (base.unitPrice ?? base.tariff?.unit ?? base.tariff);
			ds.unitPrice = (unit != null) ? String(unit) : '';
		}
		if (!ds.tariffEscalationPct) {
			let pctStr = '';
			const esc = defaults.electricityEscalationPctPerYear;
			if (typeof esc === 'number' && isFinite(esc)) pctStr = String(Math.round(esc * 100));
			else if (base.tariffEscalationPct != null) pctStr = String(base.tariffEscalationPct);
			else if (base.tariff?.escalationPct != null) pctStr = String(base.tariff.escalationPct);
			ds.tariffEscalationPct = pctStr;
		}
		if (!ds.discountRatePct) {
			let pctStr = '';
			const dr = defaults.discountRate;
			if (typeof dr === 'number' && isFinite(dr)) pctStr = String(Math.round(dr * 100));
			else if (base.discountRatePct != null) pctStr = String(base.discountRatePct);
			else if (base.discount?.ratePct != null) pctStr = String(base.discount.ratePct);
			ds.discountRatePct = pctStr;
		}
	}

	// (2) 계산용 숫자
	{
		const defaults = ctx?.daeDefaults || {};
		const fallbackUnit = (base.unitPrice ?? base.tariff?.unit ?? base.tariff ?? 145);
		const fallbackEscPct = (
			(base.tariffEscalationPct ?? base.tariff?.escalationPct) ??
			((typeof defaults.electricityEscalationPctPerYear === 'number') ? Math.round(defaults.electricityEscalationPctPerYear * 100) : 3)
		);
		const fallbackDiscPct = (
			(base.discountRatePct ?? base.discount?.ratePct) ??
			((typeof defaults.discountRate === 'number') ? Math.round(defaults.discountRate * 100) : 5)
		);

		window.__FORECAST_ASSUMP__ = {
			tariffUnit: toNum(ds.unitPrice, fallbackUnit),
			tariffEscalation: toPct(ds.tariffEscalationPct, fallbackEscPct),
			discountRate: toPct(ds.discountRatePct, fallbackDiscPct)
		};
	}

	function toNum(x, fallback) {
		const n = Number(String(x ?? '').replace(/[^\d.]/g, ''));
		return Number.isFinite(n) ? n : Number(fallback ?? 0);
	}
	function toPct(x, fallbackPct) {
		const n = Number(String(x ?? '').replace(/[^\d.]/g, ''));
		const pct = Number.isFinite(n) ? n : Number(fallbackPct ?? 0);
		return pct / 100;
	}
}

/** 메인 실행 시퀀스 */
async function runForecast() {
	const $result  = $el('#result-section');
	const $ml      = $el('#mlLoader');
	const $surface = $el('.result-surface');

	SaveGreen.log.info('forecast', 'run start');

	show($ml);
	hide($result);
	startLoader();

	let ctx, useDummy = false;
	const root = document.getElementById('forecast-root');

	try {
		// 5-1) 컨텍스트 수집
		ctx = await getBuildingContext();

			// [추가] 컨텍스트 검증(필수값 누락 안내)
        	// - 면적(floorArea) 없으면: EUI/등급 계산은 추정치(절감률 기반)로만 표시하도록 경고
        	// - 사용연도(builtYear) 없으면: from-13으로 추정하고, 경고 배지/토스트 표시
        	(function () {
        		const n = (x) => Number.isFinite(Number(x)) ? Number(x) : NaN;

        		const hasArea = Number.isFinite(n(ctx.floorArea)) && n(ctx.floorArea) > 0;
        		const hasBuiltYear = Number.isFinite(n(ctx.builtYear)) && n(ctx.builtYear) > 0;

        		// 화면/로깅에서 쓰기 쉽게 플래그 보관
        		ctx.__flags = {
        			missingArea: !hasArea,
        			missingBuiltYear: !hasBuiltYear
        		};

        		if (!hasArea) {
        			showToast('면적 값이 없어 EUI 등급은 추정 기준으로 표시됩니다.', 'warn');
        			SaveGreen.log.info('main', 'validation = missing floorArea');
        		}
        		if (!hasBuiltYear) {
        			// runForecast 기존 로직이 from-13 등으로 보정하더라도, 사용자에게는 추정임을 알려줌
        			showToast('사용연도가 없어 추정값으로 계산됩니다.', 'warn');
        			SaveGreen.log.info('main', 'validation = missing builtYear (use inferred)');
        		}
        	})();


		// 5-2) 컨텍스트 보강(enrich)
		// [수정] 깨진 try/catch 복구(+ e 미정의 오류 제거)
		try {
			const P = window.SaveGreen?.Forecast?.providers;
			if (P && typeof P.enrichContext === 'function') {
				ctx = await P.enrichContext(ctx) || ctx;
			}
		} catch (e) {
			SaveGreen.log.warn('forecast', 'enrich skipped', e);
		}

		// 5-3) 타입 결정 + dae.json 로드 + 기본가정(base) 추출
		try {
			const F = window.SaveGreen?.Forecast || {};

			// (a) 타입 결정
			let mappedType = null;
			if (typeof F.providers?.pickTypeFromContext === 'function') {
				mappedType = F.providers.pickTypeFromContext(ctx);
			}
			if (!mappedType && typeof F.mapUseNameToType === 'function') {
				mappedType = F.mapUseNameToType(ctx.useName);
			}
			if (!mappedType) {
				const fromStore =
					sessionStorage.getItem('forecast.type') ||
					localStorage.getItem('forecast.type');
				const ok = ['factory', 'school', 'hospital', 'office'];
				mappedType = ok.includes(fromStore) ? fromStore : null;
			}
			if (!mappedType) mappedType = 'office';

			// (b) dae.json 로드 & 타입별 base 가정
			const dae  = (typeof F.loadDaeConfig === 'function') ? await F.loadDaeConfig() : null;
			let base   = (dae && typeof F.getBaseAssumptions === 'function')
				? F.getBaseAssumptions(dae, mappedType)
				: null;
			if (!base && mappedType !== 'office' && dae && typeof F.getBaseAssumptions === 'function') {
				base = F.getBaseAssumptions(dae, 'office');
			}

			// (c) 컨텍스트에 보관 + euiRules/defaults 보관
			ctx.mappedType = mappedType;
			ctx.daeBase    = base || null;

			try {
                if (dae) {
                    const getT = (F.getEuiRulesForType || F.getEuiRules);
                    if (typeof getT === 'function') {
                        ctx.euiRules = getT(dae, mappedType);
                        window.SaveGreen.Forecast._euiRules = ctx.euiRules;
                    }
                }
				if (dae && typeof F.getDefaults === 'function') {
					ctx.daeDefaults = F.getDefaults(dae);
				}
			} catch {}

			// (d) 표시용/계산용 가정 반영
			applyAssumptionsToDataset(root, ctx);

			// (e) 로더 상태 라벨
			try {
				if (window.LOADER && ctx.mappedType) {
					const labelMap = { factory:'제조/공장', school:'교육/학교', hospital:'의료/병원', office:'업무/오피스' };
					window.LOADER.setStatus(`예측 가정: ${labelMap[ctx.mappedType] || ctx.mappedType}`);
				}
			} catch {}

			const b = ctx.daeBase || {};

			// [교체] 멀티라인 요약(kv) 사용
            SaveGreen.log.kv('main', 'base', {
            	type: ctx.mappedType,
            	tariff: b?.tariff?.unit ?? b?.tariff ?? '-',
            	capexPerM2: b?.capexPerM2 ?? '-',
            	savingPct: b?.savingPct ?? '-'
            }, ['type','tariff','capexPerM2','savingPct']);


		} catch (e) {
			// [수정] console.warn → SaveGreen.log.warn
			SaveGreen.log.warn('forecast', 'dae.json/base inject skipped', e);
		}

	} catch (e) {
		// [수정] console.warn → SaveGreen.log.warn
		SaveGreen.log.warn('forecast', 'no context → fallback to dummy', e);
		ctx = fallbackDefaultContext(root);
		useDummy = true;
		applyAssumptionsToDataset(root, ctx);
	}

	// 5-4) 카탈로그 로드/매칭 → 프리로드 힌트 반영
	try {
		const catalogList = await loadCatalog();
		const matched = matchCatalogItem(ctx, catalogList);
		ctx.catalog = matched || null;
		if (matched) {
			SaveGreen.log.info('catalog', 'matched');
			await applyCatalogHints(ctx);
		}
	} catch (e) {
		// [수정] console.warn → SaveGreen.log.warn
		SaveGreen.log.warn('catalog', 'pipeline error', e);
	}

	// 5-5) 데이터 로드(실제 API 또는 더미)
	const data = useDummy ? makeDummyForecast(ctx.from, ctx.to) : await fetchForecast(ctx);
	window.FORECAST_DATA = data;

	// ▼ ML KPI 호출(파이썬)
    let kpiFromServer = null;
    try {
    	const mlPayload = buildMlPayload(ctx, data);
    	kpiFromServer = await callMl(mlPayload);
    	SaveGreen.log.kv('kpi', 'ml kpi', kpiFromServer, ['savingKwhYr','savingCostYr','savingPct','paybackYears','label']);
    } catch (e) {
    	console.warn('ML bridge failed → fallback', e?.message || e);
    	// 화면이 멈추지 않도록 안전 폴백
    	kpiFromServer = { savingKwhYr:0, savingCostYr:0, savingPct:0, paybackYears:99, label:'NOT_RECOMMEND' };
    }


	// 5-6) 배열 길이/타입 보정(Forward-fill)
	{
		const expectedYears = Array.isArray(data.years) ? data.years.map(String) : [];
		const L = expectedYears.length;

		data.years = expectedYears;
		data.series = data.series || {};
		data.cost   = data.cost   || {};

		data.series.after  = toNumArrFFill(data.series.after,  L);
		data.series.saving = toNumArrFFill(data.series.saving, L);
		data.cost.saving   = toNumArrFFill(data.cost.saving,   L);
	}

	// 5-7) 메타패널(기간/모델/특징)
	updateMetaPanel({
		years: window.FORECAST_DATA.years,
		model: 'Linear Regression',
		features: (function () {
			const feats = ['연도'];
			if (Array.isArray(window.FORECAST_DATA?.series?.after))  feats.push('사용량');
			if (Array.isArray(window.FORECAST_DATA?.cost?.saving))   feats.push('비용 절감');
			return feats;
		})()
	});

	// 5-8) KPI/등급/배너
	const floorArea = Number(ctx?.floorArea ?? ctx?.area);
	const kpi = SaveGreen.Forecast.computeKpis({
		years: data.years,
		series: data.series,
		cost: data.cost,
		kpiFromApi: kpiFromServer,
		base: ctx.daeBase || null,
		floorArea: Number.isFinite(floorArea) ? floorArea : undefined
	});

	// EUI 룰 기반 등급 산정(룰/면적 없으면 절감률 폴백)
	const euiRules = ctx.euiRules || window.SaveGreen?.Forecast?._euiRules || null;
	const euiNow = SaveGreen.Forecast.KPI.computeCurrentEui(data, Number(ctx?.floorArea ?? ctx?.area));
	let gradeNow   = null;
	if (euiRules && euiNow != null) {
        gradeNow = SaveGreen.Forecast.KPI.pickGradeByRules(euiNow, euiRules);
	}
	if (gradeNow == null) {
		gradeNow = (kpi.savingPct >= 30) ? 1 : (kpi.savingPct >= 20) ? 2 : (kpi.savingPct >= 10) ? 3 : 4;
	}

	const builtYear = Number(document.getElementById('forecast-root')?.dataset.builtYear) || Number(ctx?.builtYear);
	const statusObj = SaveGreen.Forecast.decideStatusByScore(kpi, { builtYear });
	applyStatus(statusObj.status);

	// 로더 종료 → 결과 표시
	await ensureMinLoaderTime();
	await finishLoader();
	hide($ml);
	show($result);
	if ($surface) hide($surface);

	// 5-9) ABC 순차 실행(차트)
	await runABCSequence({
		ctx,
		baseForecast: data,
		onCComplete: () => {
			renderKpis(kpi, { gradeNow });
			renderSummary({ gradeNow, kpi, rules: euiRules, euiNow, ctx });

			if ($surface) {
				try {
					$surface.style.opacity = '0';
					$surface.style.transform = 'translateY(-12px)';
					show($surface);
					$requestAnimationFramePoly(() => {
						$surface.style.transition = 'opacity 350ms ease, transform 350ms ease';
						$surface.style.opacity = '1';
						$surface.style.transform = 'translateY(0)';
						setTimeout(() => { $surface.style.transition = ''; }, 400);
					});
				} catch { show($surface); }
			}
		}
	});

	setPreloadState('complete');
	// [수정] console.groupEnd() 제거
}



/* ==========================================================
 * 6) KPI/등급/요약/배너/차트
 * ========================================================== */

/** 상태 배너/루트 결과에 추천/조건부/비추천 클래스 적용 + 메시지 갱신 */
function applyStatus(status) {
	const banner = $el('#status-banner');
	const result = $el('#result-section');
	const classes = ['recommend', 'conditional', 'not-recommend'];
	classes.forEach((c) => { banner?.classList?.remove(c); result?.classList?.remove(c); });
	if (classes.includes(status)) {
		banner?.classList?.add(status);
		result?.classList?.add(status);
	}
	const msg = $el('#banner-message');
	const badge = $el('#banner-badge');
	if (msg) msg.textContent = BANNER_TEXTS[status] || '';
	if (badge) badge.textContent =
		status === 'recommend' ? '추천' :
		status === 'conditional' ? '조건부' : '비추천';
}

/** 상단 메타 패널(기간/모델/특징) 텍스트 갱신 */
function updateMetaPanel({ years, model, features }) {
	const fromY = Number(years?.[0]);
	const toY = Number(years?.[years?.length - 1]);
	const rangeEl = document.getElementById('meta-data-range');
	if (rangeEl) {
		let text = '-';
		if (Number.isFinite(fromY) && Number.isFinite(toY)) {
			text = (fromY === toY) ? `${fromY}년` : `${fromY}~${toY} 연간`;
		}
		rangeEl.textContent = text;
	}
	const modelEl = document.getElementById('modelName');
	if (modelEl && model) modelEl.textContent = model;
	const featEl = document.getElementById('meta-features');
	if (featEl && Array.isArray(features) && features.length) featEl.textContent = features.join(', ');
}

/** KPI 수치판 렌더 */
function renderKpis(kpi, { gradeNow }) {
	const g = $el('#kpi-grade');
	const sc = $el('#kpi-saving-cost');
	const pb = $el('#kpi-payback');
	const sp = $el('#kpi-saving-pct');
	if (g) g.textContent = String(gradeNow);
	if (sc) sc.textContent = nf(kpi.savingCostYr);
	if (pb) pb.textContent = (Math.round(kpi.paybackYears * 10) / 10).toFixed(1);
	if (sp) sp.textContent = kpi.savingPct + '%';
}

/** 요약 리스트(EUI 경계/필요 절감률 등) — euiRules 기반 */
function renderSummary({ gradeNow, kpi, rules, euiNow, ctx }) {
	const ul = $el('#summary-list');
	if (!ul) return;
	ul.innerHTML = '';

	let targetGradeText, boundary = null;
	if (typeof gradeNow === 'number') {
		const targetGradeNum = Math.max(1, gradeNow - 1);
		targetGradeText = `${targetGradeNum}등급`;
		boundary = SaveGreen.Forecast.KPI.getBoundaryForGrade(targetGradeNum, rules);
	} else {
		targetGradeText = '상위 등급';
	}

	let currentEuiText = '-';
	let boundaryText   = '-';
	let needSavingPct  = 0;

	if (Number.isFinite(euiNow)) {
		currentEuiText = `${nf(euiNow)} kWh/m²/년`;
	}
	if (boundary && Number.isFinite(boundary.value)) {
		boundaryText = `${nf(boundary.value)} ${boundary.unit}`;
	}
	if (Number.isFinite(euiNow) && boundary && Number.isFinite(boundary.value)) {
		needSavingPct = Math.max(0, Math.round(((euiNow - boundary.value) / euiNow) * 100));
	} else if (Number.isFinite(kpi?.savingPct)) {
		needSavingPct = Math.max(0, 100 - kpi.savingPct);
	}

	const lines = [];
	lines.push(`현재 등급 : <strong>${(typeof gradeNow === 'number') ? `${gradeNow}등급` : String(gradeNow)}</strong>`);
	lines.push(`목표 : <strong>${targetGradeText}</strong>`);
	if (boundaryText !== '-') lines.push(`등급 상승 기준(EUI 경계값) : <strong>${boundaryText}</strong>`);
	if (Number.isFinite(euiNow)) lines.push(`추정 현재 EUI : <strong>${currentEuiText}</strong>`);
	lines.push(`등급 상승 필요 절감률 : <strong>${needSavingPct}%</strong>`);

	lines.forEach((html) => {
		const li = document.createElement('li');
		li.innerHTML = html;
		ul.appendChild(li);
	});

	// ▼ '추정' 라벨 추가 (컨테이너 안전 가져오기)
	const notes = [];
	if (ctx?.__flags?.missingArea) notes.push('면적 데이터 미확정 → EUI 등급 추정');
	if (ctx?.__flags?.missingBuiltYear) notes.push('사용연도 데이터 미확정 → 추정 연식');


	try {
		// 요약 패널 엘리먼트: 있으면 사용, 없으면 ul의 부모를 사용
		const summaryEl =
			document.getElementById('summary-panel') || ul.parentElement || ul;

		let elNotes = summaryEl.querySelector('[data-summary-notes]');
		if (!elNotes) {
			elNotes = document.createElement('div');
			elNotes.setAttribute('data-summary-notes', '1');
			elNotes.className = 'text-xs text-amber-200 mt-2';
			summaryEl.appendChild(elNotes);
		}
		elNotes.textContent = notes.length ? `※ ${notes.join(' · ')}` : '';
	} catch {}
}

/** 페이지 상단 '건물 정보' 카드(컨텍스트 보조 정보) */
function renderBuildingCard() {
	const box = document.getElementById('building-card');
	if (!box) return;
	const b = window.BUILDING_INFO || {};
	const root = document.getElementById('forecast-root');
	const fromQs = (k) => (root?.dataset?.[k + 'From'] === 'qs');
	const rows = [];
	const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
	const esc = (t) => String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
	if (b.buildingName) rows.push(row('건물명', esc(b.buildingName)));
	if (b.dongName) rows.push(row('동명', esc(b.dongName)));
	if (b.buildingIdent) rows.push(row('식별번호', esc(b.buildingIdent)));
	if (b.lotSerial) rows.push(row('지번', esc(b.lotSerial)));
	if (b.use) rows.push(row('용도', esc(b.use)));
	if (b.approvalDate) rows.push(row('사용승인일', esc(b.approvalDate)));
	if (b.area) rows.push(row('건축면적', nf(b.area) + ' m²'));
	if (b.plotArea) rows.push(row('대지면적', nf(b.plotArea) + ' m²'));
	if (b.height) rows.push(row('높이', nf(b.height) + ' m'));
	if (b.floorsAbove != null || b.floorsBelow != null) rows.push(row('지상/지하', `${b.floorsAbove ?? 0} / ${b.floorsBelow ?? 0}`));
	if (!rows.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
	if (b.pnu && !fromQs('pnu')) rows.push(row('PNU', esc(b.pnu)));
	if (b.builtYear && !fromQs('builtYear')) rows.push(row('준공연도', String(b.builtYear)));
	box.innerHTML = `<div class="card building-card"><h4>건물 정보</h4>${rows.join('')}</div>`;
	box.classList.remove('hidden');
}



/* ==========================================================
 * 7) 차트/데이터/유틸 모음
 * ========================================================== */

// [추가] 사용자 경고/알림용 미니 토스트
function showToast(msg, level) {
	try {
		const ex = document.querySelector('#sg-toast');
		if (ex) ex.remove();

		const el = document.createElement('div');
		el.id = 'sg-toast';
		el.textContent = msg;
		el.style.position = 'fixed';
		el.style.right = '16px';
		el.style.bottom = '16px';
		el.style.zIndex = '9999';
		el.className = 'rounded-xl px-3 py-2 text-sm shadow-lg';
		if (level === 'warn') el.className += ' bg-amber-600 text-white';
		else if (level === 'error') el.className += ' bg-rose-600 text-white';
		else el.className += ' bg-slate-700 text-white';

		document.body.appendChild(el);
		setTimeout(() => { el.remove(); }, 3000);
	} catch {}
}


/** rAF 보조(폴리필) */
function $requestAnimationFramePoly(cb) {
	if (window.requestAnimationFrame) return window.requestAnimationFrame(cb);
	return setTimeout(cb, 16);
}

/** ABC 직렬 시퀀스(차트 렌더) */
async function runABCSequence({ ctx, baseForecast, onCComplete }) {
	const years = Array.isArray(baseForecast?.years) ? baseForecast.years.map(String) : [];
	const n = years.length;

	const F = window.SaveGreen?.Forecast || {};
	const runModelA = typeof F.runModelA === 'function' ? F.runModelA : undefined;
	const runModelB = typeof F.runModelB === 'function' ? F.runModelB : undefined;
	const makeEnsemble = typeof F.makeEnsemble === 'function' ? F.makeEnsemble : undefined;

	const renderModelAChart = typeof F.renderModelAChart === 'function' ? F.renderModelAChart : undefined;
	const renderModelBChart = typeof F.renderModelBChart === 'function' ? F.renderModelBChart : undefined;
	const renderEnergyComboChart = typeof F.renderEnergyComboChart === 'function'
		? F.renderEnergyComboChart : (window.renderEnergyComboChart || undefined);

	const calcChartAnimMs = typeof F.calcChartAnimMs === 'function'
		? F.calcChartAnimMs : (() => (n * (600 + 120) + 200 + n * (240 + 90) + 50));

	const EXTRA_STAGE_HOLD_MS = 3000;

	/* 비용축 범위(공통) */
	const costArr = Array.isArray(baseForecast?.cost?.saving) ? baseForecast.cost.saving.slice(0, n) : [];
	let cmax = -Infinity;
	for (const v of costArr) {
		const x = Number(v);
		if (Number.isFinite(x) && x > cmax) cmax = x;
	}
	if (!Number.isFinite(cmax)) cmax = 1;
	const cmin = 0;
	const step = getNiceStep(cmin, cmax, 6);
	const rounded = roundMinMaxToStep(cmin, cmax, step);
	const costRange = { min: cmin, max: rounded.max, step };

	/* 모델 or 폴백 */
	function modelOrFallback(id) {
		try {
			if (id === 'A' && runModelA) {
				const out = runModelA(ctx, baseForecast);
				if (out?.yhat && out?.years) return out;
			}
			if (id === 'B' && runModelB) {
				const out = runModelB(ctx, baseForecast);
				if (out?.yhat && out?.years) return out;
			}
		} catch (e) {
			// [수정] console.warn → SaveGreen.log.warn
			SaveGreen.log.warn('forecast', 'model error, fallback', { id, error: e });
		}
		const src = Array.isArray(baseForecast?.series?.after) ? baseForecast.series.after.slice(0, n) : new Array(n).fill(0);
		const yhat = src.map((v, i, a) => Math.round(((Number(a[i-1] ?? v)) + Number(v) + Number(a[i+1] ?? v)) / 3));
		return { model: { id, version: 'fallback' }, years: years.slice(), yhat };
	}

	/* A */
	const A = modelOrFallback('A');
	await renderModelAChart?.({ years: A.years, yhat: A.yhat, costRange });
	await sleep(EXTRA_STAGE_HOLD_MS);

	/* B */
	const B = modelOrFallback('B');
	await renderModelBChart?.({ years: B.years, yhat: B.yhat, costRange });
	await sleep(EXTRA_STAGE_HOLD_MS);

	/* C */
	try { if (makeEnsemble) void makeEnsemble([A, B]); } catch {}

	const subtitleOverride = resolveChartSubtitle(document.getElementById('forecast-root'));
	await renderEnergyComboChart?.({
		years,
		series: baseForecast.series,
		cost: baseForecast.cost,
		costRange,
		subtitleOverride
	});
	await sleep(300);

	if (typeof onCComplete === 'function') onCComplete();
}

/** 차트 부제: 빌딩명→도로명→지번 우선 */
function resolveChartSubtitle(rootEl) {
	if (!rootEl) return '';
	const ds = rootEl.dataset || {};
	return ds.buildingName || ds.bname || ds.roadAddr || ds.jibunAddr || '';
}

/** 더미 예측 데이터 생성(서버 실패/빈 컨텍스트 폴백) */
function makeDummyForecast(fromYear, toYear) {
	let from = parseInt(fromYear, 10);
	let to = parseInt(toYear, 10);
	if (!Number.isFinite(from)) from = NOW_YEAR;
	if (!Number.isFinite(to)) to = from + HORIZON_YEARS;
	if (to < from) [from, to] = [to, from];
	if (to === from) to = from + HORIZON_YEARS;

	const years = [];
	for (let y = from; y <= to; y++) years.push(String(y));
	const L = years.length;

	const baseKwh = 2_150_000;
	const afterRate = 0.03;
	const startSaving = 360_000;
	const savingRate = 0.04;
	const UNIT_PRICE = 150;

	const after = Array.from({ length: L }, (_, i) =>
		Math.max(0, Math.round(baseKwh * Math.pow(1 - afterRate, i)))
	);
	const saving = Array.from({ length: L }, (_, i) =>
		Math.max(0, Math.round(startSaving * Math.pow(1 - savingRate, i)))
	);
	const savingCost = saving.map(k => k * UNIT_PRICE);

	return {
		years,
		series: { after, saving },
		cost: { saving: savingCost },
		kpi: null
	};
}

/** 예측 API 호출(fetch) — 실패 시 더미로 폴백 */
async function fetchForecast(ctx) {
	let from = parseInt(String(ctx.from ?? NOW_YEAR), 10);
	let to = parseInt(String(ctx.to ?? (NOW_YEAR + HORIZON_YEARS)), 10);
	if (!Number.isFinite(from)) from = NOW_YEAR;
	if (!Number.isFinite(to)) to = from + HORIZON_YEARS;
	if (to < from) [from, to] = [to, from];
	if (to === from) to = from + HORIZON_YEARS;

	const [lo, hi] = [from, to];
	const years = range(lo, hi);
	const qs = buildCtxQuery({ ...ctx, from: lo, to: hi });

	const hasId = ctx.buildingId != null && String(ctx.buildingId).trim() !== '';
	const base = hasId ? `/api/forecast/${encodeURIComponent(String(ctx.buildingId))}` : `/api/forecast`;
	const url = `${base}?${qs}`;

	try {
		const rsp = await fetch(url, { headers: { 'Accept': 'application/json' } });
		if (!rsp.ok) throw new Error('HTTP ' + rsp.status);
		const json = await rsp.json();
		return normalizeForecast(json, years);
	} catch (e) {
		SaveGreen.log.error('forecast', 'fetch failed, using fallback dummy', e);
		return makeDummyForecast(lo, hi);
	}
}

/** 서버 응답 정규화(누락/타입 보정 포함) */
function normalizeForecast(d, fallbackYears) {
	const years = Array.isArray(d?.years) ? d.years.map(String) : fallbackYears.map(String);
	const L = years.length;

	const after   = toNumArrFFill(d?.series?.after,   L);
	const saving  = toNumArrFFill(d?.series?.saving,  L);
	const cost    = { saving: toNumArrFFill(d?.cost?.saving, L) };
	const kpi     = d?.kpi ?? null;

	return { years, series: { after, saving }, cost, kpi };
}

/** 누락값을 직전값으로 채우는 보정(Forward-fill) */
function toNumArrFFill(arr, len) {
	const out = new Array(len);
	let last = 0;
	if (Array.isArray(arr)) {
		for (let i = 0; i < arr.length; i++) {
			const v = Number(arr[i]);
			if (Number.isFinite(v) && v > 0) { last = v; break; }
		}
	}
	for (let i = 0; i < len; i++) {
		const raw = Array.isArray(arr) ? Number(arr[i]) : NaN;
		if (Number.isFinite(raw) && raw > 0) { out[i] = raw; last = raw; }
		else { out[i] = last; }
	}
	return out;
}

/** 상단 메타 기간 칩을 dataset 기반으로 표시 */
function primeMetaRangeFromDataset() {
	const root = document.getElementById('forecast-root');
	if (!root) return;
	const from = root.dataset.from || new Date().getFullYear();
	const to   = root.dataset.to   || (new Date().getFullYear() + 10);
	const el = document.getElementById('meta-data-range');
	if (el) el.textContent = (String(from) === String(to)) ? `${from}년` : `${from}–${to}`;
}

/** 포맷/헬퍼 */
function nf(n) { try { return new Intl.NumberFormat('ko-KR').format(Math.round(Number(n) || 0)); } catch { return String(n); } }
function range(a, b) { const arr = []; for (let y = a; y <= b; y++) arr.push(y); return arr; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

/** 비용축 눈금(1–2–5 규칙) */
function getNiceStep(min, max, targetTicks = 6) {
	const range = Math.max(1, Math.abs(Number(max) - Number(min)));
	const raw = range / Math.max(1, targetTicks);
	const exp = Math.floor(Math.log10(raw));
	const base = raw / Math.pow(10, exp);
	let niceBase = (base <= 1) ? 1 : (base <= 2) ? 2 : (base <= 5) ? 5 : 10;
	return niceBase * Math.pow(10, exp);
}
function roundMinMaxToStep(min, max, step) {
	const s = Number(step) || 1;
	const nmin = Math.floor(min / s) * s;
	const nmax = Math.ceil(max / s) * s;
	return { min: nmin, max: nmax };
}

/** 컨텍스트 기본값(완전 빈 진입 시) */
function fallbackDefaultContext(root) {
	const urlp = new URLSearchParams(location.search);
	let from = parseInt(urlp.get('from') || String(NOW_YEAR), 10);
	let to   = parseInt(urlp.get('to')   || String(NOW_YEAR + HORIZON_YEARS), 10);
	if (!Number.isFinite(from)) from = NOW_YEAR;
	if (!Number.isFinite(to))   to   = from + HORIZON_YEARS;
	if (to < from) [from, to] = [to, from];
	if (to === from) to = from + HORIZON_YEARS;
	let builtYear = parseInt(urlp.get('builtYear') || String(from - 13), 10);
	if (!Number.isFinite(builtYear) || builtYear <= 0) builtYear = from - 13;
	return { from: String(from), to: String(to), builtYear };
}

/* 참고:
 * - getBuildingContext(), computeKpis(), decideStatusByScore(),
 *   startLoader(), ensureMinLoaderTime(), finishLoader(),
 *   SaveGreen.Forecast.renderModelAChart/BChart/calcChartAnimMs/makeEnsemble 등은
 *   다른 파일에서 제공되며, 본 파일에선 호출만 수행.
 */
