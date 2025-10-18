/* =========================
 * forecast.main.js (FINAL)
 * ========================= */

// 전역 카탈로그 경로 (정적 리소스 기준)
// - 에너지 카탈로그(샘플/더미) JSON을 한 번만 내려받아 세션 캐시에 보관
const CATALOG_URL = '/dummy/buildingenergydata.json';

window.SaveGreen = window.SaveGreen || {};
window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

// JS 켜짐 표시(헤더 스페이서 CSS 토글용) — header.html 수정 없이 JS가 직접 달아줌
document.documentElement.classList.add('js');


// 전역 clamp 폴리필(없으면 등록) — 수치 값을 [lo, hi] 구간에 강제
if (typeof window.clamp !== 'function') window.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* DOM 헬퍼(이 파일 전용) — jQuery 전역($)와 충돌 방지 */
const $el  = (s, root=document) => root.querySelector(s);
const $$el = (s, root=document) => Array.from(root.querySelectorAll(s));



/* ========== [STEP5] 카달로그 연결/세션 파싱/매칭 유틸 ========== */
(function () {
	'use strict';

	// 네임스페이스 보강(다른 모듈과 동일 경로 사용)
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

	// 내부 캐시(카탈로그 1회 로드 후 재사용)
	let _catalog = null;

	// 안전한 querySelector
	const qs = (s, r=document) => r.querySelector(s);

	// 공백/괄호/중복공백 정리(주소 비교 전 정규화)
	const _normalizeAddr = (s) => (s||'')
		.replace(/\s*\([^)]*\)\s*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	// 세션에서 값 꺼내기(그린파인더 → 시뮬레이터/포캐스트로 넘어온 값)
	// - 서로 다른 키 네이밍을 최대한 수용(보수적)
	function readSessionKeys() {
		const get = (k) => sessionStorage.getItem(k) || '';
		// 에너지 페이지에서 세팅한 키 이름을 최대한 보수적으로 수용
		const payload = {
			// 주소
			roadAddr: get('gf:roadAddr') || get('roadAddr') || '',
			jibunAddr: get('gf:jibunAddr') || get('jibunAddr') || '',
			// 좌표
			lat: parseFloat(get('gf:lat') || get('lat') || '') || null,
			lng: parseFloat(get('gf:lng') || get('lng') || '') || null,
			// 식별자(있을 수도/없을 수도)
			featureId: get('gf:featureId') || get('featureId') || '',
			buildingName: get('gf:buildingName') || get('buildingName') || ''
		};
		// 정규화된 주소(비교용)
		payload.norm = {
			road: _normalizeAddr(payload.roadAddr),
			jibun: _normalizeAddr(payload.jibunAddr)
		};
		return payload;
	}

	// 카달로그 1회 로드(fetch → 메모리 캐시)
	async function loadCatalogOnce() {
		if (_catalog) return _catalog;
		const res = await fetch(CATALOG_URL, { cache: 'no-store' });
		if (!res.ok) throw new Error('catalog fetch failed: ' + res.status);
		_catalog = await res.json();
		return _catalog;
	}

	// 반경(m) 내 좌표 매칭(빠른 근사 계산)
	function _isNear(a, b, radiusM=30) {
		if (!a || !b || a.lat==null || a.lng==null || b.lat==null || b.lng==null) return false;
		// 단순 근사(위도/경도 1도≈111,320m) — 소규모 반경 필터용
		const dx = (a.lng - b.lng) * 111320 * Math.cos(((a.lat+b.lat)/2) * Math.PI/180);
		const dy = (a.lat - b.lat) * 111320;
		return Math.hypot(dx, dy) <= radiusM;
	}

	// 카달로그 레코드 매칭
	// - 1순위: 도로/지번 완전 일치
	// - 2순위: 좌표 반경 내(30m)
	// - 3순위: 건물명 부분 포함
	function matchCatalogRecord(session, catalog) {
		if (!Array.isArray(catalog)) return null;
		const road = session.norm.road;
		const jibun = session.norm.jibun;

		let candidates = catalog;

		// 1) 도로/지번 완전 정규화 일치 우선
		if (road || jibun) {
			candidates = candidates.filter(it => {
				const itRoad = _normalizeAddr(it.roadAddr || '');
				const itJibun = _normalizeAddr(it.jibunAddr || '');
				return (road && itRoad && itRoad === road) || (jibun && itJibun && itJibun === jibun);
			});
		}

		// 2) 좌표 반경 매칭(필터가 너무 좁아졌으면 누적이 아니라 없을 때만 적용)
		if ((!candidates || candidates.length === 0) && (session.lat!=null && session.lng!=null)) {
			candidates = catalog.filter(it => _isNear(
				{ lat: session.lat, lng: session.lng },
				{ lat: parseFloat(it.lat), lng: parseFloat(it.lng) },
				30
			));
		}

		// 3) 건물명 부분 일치(최후)
		if (!candidates || candidates.length === 0) {
			const bname = (session.buildingName || '').trim();
			if (bname) {
				const lw = bname.toLowerCase();
				candidates = catalog.filter(it => (it.buildingName||'').toLowerCase().includes(lw));
			}
		}

		if (!candidates || candidates.length === 0) return null;
		// 복수면 첫 건(후속 버전에서 후보 UI 제공 가능)
		return candidates[0];
	}

	// 차트/헤더/칩에 뿌릴 “빌딩 컨텍스트” 문자열 생성
	// - 우선순위: 빌딩명 → 주소 → 용도
	function buildChartContextLine(rec) {
		// 빌딩명 → 주소 → 용도 (빌딩명 없으면 '건물명 없음')
		const name = (rec?.buildingName && String(rec.buildingName).trim()) || '건물명 없음';
		const addr = _normalizeAddr(rec?.roadAddr || rec?.jibunAddr || '');
		const use  = (rec?.useName || rec?.use || '').toString().trim();
		// 연결기호는 “ → ”
		const parts = [name];
		if (addr) parts.push(addr);
		if (use) parts.push(use);
		return parts.join(' → ');
	}

	// 프리로드 카드/칩 보강(이미 있는 렌더 유틸 호출/존재 시 갱신)
	function hydratePreloadUI(rec) {
		try {
			// 데이터 날짜 칩(파란 칩) — id는 기존 마크업에 맞춰 조정
			const dateEl = qs('#chipDataDate');
			if (dateEl && rec?.meta?.dataDate) dateEl.textContent = rec.meta.dataDate;

			// 건물 컨텍스트 카드/예측 가정 2줄은 기존 렌더러 호출(있다면)
			if (typeof window.renderPreloadInfoAndRisks === 'function') {
				// 내부에서 dataset/localStorage 기반으로 채우는 구조라면,
				// rec의 핵심값을 root.dataset에 반영해 두고 재호출
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
		} catch(e) {
			console.warn('[hydratePreloadUI] ', e);
		}
	}

	// 로더~차트 파이프라인(메인에서 수동/자동으로 호출)
	// - A → B → C 순서로 차트 렌더, 각 단계 사이 로더 라벨 동기화
	async function runRenderPipeline(rec) {
		try {
			// 로더 라벨/칩 등 동기화(선택)
			if (window.LOADER?.setModelName) window.LOADER.setModelName('Linear Regression');
			if (window.LOADER?.setStep) window.LOADER.setStep(1, '데이터 로딩');

			// 컨텍스트 라인을 차트 모듈에도 전달 → A/B/C 공통으로 사용
			const infoLine = buildChartContextLine(rec);
			if (window.SaveGreen?.Forecast) {
				window.SaveGreen.Forecast._chartContextText = infoLine;
			}

			// 스케일/정규화 (여기서는 더미 계산만, 모델과 연결되면 치환)
			if (window.LOADER?.setStep) window.LOADER.setStep(2, '정규화 / 스케일링');

			// 모델 피팅/예측 준비
			if (window.LOADER?.setStep) window.LOADER.setStep(3, '모델 피팅');

			// 차트 렌더 A → B → C (각 함수는 Promise 반환하도록 스텝4에서 구성됨)
			if (window.LOADER?.setStep) window.LOADER.setStep(4, '예측 / 검증');

			if (typeof window.renderModelAChart === 'function') {
				await window.renderModelAChart(rec);
			}
			if (typeof window.renderModelBChart === 'function') {
				await window.renderModelBChart(rec);
			}
			if (typeof window.renderEnergyComboChart === 'function') {
				await window.renderEnergyComboChart(rec);
			}

			// 완료
			if (window.LOADER?.setStep) window.LOADER.setStep(5, '차트 렌더링');
			if (typeof window.finishLoader === 'function') {
				await window.finishLoader();
			}
		} catch (e) {
			console.error('[runRenderPipeline] ', e);
		}
	}

	// 초기화: 세션→카달로그→매칭→프리로드 채움
	// - “시작하기” 버튼에서 runRenderPipeline 호출(자동 시작 백업 있음)
	async function initForecastStep5() {
		const session = readSessionKeys();
		let rec = null;
		try {
			const catalog = await loadCatalogOnce();
			rec = matchCatalogRecord(session, catalog);
			if (!rec) {
				console.warn('[catalog] no match from session; charts may use seed');
			}
			hydratePreloadUI(rec || {});
			// 차트 컨텍스트 라인(없어도 “건물명 없음”으로 구성)
			const infoLine = buildChartContextLine(rec || {});
			window.SaveGreen.Forecast._chartContextText = infoLine;
		} catch (e) {
			console.error('[initForecastStep5] ', e);
		}
		// 파이프라인 시작은 "시작하기" 버튼에서 호출(자동시작 백업도 존재)
		window.SaveGreen.Forecast._matchedRecord = rec || null;
	}

	// 외부에서 사용할 수 있게 노출
	window.SaveGreen.Forecast.initForecastStep5 = initForecastStep5;
	window.SaveGreen.Forecast.runRenderPipeline = runRenderPipeline;
})();



/* ---------- 고정 텍스트 ---------- */
const BANNER_TEXTS = {
	recommend: '연식과 향후 비용 리스크를 고려할 때, 리모델링을 권장합니다.',
	conditional: '일부 항목은 적정하나, 향후 효율과 수익성 검토가 필요합니다.',
	'not-recommend': '현재 조건에서 리모델링 효과가 제한적입니다.'
};


/* ---------- 예측 기간 상수(전역) ---------- */
const NOW_YEAR = new Date().getFullYear();
const HORIZON_YEARS = 10;


/* =========================================================================
 * Header Offset (자동 계산 버전)
 * -------------------------------------------------------------------------
 * 화면 상단을 겹치는 모든 바(헤더/네비 등)의 "실제 표시 높이"를 합산해서
 * CSS 변수 --header-height 에 반영하고, 본문(.wrap) 시작 패딩을 조정합니다.
 *
 * 규칙
 * - 대상: #menubar(헤더), nav.navbar(네비)  ← 필요 시 selector 추가
 * - 겹침으로 간주되는 경우만 합산: position:fixed 이거나 position:sticky && rect.top <= 0
 * - 숨김(display:none/visibility:hidden)은 제외
 * - 추가 여유 간격은 :root --header-extra-gap (기본 16px)
 *
 * 사용
 * - initHeaderOffset()에서 호출/바인딩하세요(리사이즈/스크롤/옵저버 반영).
 * - JS가 켜진 환경에서 .header-spacer 는 자동으로 숨겨 중복 여백을 방지합니다.
 * ========================================================================= */

function applyHeaderOffset() {
	const menubar = document.getElementById('menubar');
	const navbar	= document.querySelector('nav.navbar');
	const spacer	= document.querySelector('.header-spacer');
	const wrap		= document.querySelector('main.wrap');
	if (!wrap) return;

	// 추가 여유(px): :root --header-extra-gap (없으면 16)
	const rootCS = getComputedStyle(document.documentElement);
	const extra	= parseInt(rootCS.getPropertyValue('--header-extra-gap')) || 16;

	// 겹치는 바만 높이 포함 (fixed 또는 sticky 상태일 때만)
	const getBarH = (el) => {
		if (!el) return 0;
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
		const rect = el.getBoundingClientRect();
		const isFixed = cs.position === 'fixed';
		const isStickyNow = cs.position === 'sticky' && rect.top <= 0;
		return (isFixed || isStickyNow) ? Math.round(rect.height) : 0;
	};

	const baseH = getBarH(menubar) + getBarH(navbar);	// 실제 겹치는 높이 합계

	// 전역 CSS 변수 업데이트
	document.documentElement.style.setProperty('--header-height', baseH + 'px');

	// 본문 오프셋(헤더+네비 합 + 여유)
	const topPad = (baseH + extra) + 'px';
	wrap.style.paddingTop = topPad;

	// JS on이면 스페이서 중복 방지(완전 숨김), JS off면 동일 높이로 폴백
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

/**
 * 오프셋 초기화/바인딩
 * - resize/scroll/orientationchange에서 재계산
 * - 헤더/네비가 동적으로 높이 변할 때(축소/확장)도 잡도록 ResizeObserver 사용
 */
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

	// 헤더/네비 높이 변경 감지
	const menubar = document.getElementById('menubar');
	const navbar  = document.querySelector('nav.navbar');

	if (window.ResizeObserver) {
		const ro = new ResizeObserver(request);
		if (menubar) ro.observe(menubar);
		if (navbar)  ro.observe(navbar);
	}
}




/* ---------- Provider 쿼리 빌더 ---------- */
// - getBuildingContext → fetchForecast 간 URLSearchParams 구성
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

/* ==========================================================
 * 로딩 정보패널 & 시작 버튼(있으면 클릭/없으면 자동) — ★이번 패치 핵심★
 * - 초기 진입 시 '정보 패널'을 먼저 채우고 사용자가 시작을 명시적으로 누르도록 함
 * - 버튼이 없을 때는 하위호환(자동 시작)
 * ========================================================== */

/** 상태: idle(시작전)/running(로딩중)/complete(완료) → 진행바 명도/상태문 변경 */
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

/** ① 건물 컨텍스트 + ② 예측 가정(2줄) + ④ 리스크 배지 채우기
 *  - root.dataset 및 localStorage의 forecast.* 키를 읽어와 화면에 바인딩
 *  - 값이 비어 있으면 해당 li를 감춤
 */
function renderPreloadInfoAndRisks() {
	// 루트 엘리먼트 & 데이터 소스 헬퍼
	const root = document.getElementById('forecast-root');
	if (!root) return;
	const ds   = root.dataset || {};
	const ls   = (k) => localStorage.getItem('forecast.' + k) || '';
	const pick = (k) => (ds[k] || ls(k) || '').toString().trim();
	const numOk = (v) => v !== '' && !isNaN(parseFloat(v));

	/* -------------------------------------------------------
	 * ① 건물 컨텍스트 카드
	 *  - 값이 없으면 해당 li는 감춤(display:none)
	 * ----------------------------------------------------- */
	const bmap = {
		buildingName: pick('buildingName') || ds.bname || '',
		roadAddr:     pick('roadAddr') || pick('jibunAddr') || '',
		useName:      pick('use') || pick('useName') || '',
		builtYear:    pick('builtYear') || '',
		floorArea:    pick('area') || pick('floorArea') || '',
		pnu:          pick('pnu') || ''
	};
	// [수정] PNU는 사용자 혼란을 줄이기 위해 비노출 처리(값을 비워 li[data-k="pnu"] 자동 숨김)
	bmap.pnu = '';

	const box = document.getElementById('preload-building');
	if (box) {
		box.querySelectorAll('li[data-k]').forEach((li) => {
			const key = li.getAttribute('data-k');
			let val = bmap[key] || '';
			// 면적 표기 보정(숫자면 천단위 + 단위)
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

	/* -------------------------------------------------------
	 * ② 예측 가정(2줄)
	 *  - 1줄: 전력단가 · 상승률 · 할인율
	 *  - 2줄: (우선) 배출계수 · 효율개선  / (대안) 요금제 · 가동률
	 *    -> 값이 없으면 해당 줄은 자동 숨김
	 * ----------------------------------------------------- */
	// 1줄
	{
		const unit        = pick('unitPrice') || '기본';                 // 원/kWh 또는 '기본'
		const escalatePct = pick('tariffEscalationPct');                 // %
		const discountPct = pick('discountRatePct');                     // %

		const unitText = (unit === '기본') ? '기본(가정)' : `${unit}원/kWh`;
		const parts = [`전력단가 : ${unitText}`];
		if (numOk(escalatePct)) parts.push(`상승률 : ${parseFloat(escalatePct)}%/년`);
		if (numOk(discountPct)) parts.push(`할인율 : ${parseFloat(discountPct)}%/년`);

		const line1 = parts.join(' · ');
		const el1 = document.getElementById('assumption-line-1');
		if (el1) { el1.textContent = line1; el1.style.display = line1 ? '' : 'none'; }
	}

	// 2줄
	{
		const co2Factor   = pick('co2Factor');           // kgCO₂/kWh
		const effGainPct  = pick('efficiencyGainPct');   // %
		const tariffType  = pick('tariffType');          // 텍스트
		const utilPct     = pick('utilizationPct');      // %

		let parts2 = [];
		if (co2Factor || effGainPct) {
			// 우선안: 배출계수 · 효율개선
			if (co2Factor) parts2.push(`배출계수 : ${co2Factor} kgCO₂/kWh`);
			if (numOk(effGainPct)) parts2.push(`효율 개선 : ${parseFloat(effGainPct)}%`);
		} else if (tariffType || numOk(utilPct)) {
			// 대안: 요금제 · 가동률
			if (tariffType) parts2.push(`요금제 : ${tariffType}`);
			if (numOk(utilPct)) parts2.push(`가동률 : ${parseFloat(utilPct)}%`);
		}

		const line2 = parts2.join(' · ');
		const el2 = document.getElementById('assumption-line-2');
		if (el2) { el2.textContent = line2; el2.style.display = line2 ? '' : 'none'; }
	}

	/* -------------------------------------------------------
	 * ④ 리스크 배지
	 *  - 노후(20년↑), 면적 소형, 용도 미지정 간단 규칙
	 * ----------------------------------------------------- */
	{
		const wrap = document.getElementById('risk-badges');
		if (wrap) {
			wrap.innerHTML = '';
			const badges = [];
			const nowY = (typeof NOW_YEAR !== 'undefined') ? NOW_YEAR : new Date().getFullYear();

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
}

/* =========================================================================
   [STEP3] 에너지 카탈로그(JSON) 로드 & 매칭 유틸
   - loadCatalog(): /buildingenergydata.json fetch + sessionStorage 캐시
   - matchCatalogItem(ctx, list): PNU > 주소 > 좌표 순으로 매칭
   - applyCatalogHints(ctx): 프리로드 칩/가정 1·2줄에 힌트 반영(비어있을 때만)
   ========================================================================= */

// 문자열 정규화(주소 비교용): 공백/하이픈/괄호 제거, 소문자화
function _normStr(s) {
	if (!s) return '';
	return String(s)
		.replace(/\s+/g, '')
		.replace(/[-–—]/g, '')
		.replace(/[()]/g, '')
		.toLowerCase();
}

// 좌표 거리(대충, m 단위 근사) — 좌표 매칭 3순위
function _roughDistanceM(lat1, lon1, lat2, lon2) {
	if (![lat1, lon1, lat2, lon2].every(v => Number.isFinite(Number(v)))) return Infinity;
	const R = 6371000; // m
	const toRad = d => (Number(d) * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

// [A] 카탈로그 로더 (세션 캐시 사용)
async function loadCatalog() {
	const CACHE_KEY = 'catalog.cache.v1';
	try {
		const cached = sessionStorage.getItem(CACHE_KEY);
		if (cached) {
			const parsed = JSON.parse(cached);
			if (Array.isArray(parsed)) return parsed;
		}
		const res = await fetch(CATALOG_URL, { credentials: 'same-origin' });
		if (!res.ok) throw new Error('fetch failed: ' + res.status);
		const json = await res.json();
		if (!Array.isArray(json)) throw new Error('catalog is not array');
		sessionStorage.setItem(CACHE_KEY, JSON.stringify(json));
		return json;
	} catch (e) {
		console.warn('[catalog] load error:', e);
		return [];
	}
}

// [B] 매칭 — ctx(현재 페이지 컨텍스트)와 카탈로그 레코드 매핑
function matchCatalogItem(ctx, list) {
	if (!ctx || !Array.isArray(list) || !list.length) return null;

	// ctx에서 비교키 뽑기
	const pnu = (ctx.pnu || '').trim();
	const ra  = (ctx.roadAddr || ctx.roadAddress || '').trim();
	const ja  = (ctx.jibunAddr || '').trim();
	const bn  = (ctx.buildingName || '').trim();
	const lat = Number(ctx.lat);
	const lon = Number(ctx.lon);

	// 1) PNU 완전일치
	if (pnu) {
		const byPnu = list.find(it => String(it.pnu || '').trim() === pnu);
		if (byPnu) return byPnu;
	}

	// 2) 주소 정규화 일치(도로명/지번)
	const raN = _normStr(ra);
	const jaN = _normStr(ja);
	if (raN || jaN) {
		const byAddr = list.find(it => {
			const itRaN = _normStr(it.roadAddr || it.roadAddress);
			const itJaN = _normStr(it.jibunAddr);
			return (raN && itRaN && raN === itRaN) || (jaN && itJaN && jaN === itJaN);
		});
		if (byAddr) return byAddr;
	}

	// 3) 좌표 근접(<= 120m)
	if (Number.isFinite(lat) && Number.isFinite(lon)) {
		let best = null, bestD = Infinity;
		for (const it of list) {
			const d = _roughDistanceM(lat, lon, Number(it.lat), Number(it.lon));
			if (d < bestD) { best = it; bestD = d; }
		}
		if (best && bestD <= 120) return best;
	}

	// 4) 느슨한 빌딩명(있을 때만)
	if (bn) {
		const bnN = _normStr(bn);
		const byBn = list.find(it => _normStr(it.buildingName) === bnN);
		if (byBn) return byBn;
	}

	return null;
}

// [C] 프리로드 칩/가정 1·2줄 힌트 반영(이미 값 있으면 유지)
function applyCatalogHints(ctx) {
	if (!ctx || !ctx.catalog) return;

	// 데이터 기간 칩(있으면 업데이트, 없으면 생성)
	try {
		const wrap = document.querySelector('.chips'); // 기존 칩 컨테이너
		const { period } = ctx.catalog || {};
		if (wrap && period && period.startYear && period.endYear) {
			let chip = document.getElementById('chip-data-period');
			const label = `데이터 기간`;
			const value = `${period.startYear}–${period.endYear}`;
			if (!chip) {
				chip = document.createElement('div');
				chip.className = 'chip';
				chip.id = 'chip-data-period';
				chip.innerHTML = `
					<span class="dot">●</span>
					<strong>${label}</strong>
					<span>${value}</span>
				`;
				wrap.appendChild(chip);
			} else {
				// 비어있으면만 갱신
				const last = chip.querySelector('span:last-of-type');
				if (last && !last.textContent.trim()) last.textContent = value;
			}
		}
	} catch (e) {
		console.warn('[catalog] chip update skipped:', e);
	}

	// 예측 가정 1·2줄(값이 없을 때만 보강)
	const line1 = document.getElementById('assumption-line-1');
	const line2 = document.getElementById('assumption-line-2');

	// line1: 전력단가(힌트)
	if (line1 && !line1.textContent.trim()) {
		const unit = ctx.catalog?.energy?.unit; // 예: 'kWh' 또는 '원/kWh' 등
		if (unit) line1.textContent = `전력단가: 기본(가정) · 단위: ${unit}`;
	}

	// line2: 기간 재확인(없을 때만)
	if (line2 && !line2.textContent.trim()) {
		const { period } = ctx.catalog || {};
		if (period?.startYear && period?.endYear) {
			line2.textContent = `데이터 기간: ${period.startYear}–${period.endYear}`;
		}
	}
}


/** 버튼 있으면 클릭으로 시작, 없으면 자동 시작(하위호환)
 *  - 시작 전 상태 패널을 채우고, 사용자가 명시적으로 실행하도록 UX 개선
 */
function wireStartButtonAndFallback() {
	const btn = document.getElementById('forecast-start');

	// 시작 전 상태 + 정보 패널 채움
	setPreloadState('idle');
	renderPreloadInfoAndRisks();

	if (btn) {
		btn.addEventListener('click', () => {
			setPreloadState('running');      // 게이지 진행 직전
			runForecast().catch(e => console.error('[forecast] run failed:', e));
		});
	} else {
		// 버튼이 없는 페이지는 기존처럼 자동 시작
		setPreloadState('running');
		runForecast().catch(e => console.error('[forecast] run failed:', e));
	}
}

/* ---------- 초기화 ---------- */
// - 헤더 오프셋/컨텍스트 부트스트랩/주소창 파싱/VWorld 보강/빌딩카드/버튼 결선/메타칩
async function init() {
	initHeaderOffset();

	const root = document.getElementById('forecast-root');

	// Forecast 컨텍스트: localStorage 키 표준(읽기 전용)
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

	// localStorage → dataset 부트스트랩(그린 파인더가 저장해 준 값을 Forecast에서 소비)
	function bootstrapContextFromStorage(rootEl) {
		if (!rootEl) return;
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

		// dataset 주입(이미 값이 있으면 덮지 않음: 페이지/URL 우선 로직 보존)
		if (ctx.pnu && !rootEl.dataset.pnu) rootEl.dataset.pnu = ctx.pnu;
		if (ctx.builtYear && !rootEl.dataset.builtYear) rootEl.dataset.builtYear = ctx.builtYear;
		if (ctx.floorArea && !rootEl.dataset.area) rootEl.dataset.area = ctx.floorArea;
		if (ctx.useName && !rootEl.dataset.use) rootEl.dataset.use = ctx.useName;

		// 건물명: 기존 키(bname)와 신규 키(buildingName) 모두 대응
		if (ctx.buildingName) {
			if (!rootEl.dataset.bname) rootEl.dataset.bname = ctx.buildingName;
			if (!rootEl.dataset.buildingName) rootEl.dataset.buildingName = ctx.buildingName;
		}
		if (ctx.roadAddr && !rootEl.dataset.roadAddr) rootEl.dataset.roadAddr = ctx.roadAddr;
		if (ctx.jibunAddr && !rootEl.dataset.jibunAddr) rootEl.dataset.jibunAddr = ctx.jibunAddr;
		if (ctx.lat && !rootEl.dataset.lat) rootEl.dataset.lat = ctx.lat;
		if (ctx.lon && !rootEl.dataset.lon) rootEl.dataset.lon = ctx.lon;

		try {
			console.log('[forecast] ctx from storage →', {
				pnu: ctx.pnu, builtYear: ctx.builtYear, floorArea: ctx.floorArea,
				useName: ctx.useName, buildingName: ctx.buildingName
			});
		} catch {}
	}

	// 1) 스토리지 기반 컨텍스트 부트스트랩
	bootstrapContextFromStorage(root);

	/* 세션스토리지(그린파인더) → data-* Fallback 주입 (+출처 플래그 session)
	 * - dataset에 값이 비어 있을 때만 주입
	 * - 출처 추적을 위해 keyFrom='session' 메타도 함께 기록
	 */
	{
		const root = document.getElementById('forecast-root');
		if (root) {
			const sget = (k) => (sessionStorage.getItem(k) || '').toString().trim();

			// 그린파인더가 남겨주는 값들 (없으면 빈 문자열)
			const ldCodeNm = sget('ldCodeNm');   // 예: 대전광역시 대덕구 대화동
			const mnnmSlno = sget('mnnmSlno');   // 예: 123-45 (지번 본번-부번)
			const lat      = sget('lat');        // 선택 지점 위도
			const lon      = sget('lon');        // 선택 지점 경도
			const pnu      = sget('pnu');        // [NEW] PNU(스샷 hidden input)
			const bname    = sget('buildingName') || sget('buldNm') || ''; // [NEW] 건물명(있으면)

            // ✨ [추가] 세션→dataset 전용: builtYear 계산(세션 builtYear 우선, 없으면 useConfmDe 앞 4자리)
            // ⚠ Forecast에서는 sessionStorage "읽기만" 한다(쓰기 금지)
            const builtYear = (() => {
                const by = (sessionStorage.getItem('builtYear') || '').trim();
                if (/^\d{4}$/.test(by)) return by;
                const u = (sessionStorage.getItem('useConfmDe') || '').trim();
                return (/^\d{4}/.test(u) ? u.slice(0, 4) : '');
            })();


			// 지번 주소 문자열 구성 (둘 다 있을 때만)
			const jibun = [ldCodeNm, mnnmSlno].filter(Boolean).join(' ');

			// 이미 data-*가 있으면 건드리지 않고, 비어있을 때만 세션 값으로 채움
			const setIfEmpty = (key, val, fromKey) => {
				if (!root.dataset[key] && val) {
					root.dataset[key] = val;
					root.dataset[key + 'From'] = fromKey; // 출처 표시: 'session'
				}
			};

			setIfEmpty('jibunAddr', jibun, 'session');
			setIfEmpty('lat', lat, 'session');
			setIfEmpty('lon', lon, 'session');
			setIfEmpty('pnu', pnu, 'session');                  // PNU 주입
			setIfEmpty('buildingName', bname, 'session');       // 건물명 주입
			setIfEmpty('builtYear', builtYear, 'session');      // 연식 주입

			// 사용상 편의를 위해 'addr' 헬퍼도 만들어줌(없을 때만)
			if (!root.dataset.addr && (root.dataset.roadAddr || root.dataset.jibunAddr)) {
				root.dataset.addr = root.dataset.roadAddr || root.dataset.jibunAddr;
				root.dataset.addrFrom = root.dataset.roadAddr ? 'dataset' : 'session';
			}
		}
	}

	// 2) 주소창 → data-* Fallback 주입(쿼리스트링이 있으면 우선)
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

	console.log('[forecast] dataset', {
		from: root?.dataset.from,
		to: root?.dataset.to,
		builtYear: root?.dataset.builtYear,
		pnu: root?.dataset.pnu,
		bid: root?.dataset.bid
	});

	// [추가] VWorld 기반 컨텍스트 보강: 도로명 주소/건물명 채우기
	// - providers.enrichContext(ctx)를 호출해 부족한 필드만 채움
	// - renderBuildingCard()/wireStartButtonAndFallback() 이전에 수행해야
	//   프리로드 카드와 차트 부제에 즉시 반영됨
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

		// dataset에 '비어 있을 때만' 보강 결과를 주입(우선순위 규칙 준수)
		const setIfEmpty = (k, v) => { if (!root.dataset[k] && v) root.dataset[k] = String(v); };

		// [추가] 건물명/도로명/지번 주소 주입(있을 때만)
		setIfEmpty('buildingName', enriched?.buildingName);
		setIfEmpty('roadAddr', enriched?.roadAddr);
		setIfEmpty('jibunAddr', enriched?.jibunAddr);
	}

	// 3) 페이지 상단의 빌딩 카드(결과 섹션 아님) 렌더
	renderBuildingCard();

	// 4) [변경 포인트] 자동 실행 대신 버튼/폴백시 실행
	wireStartButtonAndFallback();

	// 메타 패널 기간 칩(상단 표시) 초기화
	primeMetaRangeFromDataset();   // 상단 '데이터' 칩에 2025–2035 같은 기간 표시
}

// 2) init() 완료 직후 적용 — 가정 라인 스타일링 보정
document.addEventListener('DOMContentLoaded', () => {
	init()
		.then(() => {
			styleAssumptionLines();
		})
		.catch(err => console.error('[forecast] init failed:', err));
});


/* ==========================================================
 * 실제 예측 시퀀스(기존 init 실행 파트 그대로)
 *  - 로더 시작 → 컨텍스트 확보 → 데이터 로드/보정 → 메타패널 업데이트
 *  - KPI/상태 판정 → 로더 종료 → ABC 차트 시퀀스 → 결과 요약 렌더
 * ========================================================== */

// -------------------------------------------------------------
// 계산 가정 주입 헬퍼
// - dataset(표시용)을 비어있을 때만 채우고,
// - 실제 계산용 숫자는 window.__FORECAST_ASSUMP__ 에 넣어준다.
//   (forecast.kpi.js 등 모델 계산부에서 이 값을 읽어 사용)
// -------------------------------------------------------------
function applyAssumptionsToDataset(rootEl, ctx) {
    const ds = (rootEl?.dataset) || {};
    const base = ctx?.daeBase || {};

    // 1) 표시용(dataset) – 비어있을 때만 채움(문자열)
    if (!ds.unitPrice) {
        ds.unitPrice = String(base.unitPrice ?? base.tariff?.unit ?? '');   // 예: "145"
    }
    if (!ds.tariffEscalationPct) {
        const v = base.tariffEscalationPct ?? base.tariff?.escalationPct;
        if (v != null) ds.tariffEscalationPct = String(v);                  // 예: "3"
    }
    if (!ds.discountRatePct) {
        const v = base.discountRatePct ?? base.discount?.ratePct;
        if (v != null) ds.discountRatePct = String(v);                      // 예: "13"
    }

    // 2) 계산용 숫자 – 항상 안전한 값으로 셋업
    window.__FORECAST_ASSUMP__ = {
        // 전력단가(원/kWh 등)
        tariffUnit: toNum(ds.unitPrice, base.unitPrice ?? base.tariff?.unit ?? 145),
        // 단가상승률(% → 0~1)
        tariffEscalation: toPct(ds.tariffEscalationPct, base.tariffEscalationPct ?? base.tariff?.escalationPct ?? 3),
        // 할인율(% → 0~1)
        discountRate: toPct(ds.discountRatePct, base.discountRatePct ?? base.discount?.ratePct ?? 13)
    };

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

// =============================================================
// runForecast (교체 버전)
// =============================================================
async function runForecast() {
    const $result  = $el('#result-section');
    const $ml      = $el('#mlLoader');
    const $surface = $el('.result-surface');

    // 로더 시작
    show($ml);
    hide($result);
    startLoader();

    /* 컨텍스트 확보 (실패 시 더미로 폴백) */
    let ctx, useDummy = false;
    const root = document.getElementById('forecast-root');

    try {
        // 1) 컨텍스트 수집 (page → local → url → vworld)
        ctx = await getBuildingContext();

        // 2) 컨텍스트 보강: 좌표/pnu만 있을 때 주소·건물명 보충
        try {
            const P = window.SaveGreen?.Forecast?.providers;
            if (P && typeof P.enrichContext === 'function') {
                ctx = await P.enrichContext(ctx) || ctx;
            }
        } catch (e) {
            console.warn('[forecast] enrich skipped:', e);
        }

        // 3) 타입 결정 + dae.json 로드 + 기본가정(base) 추출
        try {
            const F = window.SaveGreen?.Forecast || {};

            // 3-1) 타입 결정 (우선순위: pickTypeFromContext → mapUseNameToType → 저장값 → 'office')
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
            if (!mappedType) mappedType = 'office'; // 최종 안전 기본값

            // 3-2) dae.json 로드 & 타입별 base 가정 추출
            const dae  = (typeof F.loadDaeConfig === 'function') ? await F.loadDaeConfig() : null;
            let base   = (dae && typeof F.getBaseAssumptions === 'function')
                ? F.getBaseAssumptions(dae, mappedType)
                : null;

            // 타입 키가 어긋났을 때 office로 한 번 더 시도
            if (!base && mappedType !== 'office' && dae && typeof F.getBaseAssumptions === 'function') {
                base = F.getBaseAssumptions(dae, 'office');
            }

			// 3-3) 컨텍스트에 보관
			ctx.mappedType = mappedType;
			ctx.daeBase    = base || null;

			// [추가]
			// 3-3.5) euiRules 보관(등급/요약 계산용). 전역에도 얹어 타 모듈 접근 허용.
			try {
				if (dae && typeof F.getEuiRules === 'function') {
					ctx.euiRules = F.getEuiRules(dae);
					window.SaveGreen.Forecast._euiRules = ctx.euiRules;
				}
			} catch {}


            // 3-4) 표시용(dataset) 보강 + 계산용 숫자 주입
            applyAssumptionsToDataset(root, ctx);

            // 3-5) 로더 라벨(정보성)
            try {
                if (window.LOADER && ctx.mappedType) {
                    const labelMap = { factory:'제조/공장', school:'교육/학교', hospital:'의료/병원', office:'업무/오피스' };
                    window.LOADER.setStatus(`예측 가정: ${labelMap[ctx.mappedType] || ctx.mappedType}`);
                }
            } catch {}

            console.info('[forecast] mappedType=', ctx.mappedType, 'base=', ctx.daeBase);
        } catch (e) {
            console.warn('[forecast] dae.json/base inject skipped:', e);
        }

        console.info('[forecast] ctx =', ctx);
    } catch (e) {
        console.warn('[forecast] no context → fallback to dummy', e);
        ctx = fallbackDefaultContext(root);
        useDummy = true;
        // 더미에도 계산 가정 기본 셋팅
        applyAssumptionsToDataset(root, ctx);
    }

    // [STEP3] 카탈로그 로드 → 매칭 → UI 힌트 반영
    try {
        const catalogList = await loadCatalog();
        const matched = matchCatalogItem(ctx, catalogList);
        ctx.catalog = matched || null;

        if (matched) {
            // 프리로드 칩/가정 텍스트 보강(이미 값 있으면 유지)
            applyCatalogHints(ctx);
        }
    } catch (e) {
        console.warn('[STEP3] catalog pipeline error:', e);
    }

    // 데이터 로드(실제 API 또는 더미)
    const data = useDummy ? makeDummyForecast(ctx.from, ctx.to) : await fetchForecast(ctx);
    window.FORECAST_DATA = data;

    // 길이/타입 강제 정렬 + 누락 보정(Forward-fill)
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

    // 메타패널(기간/모델/특징)
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

    // KPI/판정 계산 → 등급/배너 업데이트
    const floorArea = Number(ctx?.floorArea ?? ctx?.area);
    const kpi = computeKpis({
        years: data.years,
        series: data.series,
        cost: data.cost,
        kpiFromApi: data.kpi,
        base: ctx.daeBase || null,                    // { tariff, capexPerM2, savingPct ... }
        floorArea: Number.isFinite(floorArea) ? floorArea : undefined
    });

    // [수정]
    // 등급 산정: dae.json의 euiRules가 있으면 EUI로, 없으면 기존(절감률) 폴백
    const euiRules = ctx.euiRules || window.SaveGreen?.Forecast?._euiRules || null;
    const euiNow   = computeCurrentEui(data, Number(ctx?.floorArea ?? ctx?.area));
    let gradeNow   = null;
    if (euiRules && euiNow != null) {
        gradeNow = pickGradeByRules(euiNow, euiRules);
    }
    // 폴백: 룰/면적 부재 시 기존 간이판정
    if (gradeNow == null) {
        gradeNow = (kpi.savingPct >= 30) ? 1 : (kpi.savingPct >= 20) ? 2 : (kpi.savingPct >= 10) ? 3 : 4;
    }


    const builtYear = Number(document.getElementById('forecast-root')?.dataset.builtYear) || Number(ctx?.builtYear);
    const statusObj = decideStatusByScore(kpi, { builtYear });
    applyStatus(statusObj.status);

    // 로더 종료(시각적으로 100%까지 보이도록 최소 시간 보장 후 종료)
    await ensureMinLoaderTime();
    await finishLoader();
    hide($ml);
    show($result);
    if ($surface) hide($surface);

    // ABC 순차 실행(완료 후 KPI/요약 렌더 및 서피스 페이드 인)
    await runABCSequence({
        ctx,
        baseForecast: data,
        onCComplete: () => {
            renderKpis(kpi, { gradeNow });
            renderSummary({ gradeNow, kpi, rules: euiRules, euiNow });

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

    // 완료 상태
    setPreloadState('complete');
}




// rAF 보조(폴리필)
function $requestAnimationFramePoly(cb) {
	if (window.requestAnimationFrame) return window.requestAnimationFrame(cb);
	return setTimeout(cb, 16);
}

/* ==========================================================
 * ABC 직렬 시퀀스 (기존 렌더러 호출 유지)
 * - 모델 A/B 출력 혹은 폴백 → 각 차트 렌더 → C는 실제 시계열 바/라인 콤보
 * ========================================================== */
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
		? F.calcChartAnimMs : (() => (n * (600 + 120) + 200 + n * (240 + 90) + 50)); // 안전 기본값

	// 단계 사이에 추가 머무는 시간(리뷰 요청: 2~3초)
	const EXTRA_STAGE_HOLD_MS = 3000;

	/* ----- 비용축 범위(모든 단계 공통) ----- */
	// - C에서 산정한 yCost 스케일을 A/B에도 넘겨서 시각적 일관성 확보
	const costArr = Array.isArray(baseForecast?.cost?.saving) ? baseForecast.cost.saving.slice(0, n) : [];
	let cmax = -Infinity;
	for (const v of costArr) {
		const x = Number(v);
		if (Number.isFinite(x) && x > cmax) cmax = x;
	}
	if (!Number.isFinite(cmax)) cmax = 1;
	const cmin = 0;

	// 동적 step + step 기준으로 max를 반올림(눈금 깔끔)
	const step = getNiceStep(cmin, cmax, 6);
	const rounded = roundMinMaxToStep(cmin, cmax, step);
	const costRange = { min: cmin, max: rounded.max, step };

	/* ----- 모델 or 폴백 ----- */
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
			console.warn('[forecast] model error, fallback', id, e);
		}
		// 간단 3점 평균 폴백(기존 의도 유지)
		const src = Array.isArray(baseForecast?.series?.after) ? baseForecast.series.after.slice(0, n) : new Array(n).fill(0);
		const yhat = src.map((v, i, a) => Math.round(((Number(a[i-1] ?? v)) + Number(v) + Number(a[i+1] ?? v)) / 3));
		return { model: { id, version: 'fallback' }, years: years.slice(), yhat };
	}

	/* ----- A ----- */
	const A = modelOrFallback('A');
	await renderModelAChart?.({ years: A.years, yhat: A.yhat, costRange });
	await sleep(EXTRA_STAGE_HOLD_MS);

	/* ----- B ----- */
	const B = modelOrFallback('B');
	await renderModelBChart?.({ years: B.years, yhat: B.yhat, costRange });
	await sleep(EXTRA_STAGE_HOLD_MS);

	/* ----- C ----- */
	try { if (makeEnsemble) void makeEnsemble([A, B]); } catch {}

	// 차트 부제: buildingName → roadAddr → jibunAddr 우선
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

// 차트 부제 결정(빌딩명/주소 중 하나라도 있으면 사용)
function resolveChartSubtitle(rootEl) {
	if (!rootEl) return '';
	const ds = rootEl.dataset || {};
	return ds.buildingName || ds.bname || ds.roadAddr || ds.jibunAddr || '';
}

/* ---------- Data ---------- */
// 더미 예측 데이터 생성(서버 실패/빈 컨텍스트일 때 폴백)
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

// 실제 예측 API 호출(fetch) — 실패 시 더미로 폴백
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
		console.error('[forecast] fetch failed, using fallback dummy:', e);
		return makeDummyForecast(lo, hi);
	}
}

// 서버 응답 정규화(누락/타입 보정 포함)
function normalizeForecast(d, fallbackYears) {
	const years = Array.isArray(d?.years) ? d.years.map(String) : fallbackYears.map(String);
	const L = years.length;

	// Forward-fill 보정
	const after   = toNumArrFFill(d?.series?.after,   L);
	const saving = toNumArrFFill(d?.series?.saving, L);
	const cost   = { saving: toNumArrFFill(d?.cost?.saving, L) };
	const kpi   = d?.kpi ?? null;

	return { years, series: { after, saving }, cost, kpi };
}

// [추가]
// ---------- EUI 룰 기반 등급/경계 유틸 ----------
function pickGradeByRules(euiSite, rules) {
	if (!rules || !Number.isFinite(euiSite)) return null;
	const mode = (rules.mode || 'electricity').toLowerCase();

	if (mode === 'electricity') {
		const th = rules.electricityGradeThresholds || {};
		const g1 = Number(th['1']), g2 = Number(th['2']), g3 = Number(th['3']);
		if (Number.isFinite(g1) && euiSite <= g1) return 1;
		if (Number.isFinite(g2) && euiSite <= g2) return 2;
		if (Number.isFinite(g3) && euiSite <= g3) return 3;
		return 4; // 확장 여지
	}

	// mode === 'primary' : 1차 에너지 밴드 매칭
	const pef = Number(rules?.pef?.electricity);
	const euiPrimary = Number.isFinite(pef) ? euiSite * pef : euiSite;
	const bands = Array.isArray(rules.primaryGradeBands) ? rules.primaryGradeBands : [];
	for (const b of bands) {
		const min = Number(b.min), max = Number(b.max);
		if (Number.isFinite(min) && Number.isFinite(max) && euiPrimary >= min && euiPrimary < max) {
			const g = (b.grade || '').toString().trim();
			return g || null; // 문자열 등급(예: "1++")
		}
	}
	return null;
}

// [추가]
// 목표 등급의 경계(EUI 또는 1차EUI) — 요약 문구용
function getBoundaryForGrade(targetGrade, rules) {
	if (!rules) return null;
	const mode = (rules.mode || 'electricity').toLowerCase();

	if (mode === 'electricity') {
		const th = rules.electricityGradeThresholds || {};
		const key = String(targetGrade ?? '');
		if (th[key] != null) return { value: Number(th[key]), unit: 'kWh/m²/년', kind: 'site' };
		return null;
	}

	const bands = Array.isArray(rules.primaryGradeBands) ? rules.primaryGradeBands : [];
	const target = bands.find(b => String(b.grade) === String(targetGrade));
	if (target && Number.isFinite(target.max)) {
		return { value: Number(target.max), unit: 'kWhₚ/m²/년', kind: 'primary' };
	}
	return null;
}

// [추가]
// 현재 EUI 계산 (마지막 after / 면적)
function computeCurrentEui(data, floorArea) {
	if (!Array.isArray(data?.series?.after) || !Number.isFinite(floorArea) || floorArea <= 0) return null;
	const afterArr = data.series.after;
	const last = Number(afterArr[afterArr.length - 1]);
	if (!Number.isFinite(last) || last <= 0) return null;
	return Math.round(last / floorArea);
}


/* ---------- KPI/요약/상태 ---------- */
function estimateEnergyGrade(savingPct) {
	if (savingPct >= 30) return 1;
	if (savingPct >= 20) return 2;
	if (savingPct >= 10) return 3;
	return 4;
}

// 상태 배너/루트 결과에 추천/조건부/비추천 클래스 적용 + 메시지 텍스트 갱신
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

// 상단 메타 패널(기간/모델/특징) 텍스트 갱신
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

// KPI 수치판 렌더
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

// [수정]
// 요약 리스트 렌더(등급/EUI 경계/필요 절감률 등) — dae.json euiRules 기반
function renderSummary({ gradeNow, kpi, rules, euiNow }) {
	const ul = $el('#summary-list');
	if (!ul) return;
	ul.innerHTML = '';

	// 목표 등급: 숫자면 -1 (예: 3 → 2등급 목표), 문자열 등급(예: "1++")이면 상위 등급 텍스트로 대체
	let targetGradeText, boundary = null;
	if (typeof gradeNow === 'number') {
		const targetGradeNum = Math.max(1, gradeNow - 1);
		targetGradeText = `${targetGradeNum}등급`;
		boundary = getBoundaryForGrade(targetGradeNum, rules);
	} else {
		targetGradeText = '상위 등급';
	}

	// 현재/경계 EUI와 필요 절감률 계산
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
		// 폴백: 기존 절감률 기반 대략치
		needSavingPct = Math.max(0, 100 - kpi.savingPct);
	}

	const lines = [];
	lines.push(`현재 등급 : <strong>${(typeof gradeNow === 'number') ? `${gradeNow}등급` : String(gradeNow)}</strong>`);
	lines.push(`목표 : <strong>${targetGradeText}</strong>`);
	if (boundaryText !== '-') {
		lines.push(`등급 상승 기준(EUI 경계값) : <strong>${boundaryText}</strong>`);
	}
	if (Number.isFinite(euiNow)) {
		lines.push(`추정 현재 EUI : <strong>${currentEuiText}</strong>`);
	}
	lines.push(`등급 상승 필요 절감률 : <strong>${needSavingPct}%</strong>`);

	lines.forEach((html) => {
		const li = document.createElement('li');
		li.innerHTML = html;
		ul.appendChild(li);
	});
}


// 페이지 상단 '건물 정보' 카드(카탈로그/컨텍스트 보조 정보)
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

/* ---------- 유틸 ---------- */
//// EUI 기준(등급별 경계값) — 정책표
//function euiRefForGrade(grade) {
//	const map = { 1: 120, 2: 160, 3: 180, 4: 200, 5: 220 };
//	return map[grade] ?? 180;
//}

// 누락값을 0 대신 직전값으로 채우는 보정(Forward-fill)
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

// 상단 메타 기간 칩을 dataset 기반으로 표시
function primeMetaRangeFromDataset() {
	const root = document.getElementById('forecast-root');
	if (!root) return;
	const from = root.dataset.from || new Date().getFullYear();
	const to   = root.dataset.to   || (new Date().getFullYear() + 10);
	const el = document.getElementById('meta-data-range');
	if (el) el.textContent = (String(from) === String(to)) ? `${from}년` : `${from}–${to}`;
}

// 1) 헬퍼 (한 번만 정의) — 가정 라인 텍스트 꾸밈
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


/* ---------- Helpers ---------- */
function nf(n) { try { return new Intl.NumberFormat('ko-KR').format(Math.round(Number(n) || 0)); } catch { return String(n); } }
function range(a, b) { const arr = []; for (let y = a; y <= b; y++) arr.push(y); return arr; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

/* 비용축 눈금 헬퍼 — 차트 스케일을 깔끔하게 만들기 위한 1–2–5 규칙 */
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

/* /forecast 빈 진입 등 컨텍스트가 전혀 없을 때의 기본값 생성
 * - 주소/스토리지/세션이 모두 비어 있을 경우 사용
 */
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

/* ---------- 기존 프로젝트 제공 함수(호출만 사용) ----------
 * - getBuildingContext(), computeKpis(), decideStatusByScore(),
 *   startLoader(), ensureMinLoaderTime(), finishLoader(),
 *   SaveGreen.Forecast.renderModelAChart/BChart/calcChartAnimMs/makeEnsemble 등
 *   : 본 파일에서는 "호출"만 하며, 구현은 기존 코드/다른 파일에 있음.
 * --------------------------------------------------------- */
