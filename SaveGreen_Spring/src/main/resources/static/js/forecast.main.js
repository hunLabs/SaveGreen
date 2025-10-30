/**
 * ============================================================
 * SaveGreen / forecast.main.js — 화면 진입부터 결과 노출까지 전체 흐름(설계 주석)
 * ------------------------------------------------------------
 * [역할 요약]
 * - Forecast 화면의 메인 오케스트레이터 파일.
 * - 컨텍스트 수집(getBuildingContext) → 가정 주입(dae.json) → 데이터 로드(서버/더미) →
 *   ML KPI 호출/정합 → KPI·등급·요약·배너 렌더 → 차트 A/B/C 순차 재생까지 담당.
 *
 * [데이터/우선순위 규칙]
 * 1) 면적(floorAreaM2) 등 기본 컨텍스트는 아래 순서로 "최신값 우선" 픽:
 *    - dataset(data-*; UI 최신 입력) → sessionStorage(최근 저장) → catalog(JSON) → ctx(기본).
 *    - pickAreaM2(ctx) + forceFloorAreaByPriority()에서 강제 확정하여 이후 계산의 단일 소스로 사용.
 *
 * 2) 타입(코어타입: factory/school/hospital/office) 확정:
 *    - catalog.type(영문)이 존재하면 최우선 강제 확정(공장/병원 등 한글 매핑보다 우선).
 *    - 미해결이어도 파이프라인은 진행하되, dae.json 가정은 타입 미확정 시 단가를 비움.
 *
 * 3) EUI(절감 전, kWh/㎡·년) 계산:
 *    - baselineKwh(최근연도 전력사용량) / floorAreaM2.
 *    - baselineKwh의 소스는 (카탈로그 최근연도) → (서버 series.baseline[0]) → (after[0] & savingPct 역산) → (dataset 힌트) 순.
 *    - 계산 결과는 전역 window.__EUI_NOW 로 저장(렌더/요약에서 사용).
 *
 * 4) 서버 결과 신뢰/정합(harmonizeSavingWithMl_Safe):
 *    - 서버가 series.saving(kWh) & cost.saving(원)을 제공하면 그대로 신뢰(덮어쓰기 금지).
 *    - 부족할 때만 최소한의 보정(단가×kWh, Forward-fill).
 *    - KPI(절감률/절감kWh/절감비용/회수기간)는 ‘첫 해 기준’으로 정렬.
 *      회수기간이 0/NaN이면 computePaybackYears 폴백값 사용.
 *      savingPct는 실무 범위(5–40%)로 가드(클램프).
 *
 * 5) KPI·등급·요약·배너:
 *    - computeKpis(): 서버 KPI를 우선 사용(USE_API_KPI=true 흐름).
 *    - 등급 산정은 euiRules(primaryGradeBands/electricityGradeThresholds) 우선.
 *      규칙 min ≤ eui < max(마지막 밴드는 max 포함). 문자 등급('1++')도 안전 처리.
 *    - 목표 등급(한 단계 상향) = 현재 등급의 "바로 위" 밴드. 이미 최상위(예: '1+++' 또는 grade=1)면 '최고 등급'으로 표기.
 *    - 배너 상태는 서버 KPI를 반영한 decideStatusByScore() 결과를 그대로 수용.
 *
 * 6) 차트 A/B/C 시퀀스:
 *    - runABCSequence() 내에서 A→B→C 순차 재생.
 *    - C 완료 시 KPI 카드/요약/배너 최종 노출.
 *
 * [안전/유지보수 가이드]
 * - “동작 보장”을 위해 로직 변경 대신 “주석 추가/정렬”만 수행(이 파일은 기능 정상 동작 중).
 * - 검색 포인트(함수명) 위에 주석 블록을 추가하는 방식으로 가독성/유지보수성 개선.
 * - 기존에 주석으로 비활성화된 코드는 그대로 보존(삭제 금지).
 *
 * [디버깅 팁]
 * - 면적/연식 누락 판단: ctx.__flags.missingArea / missingBuiltYear 참고.
 * - 콘솔 구조화 로그: SaveGreen.log.kv / SaveGreen.log.ctx.
 * - “SDK/더미” 혼용 시, harmonizeSavingWithMl_Safe → computeKpis → renderKpis 순으로 값 흐름 확인.
 * ============================================================
 */


/* ───────────────────────────────────────────────────────────
 * 전역 상수/네임스페이스/헬퍼
 * ─────────────────────────────────────────────────────────── */

// 전역 카탈로그 경로 (정적 리소스 기준)
// - 에너지 카탈로그(샘플/더미) JSON을 한 번만 내려받아 세션 캐시에 보관
const CATALOG_URL = '/dummy/green.json';

window.SaveGreen = window.SaveGreen || {};
window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

// JS 켜짐 표시(헤더 스페이서 CSS 토글용)
document.documentElement.classList.add('js');

// 버튼 락 전역 변수
let __RUN_LOCK__ = false;

// 헤더 기본 높이(최소값) 캐시
let __HEADER_BASE_MIN__ = null;

// 중복방지 가드: runId+letter 조합별 1회만 출력
const __printedKeys = new Set();
function _printedKey(runId, letter) {
    return `${runId}::${letter}`; // 고유키
}

// 챗봇
document.addEventListener("DOMContentLoaded", function() {
    const chatbotWin = document.querySelector('.chatbot-window');
    if (chatbotWin) {
        chatbotWin.classList.remove('hidden');
        chatbotWin.classList.add('show');
    }
});

// 첫 해 비용절감과 회수기간 계산 폴백
function computePaybackYears(ctx, data, unitUsed, kpi) {
	// 단가(unitUsed)가 없으면 가정값에서 가져오기
	if (!Number.isFinite(unitUsed) || unitUsed <= 0) {
		const a = window.__FORECAST_ASSUMP__ || {};
		unitUsed = Number(a.tariffUnit) || Number(ctx?.daeBase?.tariffKrwPerKwh) || 0;
	}

	// 첫 해 kWh 절감
	let firstSavingKwh = 0;
	if (Array.isArray(data?.series?.saving) && data.series.saving.length) {
		firstSavingKwh = Number(data.series.saving[0]) || 0;
	} else if (Number.isFinite(Number(kpi?.savingKwhYr))) {
		firstSavingKwh = Number(kpi.savingKwhYr);
	}

	// 첫 해 비용절감(에스컬레이션은 첫 해에 미적용)
	const firstSavingCost = (firstSavingKwh > 0 && unitUsed > 0) ? Math.round(firstSavingKwh * unitUsed) : 0;

	// 총 CAPEX = capexPerM2 × 면적
	const area = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area) || 0;
	const capexPerM2 = Number(ctx?.daeBase?.capexPerM2) || 0;
	const capexTotal = (capexPerM2 > 0 && area > 0) ? Math.round(capexPerM2 * area) : 0;

	// 회수기간 계산(분모가 0이면 NaN 반환)
	const payback = (capexTotal > 0 && firstSavingCost > 0) ? (capexTotal / firstSavingCost) : NaN;

	return {
		firstSavingKwh,
		firstSavingCost,
		capexTotal,
		paybackYears: Number.isFinite(payback) ? payback : NaN
	};
}


/* ======================================================================
 * ML 점수 로그 유틸 — runId 기반으로 A/B/C 최신 점수를 콘솔에 3줄 포맷 출력
 * - 전역 네임스페이스: window.SaveGreen.MLLogs
 * - 사용처(차트 시작부): await window.SaveGreen.MLLogs.consoleScoresByRunAndLetter('A'|'B'|'C');
 * - 엔드포인트: /api/forecast/ml/logs/by-run?runId=...  (서버 라우팅에 맞춰 필요시 변경)
 * ====================================================================== */
window.SaveGreen.MLLogs = (function () {
    function getRunId() {
        try {
            const url = new URL(window.location.href);
            const q = url.searchParams.get('runId');
            if (q && q.trim()) return q.trim();
        } catch {}
        if (window.__SG_RUN_ID && String(window.__SG_RUN_ID).trim()) {
            return String(window.__SG_RUN_ID).trim();
        }
        console.warn('[logs] runId not provided. set ?runId=... to avoid mixing runs.');
        return null;
    }

    async function fetchLogsByRun(runId) {
        if (!runId) return [];
        const url = `/api/forecast/ml/logs/by-run?runId=${encodeURIComponent(runId)}`;
        try {
            const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
            if (!res.ok) {
                console.error('[logs] fetch failed', res.status, await res.text());
                return [];
            }
            const data = await res.json();
            return Array.isArray(data) ? data : (data?.items || []);
        } catch (e) {
            console.error('[logs] fetch error', e);
            return [];
        }
    }

    function latestByTs(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        return arr.slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] || null;
    }

    function pickLatestScores(logs, letter) {
        if (!Array.isArray(logs) || !letter) return null;
        const prefix = `${letter}_`;

        // 모델 접두사 필터
        const rel = logs.filter(r => {
            const m = r?.tags?.model;
            return m && String(m).startsWith(prefix);
        });

        // ▼ kind 후보 더 넓게 잡기
        const isTrain  = r => r.type === 'metrics' && /^(score_train|train_score)$/i.test(String(r.kind||''));
        const isTest   = r => r.type === 'metrics' && /^(score_test|test_score)$/i.test(String(r.kind||''));
        const isCv     = r => r.type === 'metrics' && /^(cv|cv_mean|cv_stats)$/i.test(String(r.kind||''));
        const isEns    = r => r.type === 'metrics' && /^ensemble$/i.test(String(r.kind||''));

        const trains = rel.filter(isTrain);
        const tests  = rel.filter(isTest);
        const cvs    = rel.filter(isCv);
        const ens    = rel.filter(isEns);

        const latestByTsLocal = (arr) => {
            if (!arr.length) return null;
            // ts 가 문자열/숫자 섞여도 안전하게 정렬
            return arr.slice().sort((a,b) => String(b.ts).localeCompare(String(a.ts)))[0] || null;
        };

        const tTrain = latestByTsLocal(trains);
        const tTest  = latestByTsLocal(tests);
        const tCv    = latestByTsLocal(cvs);
        const tEns   = latestByTsLocal(ens);

        const modelName = (tTrain?.tags?.model) || (tTest?.tags?.model) || (tCv?.tags?.model) || (tEns?.tags?.model) || `${letter}_N/A`;

        // 숫자 파서: number 또는 숫자 문자열 모두 허용
        const num = (v) => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            const n = Number(String(v).trim());
            return Number.isFinite(n) ? n : NaN;
        };
        const pickNum = (obj, keys) => {
            if (!obj) return NaN;
            for (const k of keys) {
                const v = num(obj[k]);
                if (Number.isFinite(v)) return v;
            }
            return NaN;
        };
        const to4 = v => Number.isFinite(v) ? v.toFixed(4) : 'n/a';

        // 표준: train/test 가 둘 다 있으면 그걸로
        if (tTrain && tTest) {
            const tr_mae  = pickNum(tTrain.metrics, ['train_mae','mae']);
            const tr_rmse = pickNum(tTrain.metrics, ['train_rmse','rmse']);
            const tr_r2   = pickNum(tTrain.metrics, ['train_r2','r2']);

            const te_mae  = pickNum(tTest.metrics,  ['test_mae','mae']);
            const te_rmse = pickNum(tTest.metrics,  ['test_rmse','rmse']);
            const te_r2   = pickNum(tTest.metrics,  ['test_r2','r2']);

            let d_mae = pickNum(tTest.metrics, ['delta_mae']);
            if (!Number.isFinite(d_mae) && Number.isFinite(tr_mae) && Number.isFinite(te_mae)) {
                d_mae = te_mae - tr_mae;
            }

            return {
                modelName,
                train: { mae: to4(tr_mae), rmse: to4(tr_rmse), r2: to4(tr_r2) },
                test:  { mae: to4(te_mae), rmse: to4(te_rmse), r2: to4(te_r2), dmae: to4(d_mae) }
            };
        }

        // 폴백: cv(mean/std)만 있어도 표기
        if (tCv) {
            const m = tCv.metrics || {};
            const cv_mae_mean  = pickNum(m, ['mae_mean','maeMean']);
            const cv_rmse_mean = pickNum(m, ['rmse_mean','rmseMean']);
            const cv_r2_mean   = pickNum(m, ['r2_mean','r2Mean']);

            const cv_mae_std   = pickNum(m, ['mae_std','maeStd']);
            const cv_rmse_std  = pickNum(m, ['rmse_std','rmseStd']);
            const cv_r2_std    = pickNum(m, ['r2_std','r2Std']);

            return {
                modelName,
                train: { mae: to4(cv_mae_mean),  rmse: to4(cv_rmse_mean),  r2: to4(cv_r2_mean) },
                test:  { mae: to4(cv_mae_std),   rmse: to4(cv_rmse_std),   r2: to4(cv_r2_std),  dmae: 'n/a' }
            };
        }

        // ensemble만 있는 경우는 상위 print 함수에서 처리(C 전용)
        return { modelName };
    }

    function printChartScoreLogs(logs, letter) {

        const picked = pickLatestScores(logs, letter);
        const modelName = picked?.modelName || `${letter}_N/A`;

        // 헤더(보라색) + 내용(검정) 2~3줄을 한 그룹으로
        console.group(
            `%c[chart ${letter}]%c ${modelName}`,
            'color:#9c27b0;font-weight:600',  // 보라
            'color:inherit'                   // 검정
        );
//
          // 콘솔에 로그 출력할려면 아래 주석 제거
//        const lineOf = o => `MAE=${o.mae}, RMSE=${o.rmse}, R2=${o.r2}`;
//
//        if (picked?.train && picked?.test) {
//            console.log(`[train] ${lineOf(picked.train)}`);
//            console.log(
//                `[test ] ${lineOf(picked.test)}${
//                picked.test.dmae !== 'n/a' ? `  (ΔMAE=${picked.test.dmae})` : ''
//                }`
//            );
//        } else if (letter === 'C') {
//            // C는 앙상블 전용(하드코딩 허용)
//            const ens = latestByTs(
//                logs.filter(r => r.type === 'metrics' && /^ensemble$/i.test(String(r.kind || '')))
//            );
//            if (ens?.metrics) {
//                const wA = typeof ens.metrics.wA === 'number' ? ens.metrics.wA.toFixed(4) : 'n/a';
//                const wB = typeof ens.metrics.wB === 'number' ? ens.metrics.wB.toFixed(4) : 'n/a';
//                console.log(`[ensemble] wA=${wA}, wB=${wB}`);
//            } else {
//                console.log('[ensemble] (no weights)');
//            }
//        } else {
//        console.log('(no train/test logs for this run)');
//        }
        console.groupEnd();
    }

    // 디버그 도우미: 모델 접두사(A/B/C)별 어떤 kind가 찍혔는지와 최신 metrics를 바로 확인
    async function debugDump(letter) {
        const id = await ensureRunId();
        if (!id) { console.warn('[debugDump] no runId'); return; }

        const rows = await fetchLogsByRun(id);
        const rel = rows.filter(r => String(r?.tags?.model || '').startsWith(`${letter}_`));

        console.group(`[debugDump] ${letter} (rows=${rel.length})`);
        // kind 분포(몇 개씩 찍혔는지)
        const kinds = rel.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
        console.log('kinds:', kinds);

        // 최신 train/test/cv 한 줄씩
        const byTs = arr => arr.slice().sort((a,b)=>String(b.ts).localeCompare(String(a.ts)));
        const lastTrain = byTs(rel.filter(r => /^(score_train|train_score)$/i.test(r.kind||'')))[0];
        const lastTest  = byTs(rel.filter(r => /^(score_test|test_score)$/i.test(r.kind||'')))[0];
        const lastCv    = byTs(rel.filter(r => /^(cv|cv_mean|cv_stats)$/i.test(r.kind||'')))[0];

        console.log('lastTrain.metrics =', lastTrain?.metrics);
        console.log('lastTest.metrics  =', lastTest?.metrics);
        console.log('lastCv.metrics    =', lastCv?.metrics);
        console.groupEnd();
    }

    async function consoleScoresByRunAndLetter(letter, runId = null) {
        // 우선 외부에서 넘긴 값이 있으면 그것부터 등록
        if (runId && String(runId).trim()) {
            setRunId(String(runId).trim());
        }
        // 보장 획득
        const id = await ensureRunId();
        if (!id) {
            console.warn('[logs] no runId. skip consoleScoresByRunAndLetter.');
            return;
        }

        // 중복 방지: 같은 runId+letter는 한 번만 찍는다
        const key = _printedKey(id, letter);
        if (__printedKeys.has(key)) return;
        __printedKeys.add(key);

        const logs = await fetchLogsByRun(id);
        printChartScoreLogs(logs, letter);
    }

    // --- 1) 런아이디 세팅: 전역 + 세션에 저장(하드코딩 금지, 동적 주입용) ---
    function setRunId(runId) {
        if (!runId || !String(runId).trim()) return;
        const id = String(runId).trim();
        // 전역(즉시 사용)
        window.__SG_RUN_ID = id;
        // 세션(탭/새로고침 복구)
        try { sessionStorage.setItem('ml.runId', id); } catch {}
    }

    // --- 2) 서버에서 현재 세션의 run_id를 받아오는 API 헬퍼 ---
    async function getServerRunId() {
        try {
            const res = await fetch('/api/forecast/ml/run/current', { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return null;
            const js = await res.json();
            const id = (js && (js.run_id || js.runId)) ? String(js.run_id || js.runId).trim() : '';
            return id || null;
        } catch {
            return null;
        }
    }

    // --- 3) 보장 헬퍼: 없으면 서버/스토리지에서 찾아서 세팅 후 반환 ---
    async function ensureRunId() {
        // 3-1) 이미 메모리에 있으면 바로
        if (window.__SG_RUN_ID && String(window.__SG_RUN_ID).trim()) return String(window.__SG_RUN_ID).trim();

        // 3-2) URL
        try {
            const url = new URL(window.location.href);
            const q = url.searchParams.get('runId');
            if (q && q.trim()) { setRunId(q.trim()); return q.trim(); }
        } catch {}

        // 3-3) dataset
        try {
            const ds = document.getElementById('forecast-root')?.dataset || {};
            const d = (ds.runId || ds.runid || '').trim();
            if (d) { setRunId(d); return d; }
        } catch {}

        // 3-4) session/local storage
        try {
            const s = (sessionStorage.getItem('ml.runId') || localStorage.getItem('ml.runId') || '').trim();
            if (s) { setRunId(s); return s; }
        } catch {}

        // 3-5) 서버-세션(최종 복구 루트)
        const srv = await getServerRunId();
        if (srv) { setRunId(srv); return srv; }

        return null;
    }

    return {
        getRunId, fetchLogsByRun, pickLatestScores, printChartScoreLogs, consoleScoresByRunAndLetter,
        setRunId, ensureRunId,
        debugDump
    };
})();


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
    const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
    let level = LEVELS.info;
    let allowTags = null; // null=전체 허용, Set[...]이면 해당 태그만

    function setLevel(lv) { level = LEVELS[lv] ?? level; }
    function enableTags() { allowTags = new Set([].slice.call(arguments)); }
    function clearTags() { allowTags = null; }

    // 1) 태그 필터/레벨 체크
    function _ok(lv, tag) {
        const base = String(tag || '').toLowerCase().split(' ')[0];    // ← 앞 단어 기준
        if ((LEVELS[lv] ?? 0) > level) return false;
        if (!allowTags) return true;
        // allowTags('chart')로 켠 경우 'chart A'도 통과시킴
        return allowTags.has(base) || allowTags.has(String(tag || '').toLowerCase());
    }

    // 2) 색상 선택
    function _sty(tag) {
        const base = String(tag || '').toLowerCase().split(' ')[0];    // ← 앞 단어 기준
        return TAG_STYLE[base] || TAG_STYLE.default;
    }

    // KST 타임스탬프 (HH:MM:SS)
    function _stamp() {
        try {
            return new Intl.DateTimeFormat('ko-KR', {
                timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
            }).format(new Date());
        } catch { return ''; }
    }

    // 태그별 색상 팔레트
    const TAG_STYLE = {
        provider: 'color:#8bc34a;font-weight:600',  // 연두
        main: 'color:#03a9f4;font-weight:600',      // 하늘
        catalog: 'color:#ff9800;font-weight:600',   // 주황
        chart: 'color:#9c27b0;font-weight:600',     // 보라
        kpi: 'color:#f44336;font-weight:600',       // 빨강
        default: 'color:#9e9e9e;font-weight:600'    // 회색
    };

    // ─ ctx()가 한 줄이 아니라 '키: 값' 줄바꿈 블록으로 출력되도록 변경
    // - LABELS 표의 순서대로 출력하고, 값이 없는 항목은 건너뜀
    // - 마지막에 개행을 붙여 가독성을 높임
    const LABELS = [
    	['buildingName', '건물명'],
        ['pnu', 'PNU'],
        ['builtYear', '사용연도'],
        ['buildingId', 'BuildingId'],
        ['useName', '용도'],
        ['floorArea', '연면적㎡'],
        ['area', '면적㎡'],
        ['roadAddr', '도로명'],
        ['jibunAddr', '지번'],
        ['lat', 'lat'],
        ['lon', 'lon'],
        ['from', 'from'],
        ['to', 'to']
    ];

    // 객체를 '키 : 값' 들의 여러 줄 문자열로 변환
    function _fmtCtx(o) {
        if (!o || typeof o !== 'object') return String(o ?? '');
        const lines = [];
        for (const [k, label] of LABELS) {
            let v = o[k];
            if (v == null || String(v).trim() === '') continue;
            if ((k === 'floorArea' || k === 'area') && Number.isFinite(Number(v))) {
                v = new Intl.NumberFormat('ko-KR').format(Number(v));
            }
            lines.push(`${label} : ${v}`);
        }
        return lines.join('\n');
    }

    // 실제 출력: 라벨 헤더 + 줄바꿈 + '키 : 값' 블록
    function ctx(label, obj, tag) {
        if (!_ok('info', tag)) return;
        const block = _fmtCtx(obj);
        console.info(`%c[${_stamp()}][${label}]%c\n${block}\n`, _sty(tag), 'color:inherit');
    }

    // 어떤 객체든 '키 : 값' 형식의 멀티라인으로 출력하는 유틸
    // - title: 이 블록의 제목(예: 'base', 'kpi snapshot')
    // - obj  : 출력할 객체
    // - order: 출력 순서 배열(지정 없으면 Object.keys 순)
    function kv(tag, title, obj, order) {
        if (!_ok('info', tag)) return;
        const o = obj || {};
        const keys = (Array.isArray(order) && order.length) ? order : Object.keys(o);
        const lines = [];
        for (const k of keys) {
            if (!(k in o)) continue;
            let v = o[k];
            if (v == null) continue;
            // 숫자는 한국어 포맷 적용(금액·면적 같은 값 가독성 ↑)
            if (typeof v === 'number' && Number.isFinite(v)) {
                try { v = new Intl.NumberFormat('ko-KR').format(v); } catch { }
            }
            lines.push(`${k} : ${v}`);
        }
        // 라벨/태그 헤더 + 줄바꿈 + '키 : 값' 블록
        console.info(`%c[${_stamp()}][${tag}]%c ${title}\n${lines.join('\n')}\n`, _sty(tag), 'color:inherit');
    }

    // Logger 출력 함수 4종
    function debug() {
        const [tag, msg, ...rest] = arguments;
        if (_ok('debug', tag)) {
            console.debug(`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest);
        }
    }
    function info() {
        const [tag, msg, ...rest] = arguments;
        // noisy provider 메시지 무시(초기 탐색 중)
        if (typeof msg === 'string' && /type\s+mapping\s+miss/i.test(msg) && document.body.classList.contains('is-idle')) {
            return;
        }
        if (_ok('info', tag)) {
            console.info(`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest);
        }
    }
    function warn() {
        const [tag, msg, ...rest] = arguments;
        if (_ok('warn', tag)) {
            console.warn(`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest);
        }
    }
    function error() {
        const [tag, msg, ...rest] = arguments;
        if (_ok('error', tag)) {
            console.error(`%c[${_stamp()}][${tag}]%c ${msg}`, _sty(tag), 'color:inherit', ...rest);
        }
    }

    // kv는 위에서 이미 정의돼 있음(멀티라인 키:값 블록 출력)
    // export에 포함하지 않으면 SaveGreen.log.kv 호출 시 undefined 에러 발생
    window.SaveGreen.log = { setLevel, enableTags, clearTags, debug, info, warn, error, ctx, kv };
})();

// 메인(base) 로그 이쁘게: 한글(영어) 라벨 + 숫자 포맷
function logMainBasePretty({ mappedType, base }) {
    const b = base || {};
    const view = {
        '유형(type)': mappedType || '-',
        '전력단가(tariff)': (b?.tariffKrwPerKwh ?? b?.unitPrice ?? b?.tariff?.unit ?? b?.tariff ?? '-'),
        '투자비/㎡(capexPerM2)': (b?.capexPerM2 ?? '-'),
        '절감률(savingPct)': (b?.savingPct ?? '-')
    };
    // 숫자는 한국어 포맷
    for (const k of Object.keys(view)) {
        const v = view[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
            try { view[k] = new Intl.NumberFormat('ko-KR').format(v); } catch { }
        }
    }
    SaveGreen.log.kv('main', 'base', view, Object.keys(view));
}

// ML 페이로드 로그를 한글(영어) 라벨로, 지역은 1개만 표시
function logMlPayloadPretty(payload) {
    if (!payload || typeof payload !== 'object') return;

    // 지역은 regionRaw 우선 → region 폴백
    const regionOnce = payload.regionRaw || payload.region || '';

    // 표기 맵(출력 순서 고정)
    const LABELS = [
        ['type', '유형(type)'],
        ['region', '지역(region)'],
        ['builtYear', '사용연도(builtYear)'],
        ['floorAreaM2', '면적㎡(floorAreaM2)'],
        ['energy_kwh', '연간에너지(kWh)'],
        ['eui_kwh_m2y', 'EUI(kWh/㎡·년)']
    ];

    // 표기용 오브젝트 구성(숫자는 한국어 포맷 적용)
    const view = {};
    for (const [key, label] of LABELS) {
        let v;
        if (key === 'region') {
            v = regionOnce;
        } else {
            v = payload[key];
        }
        if (typeof v === 'number' && Number.isFinite(v)) {
            try { v = new Intl.NumberFormat('ko-KR').format(v); } catch { }
        }
        view[label] = v;
    }

    // 한 번만 찍기
    SaveGreen.log.kv('kpi', 'ML payload', view, LABELS.map(([_, label]) => label));
}

// 전역 clamp 폴리필(없으면 등록)
if (typeof window.clamp !== 'function') window.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// DOM 헬퍼(이 파일 전용)
const $el = (s, root = document) => root.querySelector(s);
const $$el = (s, root = document) => Array.from(root.querySelectorAll(s));

// 예측 가정(KV) 값 채우기: id → data-k → 라벨 매칭 순으로 찾음
function fillAssumptionKV({ tariffText, basisText }) {
    const root = document.getElementById('preload-assumption') || document;
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const findByLabel = (label) => {
        const rows = root.querySelectorAll('.kv li, .kv .row, li');
        for (const row of rows) {
            const k = row.querySelector('.k');
            const v = row.querySelector('.v');
            if (k && v && norm(k.textContent) === norm(label)) return v;
        }
        return null;
    };

    (function () {
        let el = root.querySelector('#assump-tariff') ||
                 root.querySelector('[data-k="tariff"] .v') ||
                 findByLabel('전력단가');
        if (el && tariffText != null) el.textContent = String(tariffText);
    })();

    (function () {
        let el = root.querySelector('#assump-basis') ||
                 root.querySelector('[data-k="basis"] .v') ||
                 findByLabel('계산기준');
        if (el && basisText != null) el.textContent = String(basisText);
    })();
}

/* 예측 기간 상수 */
const NOW_YEAR = new Date().getFullYear();
const HORIZON_YEARS = 10;

/* 배너 텍스트 */
const BANNER_TEXTS = {
    recommend: '연식과 향후 비용 리스크를 고려할 때, 리모델링을 권장합니다.',
    conditional: '일부 항목은 적정하나, 향후 효율과 수익성 검토가 필요합니다.',
    'not-recommend': '현재 조건에서 리모델링 효과가 제한적입니다.'
};

// 예측 창 산출: FE 상수(NOW_YEAR/HORIZON_YEARS) 또는 dataset/from,to 기반
function calcForecastWindow(ctx, data) {
    /*
     * 정책(포함 범위, inclusive):
     *  - from = 시작 연도
     *  - to   = 시작 연도 + HORIZON_YEARS
     *  예) NOW_YEAR=2025, HORIZON_YEARS=10 → 2025~2035 (사용자 정의에 맞춤)
     */
    let fromY;
    let toY;

    // 1순위: baseForecast(data)에서 이미 계산된 years가 있으면 그걸 신뢰
    if (Array.isArray(data?.years) && data.years.length) {
        fromY = Number(data.years[0]);
        toY = Number(data.years[data.years.length - 1]);
    }

    // 2순위: 컨텍스트에 from/to가 있으면 사용
    if (!Number.isFinite(fromY) && Number.isFinite(Number(ctx?.from))) fromY = Number(ctx.from);
    if (!Number.isFinite(toY) && Number.isFinite(Number(ctx?.to))) toY = Number(ctx.to);

    // 3순위: 상수 기반 기본값 지정
    if (!Number.isFinite(fromY)) fromY = NOW_YEAR;
    if (!Number.isFinite(toY)) toY = fromY + HORIZON_YEARS; // ← 2025~2035(포함) 규칙

    // 방어 로직
    if (toY < fromY) [fromY, toY] = [toY, fromY];

    return { from: fromY, to: toY };
}




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
    const navbar = document.querySelector('nav.navbar');
    const spacer = document.querySelector('.header-spacer');
    const wrap = document.querySelector('main.wrap');
    if (!wrap) return;

    const rootCS = getComputedStyle(document.documentElement);
    const extra = parseInt(rootCS.getPropertyValue('--header-extra-gap')) || 16;

    const getBarH = (el) => {
        if (!el) return 0;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
        const rect = el.getBoundingClientRect();
        const isFixed = cs.position === 'fixed';
        const isStickyNow = cs.position === 'sticky' && rect.top <= 0;
        return (isFixed || isStickyNow) ? Math.round(rect.height) : 0;
    };

    // baseH: menubar+navbar의 현재 표시 높이
    const baseH = getBarH(menubar) + getBarH(navbar);

    // [추가] 최초 값이거나 더 작은 값이 나오면 갱신 (증가분은 무시)
    if (__HEADER_BASE_MIN__ == null || baseH < __HEADER_BASE_MIN__) {
        __HEADER_BASE_MIN__ = baseH;
    }

    // [수정] 실제로 쓰는 높이는 "기준 최소값"
    const effH = __HEADER_BASE_MIN__ ?? baseH;

    // CSS 변수/패딩에 effH 사용
    document.documentElement.style.setProperty('--header-height', effH + 'px');
    const topPad = (effH + extra) + 'px';
    wrap.style.paddingTop = topPad;

    // JS on이면 스페이서 숨김
    if (document.documentElement.classList.contains('js') && spacer) {
        spacer.style.display = 'none';
        spacer.style.height = '0px';
        spacer.style.padding = '0';
        spacer.style.margin = '0';
        spacer.style.border = '0';
    } else if (spacer) {
        spacer.style.display = 'block';
        spacer.style.height = topPad;
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
    const navbar = document.querySelector('nav.navbar');
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(request);
        if (menubar) ro.observe(menubar);
        if (navbar) ro.observe(navbar);
    }
}

// Forecast 페이지 진입 표시(헤더 고정용 CSS 스코프용)
document.body.classList.add('page-forecast');


/* ==========================================================
 * 2) 프리로드 패널(컨텍스트/가정/리스크) 렌더
 * ========================================================== */

/**
 * 상태 패널 텍스트 및 페이지 상태 클래스 토글
 * state: idle / running / complete
 */
function setPreloadState(state) {
    document.body.classList.remove('is-idle', 'is-running', 'is-complete');
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
 * 1) 건물 컨텍스트(명/주소/용도…) 2) 예측 가정(1·2줄) 3) 리스크 배지
 */
function renderPreloadInfoAndRisks() {
    const root = document.getElementById('forecast-root');
    if (!root) return;
    const ds = root.dataset || {};
    const ls = (k) => localStorage.getItem('forecast.' + k) || '';
    const pick = (k) => (ds[k] || ls(k) || '').toString().trim();
    const numOk = (v) => v !== '' && !isNaN(parseFloat(v));

    // 1) 왼쪽 카드(건물 컨텍스트) — 기존 로직 유지
    const bmap = {
        buildingName: pick('buildingName') || ds.bname || '',
        roadAddr: pick('roadAddr') || pick('jibunAddr') || '',
        useName: pick('use') || pick('useName') || '',
        builtYear: pick('builtYear') || '',
        floorArea: pick('area') || pick('floorArea') || '',
        // dataset 우선, 없으면 로컬스토리지 키(있다면) 시도
        pnu: ds.pnu || ''
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
            if (!val) li.style.display = 'none';
            else {
                const vEl = li.querySelector('.v');
                if (vEl) vEl.textContent = val;
                li.style.display = '';
            }
        });
    }

    // 2) 우측 “예측 가정” 1줄/2줄
    {
        const unit = pick('unitPrice') || '기본';
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

    {
        const co2Factor = pick('co2Factor');
        const effGainPct = pick('efficiencyGainPct');
        const tariffType = pick('tariffType');
        const utilPct = pick('utilizationPct');
        let parts2 = [];
        if (co2Factor || effGainPct) {
            if (co2Factor) parts2.push(`배출계수 : ${co2Factor} kgCO₂/kWh`);
            if (numOk(effGainPct)) parts2.push(`효율 개선 : ${parseFloat(effGainPct)}%`);
        } else if (tariffType || numOk(utilPct)) {
            if (tariffType) parts2.push(`요금제 : ${tariffType}`);
            if (numOk(utilPct)) parts2.push(`가동률 : ${parseFloat(utilPct)}%`);
        }
        const el2 = document.getElementById('assumption-line-2');
        const line2 = parts2.join(' · ');
        if (el2) { el2.textContent = line2; el2.style.display = line2 ? '' : 'none'; }
    }

    // 3) 리스크 배지
    {
        const wrap = document.getElementById('risk-badges');
        if (wrap) {
            wrap.innerHTML = '';
            const badges = [];
            const nowY = new Date().getFullYear();
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
    // init 시작: provider 로그는 임시로 숨긴다 (preload/탐색 중 찍히는 miss 제거)
    try { SaveGreen.log.enableTags('main','catalog','kpi','chart','forecast'); } catch {}
    document.getElementById('preload-warn-badges')?.remove();

    initHeaderOffset();

    const root = document.getElementById('forecast-root');

    // 3-1) sessionStorage → dataset 부트스트랩
    bootstrapContextFromStorage(root);

    // ─────────────────────────────────────────────
    // 3-2) 세션 → dataset 보충 (그린파인더 세션 값)
    // - 문제: 그린파인더가 세션에 남기는 키 이름이 케이스별로 달라 dataset이 비어 있었음
    // - 해결: 여러 "후보 키" 중 첫 유효값을 뽑아 표준 키로 채움(문자열 트림, 숫자 캐스팅)
    //   * 표준 키(우리 쪽에서 사용하는 키):
    //     buildingName, useName, use(동일값 미러링), roadAddr, jibunAddr, builtYear, floorArea, area
    //   * 숫자 캐스팅: "12,345.6" → 12345.6 (콤마/공백 제거)
    //   * 연도 추출: "YYYY-MM-DD" → 2004
    {
    	if (root) {
    		// 세션 읽기
    		const sget = (k) => (sessionStorage.getItem(k) || '').toString().trim();

    		// dataset에 값이 없을 때만 설정(출처도 남김)
    		const setIfEmpty = (key, val, from) => {
    			if (!root.dataset[key] && val != null && String(val).trim() !== '') {
    				root.dataset[key] = String(val).trim();
    				root.dataset[key + 'From'] = from;
    			}
    		};

    		// 후보 키에서 "첫 유효 문자열" 선택
    		const pickStr = (...keys) => {
    			for (const k of keys) {
    				const v = sget(k);
    				if (v !== '') return v;
    			}
    			return '';
    		};

    		// 후보 키에서 "첫 유효 숫자" 선택(콤마/공백 제거 후 Number)
    		const pickNum = (...keys) => {
    			for (const k of keys) {
    				const raw = sget(k);
    				if (!raw) continue;
    				const n = Number(raw.replace(/[,\s]/g, ''));
    				if (Number.isFinite(n)) return n;
    			}
    			return NaN;
    		};

    		// ── 건물명
    		//  - 후보: bldNm / buldNm / bldgNm / bdNm / bldNmDc / buildingName
    		const buildingName = pickStr('buildingName', 'bldNm', 'buldNm', 'bldgNm', 'bdNm', 'bldNmDc');
    		setIfEmpty('buildingName', buildingName, 'session');

            // ── 용도(대분류)
            //  - 후보: gf:useName / useName / mainPurpsCdNm / buldPrposClCodeNm / mainPurpsClCodeNm / use
            const useName = pickStr(
                'gf:useName', 'useName',
                'mainPurpsCdNm', 'buldPrposClCodeNm', 'mainPurpsClCodeNm',
                'use'
            );
            setIfEmpty('useName', useName, 'session');

    		// 일부 코드가 dataset.use를 참조하므로 미러링
    		setIfEmpty('use', useName, 'session');

    		// ── 도로명 주소
    		//  - 후보: roadAddr / newPlatPlc
    		const roadAddr = pickStr('roadAddr', 'newPlatPlc');
    		setIfEmpty('roadAddr', roadAddr, 'session');

    		// ── 지번 주소
    		//  - 후보: jibunAddr / platPlc / (ldCodeNm + ' ' + mnnmSlno)
    		let jibunAddr = pickStr('jibunAddr', 'platPlc');
    		if (!jibunAddr) {
    			const ld = sget('ldCodeNm');
    			const mn = sget('mnnmSlno');
    			const combo = `${ld} ${mn}`.trim();
    			if (combo !== '') jibunAddr = combo;
    		}
    		setIfEmpty('jibunAddr', jibunAddr, 'session');

    		// ── 사용승인 연도
    		//  - 후보: builtYear(숫자) / useConfmDe / useAprDay / apprvYmd (YYYY-MM-DD → YYYY)
    		let builtYear = sget('builtYear');
    		if (!builtYear) {
    			const d = pickStr('useConfmDe', 'useAprDay', 'apprvYmd');
    			const y4 = (d || '').slice(0, 4);
    			if (/^\d{4}$/.test(y4)) builtYear = y4;
    		}
    		setIfEmpty('builtYear', builtYear, 'session');

    		// ── 연면적(㎡)
    		//  - 후보: floorArea / BuildingArea / totArea / buldBildngAr / area
    		const areaNum = pickNum('floorArea', 'BuildingArea', 'totArea', 'buldBildngAr', 'area');
    		if (Number.isFinite(areaNum)) {
    			// 표준 키는 floorArea를 우선 사용(문자열 저장; 이후 Number로 재해석)
    			setIfEmpty('floorArea', String(areaNum), 'session');
    			// (호환) 일부 로직이 area를 참조하므로 함께 채움
    			setIfEmpty('area', String(areaNum), 'session');
    		}

    		// ── 요약 주소(addr) 채우기(이미 있으면 유지)
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

    // 시작 전에 세션→카탈로그 매칭을 미리 시도하고 로그 남김(있으면 히어로/칩도 하이드레이트)
    if (window.SaveGreen?.Forecast?.bindPreloadFromSessionAndCatalog) {
        SaveGreen.log.info('catalog', 'preload: try session → catalog bind');
        try {
            await window.SaveGreen.Forecast.bindPreloadFromSessionAndCatalog();
            SaveGreen.log.info('catalog', 'preload: session → catalog bind done');
        } catch (e) {
            SaveGreen.log.warn('catalog', 'preload: session → catalog bind failed', e);
        }
    }

    // 시작 전 프리로그: 페이지 dataset/세션/URL에서 씨드 요약을 한 번 찍는다.
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
            roadAddr: pick(ds.roadAddr, bi.roadAddr, bi.roadAddress, urlp.get('roadAddr'), urlp.get('roadAddress')),
            jibunAddr: pick(ds.jibunAddr, bi.jibunAddr, bi.parcelAddress, urlp.get('jibunAddr'), urlp.get('parcelAddress')),
            pnu: pick(ds.pnu, bi.pnu, sget('pnu'), urlp.get('pnu')),
            builtYear: pick(ds.builtYear, bi.builtYear, sget('builtYear'), urlp.get('builtYear')),
            useName: pick(ds.use, ds.useName, bi.use, bi.useName, sget('useName'), urlp.get('useName'), urlp.get('use')),
            floorArea: pick(ds.floorArea, ds.area, bi.floorArea, sget('floorArea'), urlp.get('floorArea'), urlp.get('area')),
            lat: pick(ds.lat, bi.lat, sget('lat'), urlp.get('lat')),
            lon: pick(ds.lon, bi.lon, sget('lon') || sget('lng'), urlp.get('lon') || urlp.get('lng')),
            from: pick(ds.from, urlp.get('from')),
            to: pick(ds.to, urlp.get('to'))
        };
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
    const read = (k) => window.sessionStorage.getItem(k) ?? '';
    const ctx = {
        pnu: read(STORAGE_KEYS.pnu) || sessionStorage.getItem('gf:pnu') || sessionStorage.getItem('pnu'),
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
    } catch { }
}

/** 시작 버튼 결선(없으면 자동 시작) */
function wireStartButtonAndFallback() {
	const btn = document.getElementById('forecast-start');

	// ── [A] 최소 컨텍스트 판정: 이름+면적+사용연도
	function __hasMinContext() {
		const root = document.getElementById('forecast-root');
		const ds = (root && root.dataset) || {};
		const sget = (k) => (sessionStorage.getItem(k) || '').trim();

		const name = (ds.buildingName || ds.bname || sget('buildingName') || sget('buldNm') || '').trim();
		const area = Number(ds.floorAreaM2 || ds.floorArea || ds.area || sget('floorAreaM2') || sget('floorArea') || sget('area'));
		const built = Number(ds.builtYear || sget('builtYear'));

		return !!name && Number.isFinite(area) && area > 0 && Number.isFinite(built) && built > 0;
	}

	// ── [B] 버튼 상태 업데이트(시각만 비활성)
	function __updateStartBtn() {
		if (!btn) return;
		const ok = __hasMinContext();
		btn.dataset.blocked = String(!ok);
		btn.style.opacity = ok ? '' : '0.5';
		btn.style.cursor = ok ? '' : 'not-allowed';
	}

	// ── [C] 버튼 주변 말풍선 힌트 (필요 시 생성/2.2초 뒤 자동 제거)
	let __bubbleTimer = null;
	function __showBubbleNearBtn(text) {
		if (!btn) return;

		// 스타일 1회 주입
		if (!document.getElementById('sg-hint-style')) {
			const st = document.createElement('style');
			st.id = 'sg-hint-style';
			st.textContent = `
				.sg-hint-bubble {
					position: fixed;
					z-index: 9999;
					padding: 10px 12px;
					background: rgba(0,0,0,0.85);
					color: #fff;
					border-radius: 10px;
					font-size: 13px;
					box-shadow: 0 6px 18px rgba(0,0,0,0.25);
					backdrop-filter: blur(2px);
					white-space: nowrap;
					animation: sg-pop 140ms ease-out, sg-fade 220ms ease-out 2s forwards;
				}
				.sg-hint-bubble::after {
					content: '';
					position: absolute;
					top: -6px; right: 18px;
					border: 6px solid transparent;
					border-bottom-color: rgba(0,0,0,0.85);
				}
				@keyframes sg-pop { from { transform: scale(.96); opacity:.0 } to { transform: scale(1); opacity:1 } }
				@keyframes sg-fade { to { opacity: 0; transform: translateY(-4px) } }
				.sg-shake { animation: sg-shake 280ms ease-in-out; }
				@keyframes sg-shake {
					0%,100% { transform: translateX(0) }
					25% { transform: translateX(-3px) }
					50% { transform: translateX(3px) }
					75% { transform: translateX(-2px) }
				}
			`;
			document.head.appendChild(st);
		}

		// 기존 버블 제거
		document.querySelectorAll('.sg-hint-bubble').forEach(n => n.remove());
		if (__bubbleTimer) { clearTimeout(__bubbleTimer); __bubbleTimer = null; }

		// 위치 계산(버튼 우상단 살짝 위)
		const r = btn.getBoundingClientRect();
		const bubble = document.createElement('div');
		bubble.className = 'sg-hint-bubble';
		bubble.textContent = text;
		document.body.appendChild(bubble);

		const x = r.right - bubble.offsetWidth + 8;  // 오른쪽 정렬
		const y = r.top - bubble.offsetHeight - 8;   // 버튼 위쪽
		bubble.style.left = Math.max(12, x) + 'px';
		bubble.style.top  = Math.max(12, y) + 'px';

		// 버튼 살짝 흔들림 효과
		btn.classList.add('sg-shake');
		setTimeout(() => btn.classList.remove('sg-shake'), 320);

		__bubbleTimer = setTimeout(() => {
			bubble.remove();
			__bubbleTimer = null;
		}, 2200);
	}

	setPreloadState('idle');
	renderPreloadInfoAndRisks();

	// 초기 상태 및 폴링(세션이 늦게 들어오는 경우 대비, 최대 20초)
	__updateStartBtn();
	let __poll = 0;
	const __pollId = setInterval(() => {
		__updateStartBtn();
		if (__hasMinContext() || ++__poll > 20) clearInterval(__pollId);
	}, 1000);

	if (btn) {
		btn.onclick = async () => {
			// 컨텍스트 없으면 실행 막고 말풍선만
			if (btn.dataset.blocked === 'true') {
				__showBubbleNearBtn('건물을 먼저 선택해주세요');
				// (원하면 토스트도 병행)
				if (typeof showToast === 'function') showToast('', 'warn');
				return;
			}

			// 정상 실행
			if (__RUN_LOCK__) return;
			__RUN_LOCK__ = true;
			btn.disabled = true; // 실행 중엔 실제 잠금

			try {
				try { SaveGreen.log.clearTags(); } catch {}
				setPreloadState('running');
				await runForecast();
			} catch (e) {
				SaveGreen.log.error('forecast', 'run failed', e);
			} finally {
				__RUN_LOCK__ = false;
				btn.disabled = false; // 실행 끝나면 해제
				__updateStartBtn();
			}
		};
	} else {
		// 버튼이 없는 페이지는 컨텍스트 있을 때만 자동 실행
		if (__hasMinContext()) {
			setPreloadState('running');
			try { SaveGreen.log.clearTags(); } catch {}
			runForecast().catch(e => SaveGreen.log.error('forecast', 'run failed', e));
		}
	}
}

// DOMContentLoaded 시 init 실행(+가정 라인 스타일 보정)
document.addEventListener('DOMContentLoaded', () => {
    init()
        .then(() => { styleAssumptionLines(); })
        .catch(err => SaveGreen.log.error('forecast', 'init failed', err));
});

// 한글 → 코어타입 정규화 테이블 보강(물류/창고는 factory로 묶음)
function mapUseToCoreType(raw, opts = {}) {
	// 정규화 유틸(괄호/특수문자 제거 + 공백 정리 + 소문자화)
	function _norm(s) {
		return String(s || '')
			.replace(/[()\[\]{}【】〈〉<>:·•■□\-—_=+.,/\\!?~※“”"']/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase();
	}

	const noOfficeFallback = !!opts.noOfficeFallback;
	const s = _norm(raw);

	if (!s) return null;

	// factory: 공장/제조/산단/플랜트 + 물류/창고 계열 포함
	const isFactory =
		/(공장|일반공장|제조|생산|산업|산단|산업단지|공업|플랜트|가공|작업장)/.test(s) ||
		/(물류|물류센터|유통센터|배송센터|택배|허브|하치장|창고|창고형|냉동창고|저온창고|보관창고|보세창고|3pl|logistics|warehouse)/.test(s) ||
		/(지식산업센터|아웃소싱센터|유통물류)/.test(s);

	// hospital: 병원/의원/메디컬/요양/치과/한방 등
	const isHospital =
		/(병원|종합병원|의원|메디컬|의료원|보건소|요양(병원)?|클리닉|치과|한방|재활|검진센터|응급의료)/.test(s);

	// school: 학교/초중고/대학교/캠퍼스/교육기관
	const isSchool =
		/(학교|초등|초등학교|중학교|고등학교|고교|대학교|대학|캠퍼스|교육기관|유치원|학원|연수원|연구소(캠퍼스)?)/.test(s);

	// office: 오피스/사무/본사/행정/청사/업무/빌딩/타워
	const isOffice =
		/(오피스|사무|업무|본사|행정|청사|공공청사|동사무소|행정복지센터|구청|시청|군청|빌딩|타워|센터|문화센터|복합행정)/.test(s);

	if (isFactory) return 'factory';
	if (isHospital) return 'hospital';
	if (isSchool) return 'school';
	if (isOffice && !noOfficeFallback) return 'office';

	// 확신 없으면 null (office 강제 폴백 금지 옵션 유지)
	return null;
}

/* ==========================================================
 * 4) 카탈로그 유틸(세션 파싱/매칭/컨텍스트 라벨링)
 * ========================================================== */

(function () {
    'use strict';

    window.SaveGreen = window.SaveGreen || {};
    window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

    let _catalog = null;

    const qs = (s, r = document) => r.querySelector(s);
    const _normalizeAddr = (s) => (s || '')
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
            buildingName: get('gf:buildingName') || get('buildingName') || '',
            // 브이월드/내부 모두 지원
            pnu: get('gf:pnu') || get('pnu') || ''
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

    function _isNear(a, b, radiusM = 30) {
        if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
        const dx = (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
        const dy = (a.lat - b.lat) * 111320;
        return Math.hypot(dx, dy) <= radiusM;
    }

    /**
     * 카탈로그에서 한 건을 찾아 반환
     * 매칭 우선순위: ① PNU 정확일치 → ② 주소(도로/지번) 일치 → ③ 좌표 근접(≤30m) → ④ 건물명 포함
     */
    function matchCatalogRecord(session, catalog) {
    	// 가드
    	if (!Array.isArray(catalog)) return null;

    	// 0) 도움 함수 ---
    	// PNU는 숫자만 남겨 비교(하이픈/공백/문자 제거)
    	const normPnu = v => String(v ?? '').replace(/\D/g, '');
    	// 주소는 공백 정리 + 접미사 간단 정규화(파일 상단의 _normalizeAddr와 동일 정책이면 그대로 사용)
    	const road = session.norm.road;
    	const jibun = session.norm.jibun;

    	// 1) PNU 정확 일치(가장 신뢰도 높음) ---
    	const sessionPnu = normPnu(session.pnu);
    	if (sessionPnu) {
    		const pnuHit = catalog.filter(it => normPnu(it.pnu) === sessionPnu);
    		if (pnuHit.length > 0) {
    			return pnuHit[0];
    		}
    	}

    	// 2) 주소(도로/지번) 일치 ---
    	let candidates = catalog;
    	if (road || jibun) {
    		candidates = candidates.filter(it => {
    			const itRoad  = _normalizeAddr(it.roadAddr  || it.address || '');
    			const itJibun = _normalizeAddr(it.jibunAddr || '');
    			return (road  && itRoad  && itRoad  === road) ||
    			       (jibun && itJibun && itJibun === jibun);
    		});
    	}
    	if (candidates && candidates.length > 0) {
    		return candidates[0];
    	}

    	// 3) 좌표 근접 (기본 30m) ---
    	if (session.lat != null && session.lng != null) {
    		const near = catalog.filter(it => _isNear(
    			{ lat: session.lat, lng: session.lng },
    			{ lat: parseFloat(it.lat), lng: parseFloat(it.lon ?? it.lng) },
    			30
    		));
    		if (near.length > 0) {
    			return near[0];
    		}
    	}

    	// 4) 건물명 부분일치 ---
    	const bname = (session.buildingName || '').trim();
    	if (bname) {
    		const lw = bname.toLowerCase();
    		const byName = catalog.filter(it => (it.buildingName || '').toLowerCase().includes(lw));
    		if (byName.length > 0) {
    			return byName[0];
    		}
    	}

    	// 실패 시 null
    	return null;
    }

    function buildChartContextLine(rec) {
        const name = (rec?.buildingName && String(rec.buildingName).trim()) || '건물명 없음';
        const addr = _normalizeAddr(rec?.roadAddr || rec?.jibunAddr || '');
        const use = (rec?.useName || rec?.use || '').toString().trim();
        const parts = [name];
        if (addr) parts.push(addr);
        if (use) parts.push(use);
        return parts.join(' → ');
    }

    async function hydratePreloadUI(rec) {
        try {
            const F = window.SaveGreen?.Forecast || {};
            const dae = (typeof F.loadDaeConfig === 'function') ? await F.loadDaeConfig() : null;
            if (!dae) return;

            const rawUse = (rec.useName || rec.use || '').toString();

            // 카탈로그 필드(Type/type/buildingType2/eui/energy)를 컨텍스트에 먼저 주입
            const preCtx = { useName: rawUse, buildingName: rec.buildingName, roadAddr: rec.roadAddr, jibunAddr: rec.jibunAddr };
            if (window.SaveGreen?.Forecast?.providers?.applyCatalogToContext) {
                window.SaveGreen.Forecast.providers.applyCatalogToContext(rec, preCtx);
            }

            // hydratePreloadUI(preCtx) …
            let mapped = (typeof resolveCoreType === 'function')
            	? (resolveCoreType({
            		...preCtx,
            		type: preCtx.type ?? rec.type,
            		mappedType: rec.mappedType
            	}, { noOfficeFallback: true }) ||
            	   resolveCoreType({
            		...preCtx,
            		type: preCtx.type ?? rec.type,
            		mappedType: rec.mappedType
            	   }))
            	: null;

            // 마지막 안전망: useName에 ‘업무/사무/오피스/행정/청사’ 계열이 보이면 office로 간주
            if (!mapped) {
            	const u = String(preCtx.useName || '').toLowerCase();
            	if (/(업무|사무|오피스|행정|청사)/.test(u)) mapped = 'office';
            }

            if (!mapped) return;

            const base = (typeof F.getBaseAssumptions === 'function') ? F.getBaseAssumptions(dae, mapped) : null;
            const getT = (F.getEuiRulesForType || F.getEuiRules);
            const euiRules = (typeof getT === 'function') ? getT(dae, mapped) : null;
            if (euiRules) window.SaveGreen.Forecast._euiRules = euiRules;

            const root = document.getElementById('forecast-root');
            if (root?.dataset && base) {
                const unit = (base.tariffKrwPerKwh ?? base.unitPrice ?? base.tariff?.unit ?? base.tariff);
                if (unit != null) root.dataset.unitPrice = String(unit);
            }

            logMainBasePretty({ mappedType: mapped, base });
            await applyCatalogHints({
                catalog: rec,
                mappedType: mapped,
                useName: rawUse,
                daeBase: base,
                euiRules
            });
        } catch (e) {
            SaveGreen.log.warn('catalog', 'early assumption fill skipped', e);
        }
    }

    async function bindPreloadFromSessionAndCatalog() {
        try {
            const session = readSessionKeys();
            const catalog = await loadCatalogOnce();
            const rec = matchCatalogRecord(session, catalog);

            if (rec) {
                await hydratePreloadUI(rec);
            } else {
                try {
                    const root = document.getElementById('forecast-root');
                    const ds = (root?.dataset) || {};
                    const rawUse = String(ds.use || ds.useName || '').toLowerCase();

                    const mapped = ['factory','school','hospital','office'].includes(rawUse)
                        ? rawUse
                        : (typeof mapUseToCoreType === 'function' ? mapUseToCoreType(rawUse) : null);

                    const F = window.SaveGreen?.Forecast || {};
                    const dae = (typeof F.loadDaeConfig === 'function') ? await F.loadDaeConfig() : null;

                    const base = (dae && mapped && typeof F.getBaseAssumptions === 'function')
                        ? F.getBaseAssumptions(dae, mapped)
                        : null;

                    const getT = (F.getEuiRulesForType || F.getEuiRules);
                    const euiRules = (dae && mapped && typeof getT === 'function') ? getT(dae, mapped) : null;
                    if (euiRules) window.SaveGreen.Forecast._euiRules = euiRules;

                    await applyCatalogHints({
                        catalog: null,
                        mappedType: mapped || undefined,
                        useName: rawUse,
                        daeBase: base,
                        euiRules
                    });
                } catch (e) {
                    SaveGreen.log.warn('catalog', 'fallback assumption fill skipped', e);
                }
            }
        } catch (e) {
            SaveGreen.log.warn('forecast', 'bindPreloadFromSessionAndCatalog error', e);
        }
    }

    window.SaveGreen.Forecast.bindPreloadFromSessionAndCatalog = bindPreloadFromSessionAndCatalog;
})();

// ---------------------------------------------------------
// 카탈로그 품질 검증 리포트
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
            SaveGreen.log.warn('catalog', 'not an array');
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
        SaveGreen.log.warn('catalog', 'report failed', e);
    }
};

/* ===== runForecast에서 참조하는 카탈로그 헬퍼들 ===== */
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
function matchCatalogItem(ctx, list) {
    if (!ctx || !Array.isArray(list) || !list.length) return null;

    // 2-1) 비교용 키 추출
    const pnu = (ctx.pnu || '').trim();
    const ra = (ctx.roadAddr || ctx.roadAddress || '').trim();
    const ja = (ctx.jibunAddr || '').trim();
    const bn = (ctx.buildingName || '').trim();
    const lat = Number(ctx.lat ?? ctx.latitude);
    const lon = Number(ctx.lon ?? ctx.lng ?? ctx.longitude);

    // 2-2) 문자열 정규화
    const norm = (s) => (s || '')
        .replace(/\s+/g, '')
        .replace(/[-–—]/g, '')
        .replace(/[()]/g, '')
        .toLowerCase();

    // 2-3) 숫자만 남기고 비교 (하이픈/공백/문자 제거)
    const normPnu = v => String(v ?? '').replace(/\D/g, '');
    if (pnu) {
        const p = normPnu(pnu);
        const byPnu = list.find(it => normPnu(it.pnu) === p);
        if (byPnu) return byPnu;
    }

    // 2-4) 주소 정규화 일치
    const raN = norm(ra), jaN = norm(ja);
    if (raN || jaN) {
        const byAddr = list.find(it => {
            const itRaN = norm(it.roadAddr || it.roadAddress);
            const itJaN = norm(it.jibunAddr);
            return (raN && itRaN && raN === itRaN) || (jaN && itJaN && jaN === itJaN);
        });
        if (byAddr) return byAddr;
    }

    // 2-5) 좌표 근접(하버사인 근사, 120m 이내)
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
            const d = roughDistM({ lat, lon }, { lat: Number(it.lat), lon: Number(it.lon ?? it.lng) });
            if (d < bestD) { best = it; bestD = d; }
        }
        if (best && bestD <= 120) return best;
    }

    // 2-6) 느슨한 빌딩명
    if (bn) {
        const bnN = norm(bn);
        const byBn = list.find(it => norm(it.buildingName) === bnN);
        if (byBn) return byBn;
    }
    return null;
}

// 3) applyCatalogHints(ctx): 프리로드 칩/가정(KV) 보강(값이 비어 있을 때만)
async function applyCatalogHints(ctx) {
    if (!ctx) return;

    try {
        const wrap = document.querySelector('.chips');
        const { period } = ctx.catalog || {};
        if (wrap && period?.startYear && period?.endYear) {
            let chip = document.getElementById('chip-data-period');
            const value = `${period.startYear}–${period.endYear}`;
            if (!chip) {
                chip = document.createElement('div');
                chip.className = 'chip';
                chip.id = 'chip-data-period';
                chip.innerHTML = `<span class="dot">●</span><strong>데이터 기간</strong><span>${value}</span>`;
                wrap.appendChild(chip);
            } else {
                const last = chip.querySelector('span:last-of-type');
                if (last && !last.textContent.trim()) last.textContent = value;
            }
        }
    } catch (e) {
        SaveGreen.log.warn('catalog', 'chip update skipped', e);
    }

    try {
        let base = ctx?.daeBase || null;
        if (!base && SaveGreen?.Forecast?.loadDaeConfig) {
            const dae = await SaveGreen.Forecast.loadDaeConfig();
            const rootEl = document.getElementById('forecast-root');
            const dsHere = (rootEl?.dataset) || {};
            const guessCtx = {
                mappedType: ctx?.mappedType,
                type: ctx?.type,
                useName: ctx?.useName || ctx?.catalog?.useName || dsHere.use || dsHere.useName,
                buildingName: (ctx?.catalog?.buildingName || dsHere.buildingName || dsHere.bname),
                roadAddr: (ctx?.catalog?.roadAddr || ctx?.catalog?.roadAddress || dsHere.roadAddr),
                jibunAddr: (ctx?.catalog?.jibunAddr || dsHere.jibunAddr)
            };
            const guessed = resolveCoreType(guessCtx, { noOfficeFallback: true });
            if (guessed) {
                const getBase = SaveGreen.Forecast.getBaseAssumptions || (() => null);
                base = getBase(dae, guessed) || null;
            }
        }

        const unitRaw = (base?.tariffKrwPerKwh ?? base?.unitPrice ?? base?.tariff?.unit ?? base?.tariff);
        const tariffText = (unitRaw != null && unitRaw !== '') ? `${nf1(unitRaw)} 원/kWh (가정)` : '';

        let basisText = '단위면적당 에너지 사용량 기준';
        try {
            let rules = ctx?.euiRules || null;
            if (!rules && SaveGreen?.Forecast?.loadDaeConfig) {
                const dae = await SaveGreen.Forecast.loadDaeConfig();
                const getT = SaveGreen.Forecast.getEuiRulesForType || SaveGreen.Forecast.getEuiRules;
                if (typeof getT === 'function') rules = getT(dae, ctx?.mappedType || 'office');
            }
            if (rules?.mode === 'primary') basisText = '1차에너지 기준 산출';
        } catch {}

        SaveGreen.log.kv('main', 'assumption (ctx→ui)', {
            type: ctx?.mappedType || '(preload-guess)',
            unitRaw,
            mode: (ctx?.euiRules?.mode || window.SaveGreen?.Forecast?._euiRules?.mode)
        }, ['type','unitRaw','mode']);

        fillAssumptionKV({ tariffText, basisText });
    } catch (e) {
        SaveGreen.log.warn('catalog', 'assumption kv fill skipped', e);
    }
}
/* ===== HOTFIX END ===== */


// ───────────────────────────────────────────────────────────
// ML 브리지 호출
//  - 스프링 컨트롤러는 다음 3개 엔드포인트를 제공
//    1) POST /api/forecast/ml/train           → 학습 시작(jobId)
//    2) GET  /api/forecast/ml/train/status    → 학습 상태 조회
//    3) POST /api/forecast/ml/predict         → 예측(variant=A|B|C)
//  - 프론트는 예측만 필요하므로 /predict 로 POST 해야 함.
//  - 예전 코드처럼 /api/forecast/ml 로 POST 하면 스프링에 매핑이 없어 405가 발생함.
//    (이번 패치의 핵심이 바로 이 경로 수정)
// ───────────────────────────────────────────────────────────
const ML_ENDPOINT = '/api/forecast/ml';   // 백엔드(스프링)측 베이스 경로
const ML_VARIANT = 'C';                   // 기본은 앙상블(C) 사용

// =====================================================================
// - startMlTrain(): 학습 시작 → { jobId, run_id } 수신 시 run_id 저장
// - waitTrainDone(jobId, opts): 상태 폴링(비차단)
// - fetchMlLogSnapshotLatest(): 최근 ml 로그 1줄 요약(옵션)
// =====================================================================
async function startMlTrain() {
	// 서버 규약: POST /api/forecast/ml/train → { jobId, run_id? }
	const url = `${ML_ENDPOINT}/train`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
		body: JSON.stringify({ mode: 'async' })
	});
	if (!res.ok) {
		let detail = ''; try { detail = await res.text(); } catch {}
		throw new Error(`TRAIN ${res.status} ${res.statusText} — ${detail?.slice(0,200)}`);
	}
	const js = await res.json();

	// run_id가 오면 즉시 전역/세션에 저장(하드코딩 금지)
	try {
		const rid = js?.run_id || js?.runId;
		if (rid && window.SaveGreen?.MLLogs?.setRunId) {
			window.SaveGreen.MLLogs.setRunId(String(rid));
			// dataset에도 심어두면 이후 ensureRunId()가 더 빨라짐
			const root = document.getElementById('forecast-root');
			if (root?.dataset) root.dataset.runId = String(rid);
			SaveGreen.log.debug('kpi', `run_id from train → ${rid}`);
		}
	} catch {}

	// 서버가 주는 jobId(필수) 반환
	return js?.jobId || js?.id || null;
}

async function waitTrainDone(jobId, {
	intervalMs = 1200,
	timeoutMs = 5 * 60 * 1000,
	perRequestTimeoutMs = 12000,
	maxNetErr = 5,
	onTick = () => {}
} = {}) {
	if (!jobId) return { ok:false, status:'NO_JOB' };

	const started = Date.now();
	let netErr = 0;

	while (Date.now() - started < timeoutMs) {
		onTick?.({ jobId });

		try {
			const ctl = new AbortController();
			const timer = setTimeout(() => ctl.abort(), perRequestTimeoutMs);

			const url = `${ML_ENDPOINT}/train/status?jobId=${encodeURIComponent(jobId)}`;
			const res = await fetch(url, { method: 'GET', headers: { 'Accept':'application/json' }, signal: ctl.signal });
			clearTimeout(timer);

			if (res.ok) {
				const js = await res.json();
				// 서버 규약 예시: { status: 'PENDING|RUNNING|DONE|ERROR', run_id? }
				if (js?.run_id && window.SaveGreen?.MLLogs?.setRunId) {
					window.SaveGreen.MLLogs.setRunId(String(js.run_id));
					const root = document.getElementById('forecast-root');
					if (root?.dataset) root.dataset.runId = String(js.run_id);
				}
				if (js?.status === 'DONE') return { ok:true, status:'DONE', data:js };
				if (js?.status === 'ERROR') return { ok:false, status:'ERROR', data:js };
				// RUNNING/PENDING이면 아래 sleep 후 재시도
			} else {
				netErr++;
				if (netErr > maxNetErr) return { ok:false, status:'UNREACHABLE' };
			}

		} catch {
			netErr++;
			if (netErr > maxNetErr) return { ok:false, status:'UNREACHABLE' };
		}

		await new Promise(r => setTimeout(r, intervalMs));
	}
	return { ok:false, status:'TIMEOUT' };
}

// 최근 ML 로그 스냅샷 1줄 요약
async function fetchMlLogSnapshotLatest() {
	try {
		const res = await fetch('/api/forecast/ml/logs/snapshot/latest', { headers:{ 'Accept':'application/json' } });
		if (!res.ok) return null;
		const js = await res.json();
		// 기대 형식 예: { path:"D:\\CO2\\ml\\data\\manifest.json", entry:"[score] TEST   ..." }
		return js || null;
	} catch { return null; }
}

// ML 브리지 호출(POST /api/forecast/ml/predict?variant=C)
async function callMl(payload) {
    // 1) 최종 요청 URL 조립 (variant=C 기본)
    const url = `${ML_ENDPOINT}/predict?variant=${encodeURIComponent(ML_VARIANT)}`;

    // 2) POST 호출
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
    });

    // 3) 에러 처리(405 등) → 메시지에 상세 상태 포함
    if (!res.ok) {
        // 네트워크 탭/콘솔에서 원인 파악을 쉽게 하기 위해 상태코드/본문 일부를 붙여줌
        let detail = '';
        try { detail = await res.text(); } catch { }
        throw new Error(`ML ${res.status} ${res.statusText} — ${detail?.slice(0, 200)}`);
    }

    // 4) 정상일 때 ML KPI JSON 반환
    //    { savingKwhYr, savingCostYr, savingPct, paybackYears, label }
    return res.json();
}

// -------------------------------------------------------
// FE → ML 요청 페이로드 생성 (ml_dataset.json 기반 ctx 사용)
// - 목적: FastAPI 스키마에 맞게 yearly/monthly 시계열을
//   "객체 배열" 형태로 전송. (예: { year, electricity })
// - 호환: window.__ML_PAYLOAD_FORM__ = 'array' 로 설정 시
//   레거시(숫자 배열) 형태로 전송 가능(학원/집 환경 차이 대비).
//   기본값은 'objects' (권장).
// -------------------------------------------------------
function buildMlPayload(ctx, data) {
    const FORM = (window.__ML_PAYLOAD_FORM__ || 'objects').toLowerCase();
    const core = new Set(['factory', 'school', 'hospital', 'office']);

    let rawType =
        (ctx?.mappedType) ||
        (ctx?.type) ||
        (ctx?.useName) ||
        (ctx?.buildingType2) ||
        ''; // 기본값 강제 금지

    rawType = String(rawType).trim().toLowerCase();
    let type = core.has(rawType) ? rawType : mapUseToCoreType(rawType);

    if (!type) {
    	// 경고 대신 정보 레벨 + 같은 런에서 1회만 출력
    	const __ONCE_KEY__ = '__warn_no_type_once__';
    	if (!window[__ONCE_KEY__]) {
    		window[__ONCE_KEY__] = true;
    		SaveGreen.log.info('kpi', 'ML type unresolved; proceed without type (server can infer)');
    	}
    }

    const areaNum = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
    const floorAreaM2 = (Number.isFinite(areaNum) && areaNum > 0) ? areaNum : 1000;

    const builtYearNum = Number(ctx?.builtYear);
    const builtYear = Number.isFinite(builtYearNum) && builtYearNum > 0 ? builtYearNum : 2000;

    const addrBase = (ctx?.roadAddr || ctx?.jibunAddr || ctx?.address || '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .trim();
    let regionRaw = (ctx?.regionRaw || addrBase.split(/\s+/).slice(0, 2).join(' ') || '대전') + '';
    regionRaw = regionRaw.replace('광역시', '').replace('특별시', '').trim();
    const region = regionRaw;

    let yearly = undefined, monthly = undefined;
    try {
        const yearsArr = Array.isArray(data?.years) ? data.years.slice() : [];
        const afterArr = Array.isArray(data?.series?.after) ? data.series.after.slice() : [];
        if (yearsArr.length && afterArr.length && yearsArr.length === afterArr.length) {
            if (FORM === 'objects') {
                yearly = yearsArr.map((y, i) => ({
                    year: Number(y),
                    electricity: Number(afterArr[i])
                })).filter(r => Number.isFinite(r.year) && Number.isFinite(r.electricity));
                if (!yearly.length) yearly = undefined;
            } else {
                yearly = afterArr.map(v => Number(v)).filter(v => Number.isFinite(v));
                if (!yearly.length) yearly = undefined;
            }
        }
    } catch {}

    try {
        const monthsArr  = Array.isArray(data?.months) ? data.months.slice() : [];
        const monthlyArr = Array.isArray(data?.series?.monthly) ? data.series.monthly.slice() : [];
        const toMonth01_12 = (s) => {
            const v = String(s || '').trim();
            const m = v.match(/^\d{4}-?(\d{2})$/);
            if (m) return parseInt(m[1], 10);
            const n = Number(v);
            return (Number.isFinite(n) && n >= 1 && n <= 12) ? n : NaN;
        };
        if (monthsArr.length && monthlyArr.length && monthsArr.length === monthlyArr.length) {
            if (FORM === 'objects') {
                monthly = monthsArr.map((ym, i) => {
                    const month = toMonth01_12(ym);
                    const electricity = Number(monthlyArr[i]);
                    return { month, electricity };
                }).filter(r => Number.isFinite(r.month) && Number.isFinite(r.electricity));
                if (!monthly.length) monthly = undefined;
            } else {
                monthly = monthlyArr.map(v => Number(v)).filter(v => Number.isFinite(v));
                if (!monthly.length) monthly = undefined;
            }
        }
    } catch {}

    let energy_kwh = undefined;
    let eui_kwh_m2y = undefined;
    try {
        if (FORM === 'objects' && Array.isArray(yearly) && yearly.length) {
            const last = Number(yearly[yearly.length - 1]?.electricity);
            if (Number.isFinite(last) && last > 0) {
                energy_kwh = last;
                if (Number.isFinite(floorAreaM2) && floorAreaM2 > 0) {
                    eui_kwh_m2y = Math.round(last / floorAreaM2);
                }
            }
        } else if (FORM !== 'objects' && Array.isArray(yearly) && yearly.length) {
            const last = Number(yearly[yearly.length - 1]);
            if (Number.isFinite(last) && last > 0) {
                energy_kwh = last;
                if (Number.isFinite(floorAreaM2) && floorAreaM2 > 0) {
                    eui_kwh_m2y = Math.round(last / floorAreaM2);
                }
            }
        }
    } catch {}

    const toStrOrUndef = (v) => {
        if (v == null) return undefined;
        const s = String(v).trim();
        return s ? s : undefined;
    };

    const win = calcForecastWindow(ctx, data);

    const payload = {
        type,                      // 매핑 실패 시 undefined일 수 있음(백엔드가 처리)
        region, regionRaw, builtYear, floorAreaM2,
        energy_kwh, eui_kwh_m2y, yearsFrom: win.from, yearsTo: win.to
    };
    const buildingName = toStrOrUndef(ctx?.buildingName);
    const pnu = toStrOrUndef(ctx?.pnu);
    const address = toStrOrUndef(ctx?.address || ctx?.jibunAddr || ctx?.roadAddr);
    if (buildingName !== undefined) payload.buildingName = buildingName;
    if (pnu !== undefined)          payload.pnu = pnu;
    if (address !== undefined)      payload.address = address;

    if (Array.isArray(yearly) && yearly.length)  payload.yearlyConsumption = yearly;
    if (Array.isArray(monthly) && monthly.length) payload.monthlyConsumption = monthly;

    return payload;
}

// ─────────────────────────────────────────────
// 컨텍스트 수집(페이지 dataset 최우선 → session → URL → 보조소스)
// - 목적: init()에서 정규화해둔 dataset 값을 반드시 1순위로 사용
// - 부가: 숫자 캐스팅(콤마 제거), 연도 추출(YYYY), 주소 요약(regionRaw) 생성
async function getBuildingContext() {
	// 0) 소스 헬퍼
	const root = document.getElementById('forecast-root');
	const ds = (root?.dataset) || {};
	const sget = (k) => (sessionStorage.getItem(k) || '').toString().trim();
	const urlp = new URLSearchParams(location.search);
	const fromUrl = (k) => (urlp.get(k) || '').toString().trim();
	const bi = window.BUILDING_INFO || {};	// (있을 수도 있음)

	// 1) 문자열/숫자 유틸
	const pickStr = (...cands) => {
		for (const v of cands) {
			if (v == null) continue;
			const s = String(v).trim();
			if (s !== '') return s;
		}
		return '';
	};
	const pickNum = (...cands) => {
		for (const v of cands) {
			if (v == null) continue;
			const n = Number(String(v).replace(/[,\s]/g, ''));
			if (Number.isFinite(n)) return n;
		}
		return NaN;
	};
	const yearFrom = (val) => {
		const s = String(val || '').trim();
		const y4 = s.slice(0, 4);
		return /^\d{4}$/.test(y4) ? Number(y4) : NaN;
	};

	// 2) 표준 스키마로 채우기(← dataset 우선)
    const buildingName = pickStr(
        ds.buildingName, ds.bname,
        sget('buildingName'), sget('bldNm'),
        sget('gf:buildingName'), sget('gf:buldNm'),
        bi.buildingName,
        fromUrl('buildingName'), fromUrl('bname')
    );

    const roadAddr = pickStr(
        ds.roadAddr,
        sget('roadAddr'), sget('newPlatPlc'),
        sget('gf:roadAddr'), sget('gf:roadAddress'),
        bi.roadAddr, bi.roadAddress,
        fromUrl('roadAddr'), fromUrl('roadAddress')
    );

    const jibunAddr = pickStr(
        ds.jibunAddr,
        sget('jibunAddr'), sget('platPlc'),
        sget('gf:jibunAddr'), sget('gf:parcelAddress'),
        bi.jibunAddr, bi.parcelAddress,
        fromUrl('jibunAddr'), fromUrl('parcelAddress'),
        (() => {
            const combo = `${sget('ldCodeNm')} ${sget('mnnmSlno')}`.trim();
            return combo || '';
        })()
    );

    const useName = pickStr(
        ds.use, ds.useName,
        sget('useName'), sget('gf:useName'),
        sget('mainPurpsCdNm'), sget('buldPrposClCodeNm'), sget('mainPurpsClCodeNm'),
        bi.use, bi.useName,
        fromUrl('useName'), fromUrl('use')
    );

	// 면적(㎡): floorAreaM2 → floorArea → area
	const floorAreaM2 = (function () {
		const n = pickNum(ds.floorAreaM2, ds.floorArea, ds.area,
			sget('floorArea'), sget('BuildingArea'), sget('totArea'), sget('buldBildngAr'), sget('area'),
			bi.floorArea, fromUrl('floorArea'), fromUrl('area'));
		return Number.isFinite(n) && n > 0 ? n : NaN;
	})();

	// 사용연도: builtYear 숫자 우선 → 승인일(YYYY-MM-DD)에서 연도 추출
	const builtYear = (function () {
		let y = pickNum(ds.builtYear, sget('builtYear'), bi.builtYear, fromUrl('builtYear'));
		if (!Number.isFinite(y)) {
			y = yearFrom(sget('useConfmDe')) || yearFrom(sget('useAprDay')) || yearFrom(sget('apprvYmd')) || NaN;
		}
		return Number.isFinite(y) ? y : NaN;
	})();

	// 위치/PNU: 있으면 수집(없어도 무관)
	const lat = pickNum(ds.lat, sget('lat'), bi.lat, fromUrl('lat'));
	const lon = pickNum(ds.lon, sget('lon'), sget('lng'), bi.lon, bi.lng, fromUrl('lon'), fromUrl('lng'));
	// gf:pnu → pnu → dataset 순으로도 체크
	const pnu = pickStr(ds.pnu, sget('gf:pnu'), sget('pnu'), bi.pnu, fromUrl('pnu'));

	// 3) 주소 → regionRaw(시·구 2토큰) 생성(광역/특별시 접미사는 제거)
	const addrBase = pickStr(roadAddr, jibunAddr);
	let regionRaw = addrBase.split(/\s+/).slice(0, 2).join(' ').replace('광역시', '').replace('특별시', '').trim();
	if (!regionRaw) regionRaw = '대전';	// 폴백

	// 4) 기간(from/to): dataset/URL/기본값(10년 구간)
	const win = (function () {
		let fromY = Number(ds.from) || Number(fromUrl('from'));
		let toY = Number(ds.to) || Number(fromUrl('to'));
		if (!Number.isFinite(fromY)) fromY = NOW_YEAR;
		if (!Number.isFinite(toY)) toY = fromY + HORIZON_YEARS;
		if (toY < fromY) [fromY, toY] = [toY, fromY];
		return { from: fromY, to: toY };
	})();

	// 5) 최종 컨텍스트
	const ctx = {
		buildingName: buildingName || undefined,
		roadAddr: roadAddr || undefined,
		jibunAddr: jibunAddr || undefined,
		useName: useName || undefined,
		floorAreaM2: Number.isFinite(floorAreaM2) ? floorAreaM2 : undefined,
		builtYear: Number.isFinite(builtYear) ? builtYear : undefined,
		pnu: pnu || undefined,
		lat: Number.isFinite(lat) ? lat : undefined,
		lon: Number.isFinite(lon) ? lon : undefined,
		regionRaw,
		from: String(win.from),
		to: String(win.to)
	};
	return ctx;
}
// ─────────────────────────────────────────────────────────────

// buildingType2/1을 최우선 정규화 입력으로 사용하고, 그 다음 useName/use → 이름/주소 휴리스틱 순
function resolveCoreType(ctx, options = {}) {
	try {
		const noOfficeFallback = !!options.noOfficeFallback;

		// 1) 영어 코어타입 최우선: catalog.type / ctx.type / mappedType
        const preset = String(
            ctx?.catalog?.type ?? ctx?.type ?? ctx?.mappedType ?? ''
        ).trim().toLowerCase();

		if (['factory','hospital','school','office'].includes(preset)) {
			return preset;
		}

		// 2) buildingType2 → buildingType1 → useName → use  순으로 시도
		const rawUsePrimary =
			ctx?.buildingType2 ||
			ctx?.buildingType1 ||
			ctx?.useName ||
			ctx?.use ||
			'';

		let mapped = mapUseToCoreType(rawUsePrimary, { noOfficeFallback });

		// 3) 마지막 보조: 카탈로그 한글(useName/use)도 시도
        if (!mapped && ctx?.catalog) {
            mapped = mapUseToCoreType(
                ctx.catalog.buildingType2 ||
                ctx.catalog.buildingType1 ||
                ctx.catalog.useName ||
                ctx.catalog.use, { noOfficeFallback }
            );
        }

		if (!mapped) {
			const byName = mapUseToCoreType(ctx?.buildingName, { noOfficeFallback });
			const byAddr = mapUseToCoreType(ctx?.address, { noOfficeFallback });
			mapped = byName || byAddr || null;
		}

		ctx.mappedType = mapped;
		if (window.SaveGreen?.log?.kv) {
			window.SaveGreen.log.kv('main', 'type resolved', {
				source: mapped ? (rawUsePrimary ? 'buildingType/use' : (ctx?.buildingName ? 'name' : 'addr')) : 'unknown',
				raw: rawUsePrimary || ctx?.buildingName || ctx?.address || null,
				mapped: mapped
			});
		}
		return mapped;
	} catch (e) {
		SaveGreen.log.warn('main', 'resolveCoreType failed', e);
		return null;
	}
}


/* ==========================================================
 * 5) runForecast(): 컨텍스트 수집→가정 주입→데이터 로드→차트
 * ========================================================== */
// dataset → 프로바이더 쿼리스트링 변환
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
    const TAG = 'main';
    const FN  = 'applyAssumptionsToDataset';

    const ds   = (rootEl?.dataset) || {};
    const base = ctx?.daeBase || {};
    const defaults = ctx?.daeDefaults || {};

    // 타입·가정 미확정 방어: undefined를 빈 객체로 고정
    if (!base || typeof base !== 'object') base = {};
    if (!defaults || typeof defaults !== 'object') defaults = {};

    // 1) 표시용(dataset) – 비어있을 때만 채움
    if (!ds.unitPrice) {
        const unit = (base.tariffKrwPerKwh ?? base.unitPrice ?? base.tariff?.unit ?? base.tariff);
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

    // 2) 계산용 숫자 – 전역 통일 (계산은 0 폴백 허용)
    const fallbackUnit = (base.tariffKrwPerKwh ?? base.unitPrice ?? base.tariff?.unit ?? base.tariff ?? undefined);
    const fallbackEscPct = (
        (base.tariffEscalationPct ?? base.tariff?.escalationPct) ??
        ((typeof defaults.electricityEscalationPctPerYear === 'number') ? Math.round(defaults.electricityEscalationPctPerYear * 100) : 3)
    );
    const fallbackDiscPct = (
        (base.discountRatePct ?? base.discount?.ratePct) ??
        ((typeof defaults.discountRate === 'number') ? Math.round(defaults.discountRate * 100) : 5)
    );

    window.__FORECAST_ASSUMP__ = {
        tariffUnit: toNum(ds.unitPrice, (fallbackUnit ?? 0)),
        tariffEscalation: toPct(ds.tariffEscalationPct, fallbackEscPct),
        discountRate: toPct(ds.discountRatePct, fallbackDiscPct)
    };

    // 3) UI 즉시 반영(전력단가/계산기준) — 값 없으면 빈칸
    try {
        const unitRaw = (base.tariffKrwPerKwh ?? base.unitPrice ?? base.tariff?.unit ?? base.tariff);
        const tariffText = (unitRaw != null && unitRaw !== '') ? `${nf1(unitRaw)} 원/kWh (가정)` : '';
        const basisText = (ctx?.euiRules?.mode === 'primary') ? '1차에너지 기준 산출' : '단위면적당 에너지 사용량 기준';
        fillAssumptionKV({ tariffText, basisText });
    } catch {}

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

let kpiFromServer = null;

/**
 * runForecast — 예측 실행 메인 파이프라인(화면 1회 호출당 1회 실행)
 * ------------------------------------------------------------
 * [1] 컨텍스트 수집(getBuildingContext)
 *     - 화면/세션/URL/VWorld 등 소스에서 빌딩 컨텍스트를 단일 구조로 수집.
 *     - 직후 calcForecastWindow로 내부 from/to 보정(표시용 dataset 칩은 이 시점에 건드리지 않음).
 *
 * [2] 컨텍스트 보강(enrichContext, catalog 매칭)
 *     - providers.enrichContext가 있으면 좌표·주소 등 보강.
 *     - loadCatalog → matchCatalogItem으로 카탈로그 엔트리 매칭.
 *     - applyCatalogToContext(있으면)로 buildingName/pnu/use/builtYear/floorAreaM2 등을 주입.
 *     - catalog.type(영문)이 있으면 코어타입(factory/school/hospital/office) 확정(최우선).
 *
 * [3] 컨텍스트 검증/로그
 *     - 필수값(특히 면적/연식) 누락 여부를 ctx.__flags에 기록하고, 토스트/로그로 안내.
 *     - 이후 계산에서 사용할 표준 면적키(floorAreaM2)를 pickAreaM2()로 “강제 확정”.
 *
 * [4] 가정 주입(dae.json → base/rules/defaults)
 *     - resolveCoreType으로 타입 확정(office 강제 폴백 금지 옵션 우선).
 *     - 타입 확정 시에만 getBaseAssumptions로 단가/투자비 가정 로드.
 *     - getEuiRulesForType(또는 getEuiRules)로 등급 룰을 ctx.euiRules에 보관.
 *     - applyAssumptionsToDataset로 화면 상단 “예측 가정” 패널에 반영.
 *
 * [5] 데이터 로드
 *     - 서버 forecast API or 더미(makeDummyForecast)로 시계열 수신.
 *     - catalog·dataset 힌트로 baselineKwh(최근연도 전력사용량)를 확보 → window.__EUI_NOW 산출.
 *     - 건물별 절대규모 맞춤: after[0]과 baseline 비율로 series.after/saving 및 cost.saving 일괄 스케일 보정.
 *
 * [6] ML KPI 호출/정합
 *     - trainThenPredictOrFallback(buildMlPayload(ctx,data)) 호출로 서버 KPI 수신.
 *     - harmonizeSavingWithMl_Safe()로 “서버 신뢰” 정합(부족 시 보정만).
 *     - computePaybackYears로 회수기간 폴백(서버 PB=0/NaN 대비).
 *
 * [7] KPI·등급·배너 결정
 *     - SaveGreen.Forecast.computeKpis로 KPI 객체 확정(서버 값 우선).
 *     - EUI 룰로 현재 등급/목표경계 도출, decideStatusByScore로 상태 결정 → applyStatus.
 *
 * [8] 로더 종료/결과 노출/차트 재생
 *     - ensureMinLoaderTime → finishLoader로 로더 종료.
 *     - runABCSequence로 A→B→C 차트 순차 재생.
 *     - C 완료 콜백에서 renderKpis/summary/배너 트랜지션 노출.
 */
async function runForecast() {
    const $result = $el('#result-section');
    const $ml = $el('#mlLoader');
    const $surface = $el('.result-surface');

    SaveGreen.log.info('forecast', 'run start');

    // 실행마다 컨텍스트 스냅샷 1회만 허용
    window.__CTX_LOGGED_ONCE__ = false;

    show($ml);
    hide($result);
    startLoader();

    let ctx, useDummy = false;
    const root = document.getElementById('forecast-root');

    try {
        // 컨텍스트 수집
        ctx = await getBuildingContext();

        // 컨텍스트 수집 직후 기간 고정
        //  - 목적: 내부 계산용 ctx.from/to는 기본 창(예: 2025~2035)으로 세팅하되,
        //          상단 칩(표시용)인 dataset.from/to는 "시작하기" 이후에만 채운다.
        //  - 효과: 초기 화면에선 칩에 "-"만 보이고, 예측 실행 후에만 "YYYY–YYYY"가 뜸.
        {
            const win = calcForecastWindow(ctx, /* data 아직 없음 */ null);

            // 내부 컨텍스트는 기본값 보정(백엔드 호출/로직 진행에 필요)
            if (!Number.isFinite(Number(ctx.from))) ctx.from = String(win.from);
            if (!Number.isFinite(Number(ctx.to))) ctx.to   = String(win.to);
            // 표시용 dataset.from/to는 여기서 세팅하지 않는다.
            // (URL로 from/to가 들어온 경우엔 3-3 단계에서만 세팅되어, 그때만 초기부터 보이게 허용)
        }

        // 컨텍스트 보강(enrich)
        try {
            const P = window.SaveGreen?.Forecast?.providers;
            if (P && typeof P.enrichContext === 'function') {
                ctx = await P.enrichContext(ctx) || ctx;
            }
        } catch (e) {
            SaveGreen.log.warn('forecast', 'enrich skipped', e);
        }

        // 카탈로그 로드/매칭 → 컨텍스트/프리로드 보강
        try {
            const catalogList = await loadCatalog();
            const matched = matchCatalogItem(ctx, catalogList);
            ctx.catalog = matched || null;

            // matched 적용 블록 안
            if (matched) {
            	SaveGreen.log.info('catalog', 'matched');

            	if (window.SaveGreen?.Forecast?.providers?.applyCatalogToContext) {
            		ctx = window.SaveGreen.Forecast.providers.applyCatalogToContext(matched, ctx);
            	} else {
            		const pick = (v) => (v == null || String(v).trim() === '') ? undefined : v;
            		ctx.buildingName = ctx.buildingName || pick(matched.buildingName);
            		ctx.pnu          = ctx.pnu          || pick(matched.pnu);
            		ctx.roadAddr     = ctx.roadAddr     || pick(matched.roadAddr || matched.roadAddress);
            		ctx.jibunAddr    = ctx.jibunAddr    || pick(matched.jibunAddr);
            		ctx.useName      = ctx.useName      || pick(matched.useName || matched.use);
            		ctx.builtYear    = ctx.builtYear    || pick(matched.builtYear);
            		ctx.floorAreaM2  = ctx.floorAreaM2  || pick(Number(matched.floorArea));
            	}

            	// buildingType2/1도 정규화 입력에 포함 (공장/병원 등 한글을 바로 factory/hospital로 매핑)
                // 우선순위: matched.mappedType → matched.type → buildingType2 → buildingType1 → useName → use
                ctx.mappedType = ctx.mappedType || matched.mappedType || null;
                ctx.type = ctx.type
                	|| matched.type
                	|| (mapUseToCoreType
                		? mapUseToCoreType(
                			matched.buildingType2
                			|| matched.buildingType1
                			|| matched.useName
                			|| matched.use
                		)
                		: null);


            	await applyCatalogHints(ctx);

            	// catalog의 영문 type이 있으면 최우선 확정
                (function forceEnglishCoreType(ctx) {
                	// 카탈로그 주입 함수가 있으면 catalogItem에, 없으면 matched 객체에 실려 있음
                	const t = (ctx?.catalogItem?.type ?? ctx?.catalog?.type ?? ctx?.type ?? '')
                		.toString().trim().toLowerCase();

                	if (['factory','school','hospital','office'].includes(t)) {
                		ctx.type = t;
                		ctx.mappedType = t;
                		// 로그
                		if (window.SaveGreen?.log?.kv) {
                			window.SaveGreen.log.kv('type', 'forced by catalog.type (en)', { type: t });
                		}
                	}
                })(ctx);
            }

             // 카탈로그 적용 후에도 type 미해결이면 '로그만' 남기고 계속 진행
            if (!ctx.type) {
                if (window.SaveGreen?.log?.kv) {
                    window.SaveGreen.log.kv('main', 'type unresolved — proceed without type (using dae defaults)', {
                        source: ctx.source || 'unknown',
                        use: ctx.useName || null,
                        buildingType1: ctx.buildingType1 || null,
                        buildingType2: ctx.buildingType2 || null
                    });
                } else {
                    console.warn('[main] type unknown — proceed without type (using dae defaults)');
                }
                // 파이프라인은 그대로 진행(기본 가정/dae.json 사용). 값은 비워 둔다.
                ctx.__typeUnresolved = true;
            }

        } catch (e) {
            SaveGreen.log.warn('catalog', 'pipeline error', e);
        }

        // enrich + catalog 보강이 모두 끝난 '최종' 스냅샷 1회만 로그
        if (!window.__CTX_LOGGED_ONCE__) {
            const areaFix = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
            SaveGreen.log.ctx('provider', {
                buildingName: ctx.buildingName || undefined,
                builtYear: ctx.builtYear,
                floorArea: Number.isFinite(areaFix) ? areaFix : undefined,
                area: Number.isFinite(areaFix) ? areaFix : undefined,
                roadAddr: ctx.roadAddr || undefined,
                jibunAddr: ctx.jibunAddr || undefined,
                lat: ctx.lat,
                lon: ctx.lon,
                from: ctx.from,
                to: ctx.to
            }, 'provider');
            window.__CTX_LOGGED_ONCE__ = true;
        }

        // 컨텍스트 검증(필수값 누락 안내)
        (function () {
            const n = (x) => Number.isFinite(Number(x)) ? Number(x) : NaN;

            const areaVal = n(ctx.floorAreaM2 ?? ctx.floorArea ?? ctx.area);
            const hasArea = Number.isFinite(areaVal) && areaVal > 0;

            const byVal = n(ctx.builtYear);
            const hasBuiltYear = Number.isFinite(byVal) && byVal > 0;

            // 화면/로깅용 플래그
            ctx.__flags = { missingArea: !hasArea, missingBuiltYear: !hasBuiltYear };

            if (!hasArea) {
                showToast('면적 값이 없어 EUI 등급은 추정 기준으로 표시됩니다.', 'warn');
                SaveGreen.log.info('main', 'validation = missing floorArea');
            } else {
                // 확정 면적을 표준 키(floorAreaM2)에 고정
                ctx.floorAreaM2 = areaVal;
            }

            if (!hasBuiltYear) {
                showToast('사용연도가 없어 추정값으로 계산됩니다.', 'warn');
                SaveGreen.log.info('main', 'validation = missing builtYear (use inferred)');
            }
        })();

        /**
         * pickAreaM2(ctx) — 면적 소스 우선순위 픽(숫자 파싱 포함)
         * ------------------------------------------------------------
         * [의도] UI 최신 입력이 가장 신뢰도 높다고 가정하고 아래 순으로 선택:
         *   1) dataset(data-*; 화면 최신 입력)
         *   2) sessionStorage(최근 저장값; 팀에서 쓰던 키들까지 모두 호환)
         *   3) catalog(JSON; 카탈로그에 기록된 면적)
         *   4) ctx(마지막 폴백)
         * [결과] 유효한 숫자면 면적(m²)을 반환, 아니면 NaN.
         * [주의] 숫자 파싱 시 콤마/공백을 제거하여 안전 파싱.
         */
        function pickAreaM2(ctx) {
        	// 숫자 파서(콤마/공백 제거)
        	const toNum = (v) => {
        		if (v == null) return NaN;
        		const x = Number(String(v).replace(/[,\s]/g, ''));
        		return (Number.isFinite(x) && x > 0) ? x : NaN;
        	};
        	const sget = (k) => (sessionStorage.getItem(k) || '').trim();

        	// 1) dataset(data-attrs) — 화면(UI)에서 넘어온 최신값 최우선
        	const ds = (document.getElementById('forecast-root')?.dataset) || {};
        	const fromDs =
        		toNum(ds.floorAreaM2 ?? ds.floorArea ?? ds.area);
        	if (Number.isFinite(fromDs)) return fromDs;

        	// 2) sessionStorage — Finder/입력 단계에서 저장된 최근값
        	const fromSS =
        		toNum(sget('floorAreaM2')) ||
        		toNum(sget('floorArea'))   ||
        		toNum(sget('area'))        ||
        		toNum(sget('BuildingArea'));
        	if (Number.isFinite(fromSS)) return fromSS;

        	// 3) catalog JSON — 카탈로그의 면적
        	const fromCat = toNum(ctx?.catalog?.floorAreaM2 ?? ctx?.catalog?.floorArea);
        	if (Number.isFinite(fromCat)) return fromCat;

        	// 4) ctx 폴백 — 그 외 컨텍스트 기본값
        	const fromCtx = toNum(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
        	return Number.isFinite(fromCtx) ? fromCtx : NaN;
        }

        /**
         * forceFloorAreaByPriority() — 선택된 면적을 컨텍스트 표준 키로 ‘강제 확정’
         * ------------------------------------------------------------
         * [의도] 이후의 모든 계산/표시가 동일한 면적 소스를 참조하도록 표준화.
         * [결과] ctx.floorAreaM2 에 최종 확정값을 기록(로그로 소스(origin)도 함께 남김).
         * [주의] 여기서는 값 “기록”만 하고, 계산 로직에는 관여하지 않는다.
         */
        (function forceFloorAreaByPriority() {
            const chosen = pickAreaM2(ctx);
            if (Number.isFinite(chosen)) {
                ctx.floorAreaM2 = chosen;
                if (window.SaveGreen?.log?.kv) {
                    window.SaveGreen.log.kv('main', 'floorArea fixed (priority)', { floorAreaM2: chosen, source: 'SS|CAT|DS|CTX' });
                }
            }
        })();

    async function applyBaseAssumptionsStep(root, ctx) {
        try {
            const F = window.SaveGreen?.Forecast || {};

            // 1) 타입 결정(불확실 시 null 반환)
            const mappedType = resolveCoreType(ctx, { noOfficeFallback: true }) || resolveCoreType(ctx) || null;

            // 2) dae.json 로드
            const dae = (typeof F.loadDaeConfig === 'function') ? await F.loadDaeConfig() : null;

            // 3) 타입 확정시에만 base 가정 로드(office 강제 폴백 금지)
            let base = null;
            if (dae && mappedType) {
                base = (typeof F.getBaseAssumptions === 'function')
                    ? F.getBaseAssumptions(dae, mappedType)
                    : null;
            }

            // 4) 컨텍스트/규칙 보관
            ctx.mappedType = mappedType || null;
            ctx.daeBase = base || null;

            try {
                if (dae) {
                    const getT = (F.getEuiRulesForType || F.getEuiRules);
                    if (typeof getT === 'function' && mappedType) {
                        ctx.euiRules = getT(dae, mappedType);
                        window.SaveGreen.Forecast._euiRules = ctx.euiRules;
                    }
                }
                if (dae && typeof F.getDefaults === 'function') {
                    ctx.daeDefaults = F.getDefaults(dae);
                }
            } catch {}

            // 5) 표시/계산 가정 반영(타입 미확정이면 단가 비워둠)
            applyAssumptionsToDataset(root, ctx);

            // 6) 로깅/상태
            const b = ctx.daeBase || {};
            logMainBasePretty({ mappedType: ctx.mappedType, base: b });
            if (window.LOADER && ctx.mappedType) {
                const labelMap = { factory:'제조/공장', school:'교육/학교', hospital:'의료/병원', office:'업무/오피스' };
                window.LOADER.setStatus(`예측 가정: ${labelMap[ctx.mappedType] || ctx.mappedType}`);
            }

        } catch (e) {
            SaveGreen.log.warn('forecast', 'dae/base step skipped', e);
        }
    }
    await applyBaseAssumptionsStep(root, ctx);

    } catch (e) {
        SaveGreen.log.warn('forecast', 'no context → fallback to dummy', e);
        ctx = fallbackDefaultContext(root);
        useDummy = true;
        applyAssumptionsToDataset(root, ctx);
    }

    // 데이터 로드(실제 API 또는 더미)
    const data = useDummy ? makeDummyForecast(ctx.from, ctx.to) : await fetchForecast(ctx);
    window.FORECAST_DATA = data;

    // 면적은 session→catalog→dataset→ctx 우선순위로 픽
    const areaM2 = Number(pickAreaM2(ctx)) || 0;

    let baselineKwh = NaN;

    // 카탈로그의 마지막 연도 전력사용량 우선
    try {
    	const yc = ctx?.catalog?.yearlyConsumption;
    	if (Array.isArray(yc) && yc.length) {
    		const last = yc[yc.length - 1];
    		const v = Number(last?.electricity ?? last?.kwh ?? last?.value);
    		if (Number.isFinite(v) && v > 0) baselineKwh = v;
    	}
    } catch {}

    // 서버 시계열 baseline[0]
    if (!Number.isFinite(baselineKwh)) {
    	const b0 = Number(data?.series?.baseline?.[0]);
    	if (Number.isFinite(b0) && b0 > 0) baselineKwh = b0;
    }

    // after[0]과 절감률로 역산(폴백)
    if (!Number.isFinite(baselineKwh)) {
    	const a0 = Number(data?.series?.after?.[0]);
    	const sp = Number(kpiFromServer?.savingPct);
    	if (a0 > 0 && Number.isFinite(sp) && sp > 0) {
    		baselineKwh = a0 / (1 - sp / 100);
    	}
    }

    // dataset 힌트 폴백
    if (!Number.isFinite(baselineKwh)) {
    	const ds = (document.getElementById('forecast-root')?.dataset) || {};
    	const hint = Number(ds.energyKwh || ds.baselineKwh || ds.lastYearKwh);
    	if (Number.isFinite(hint) && hint > 0) baselineKwh = hint;
    }

    // 최종 EUI(절감 전) 산출
    // 지역변수 선언 없이 전역 저장만!
    window.__EUI_NOW = (areaM2 > 0 && Number.isFinite(baselineKwh))
        ? Math.round(baselineKwh / areaM2)
        : NaN;

    // 건물별 실측/카탈로그의 마지막 연도 kWh로 서버 시계열 스케일 보정
    // - 목적: 서버 더미 시계열이라도 건물마다 절대량(규모)은 달라지게 맞춤
    // - 원리: scale = baseline(lastYear_kWh from catalog or dataset) / after[0]
    //         → series.after/saving 및 cost.saving 에 동일 배율 적용
    (function forceScaleByBaseline() {
        try {
            // 1) 카탈로그에서 마지막 연도 kWh 추출 시도
            let baseline = NaN;
            const yc = ctx?.catalog?.yearlyConsumption;
            if (Array.isArray(yc) && yc.length) {
                const lastRec = yc[yc.length - 1];
                const v = Number(
                    lastRec?.electricity ??
                    lastRec?.kwh ??
                    lastRec?.value
                );
                if (Number.isFinite(v) && v > 0) baseline = v;
            }

            // 2) dataset 힌트가 있으면 폴백 사용
            if (!Number.isFinite(baseline)) {
                const rootEl = document.getElementById('forecast-root');
                const ds = (rootEl?.dataset) || {};
                const lv = Number(ds.lastYearKwh || ds.energyKwh || ds.baselineKwh);
                if (Number.isFinite(lv) && lv > 0) baseline = lv;
            }

            // 3) 서버 after[0]과 비교하여 배율 계산 → 전체 시계열에 적용
            const a0 = Number(data?.series?.after?.[0]);
            if (Number.isFinite(baseline) && Number.isFinite(a0) && a0 > 0) {
                const scale = baseline / a0;

                // 에너지(after/saving) 스케일
                if (Array.isArray(data?.series?.after)) {
                    data.series.after = data.series.after.map(x => {
                        const n = Number(x);
                        return Number.isFinite(n) ? Math.round(n * scale) : x;
                    });
                }
                if (Array.isArray(data?.series?.saving)) {
                    data.series.saving = data.series.saving.map(x => {
                        const n = Number(x);
                        return Number.isFinite(n) ? Math.round(n * scale) : x;
                    });
                }

                // 비용(saving)도 kWh×단가 기반이므로 동일 배율 적용(서버값이 있으면 맞춰줌)
                if (Array.isArray(data?.cost?.saving)) {
                    data.cost.saving = data.cost.saving.map(x => {
                        const n = Number(x);
                        return Number.isFinite(n) ? Math.round(n * scale) : x;
                    });
                }
            }
        } catch (e) {
            SaveGreen.log.warn('forecast', 'baseline scale skipped', e);
        }
    })();

    // ML 호출 직전 보강(식별 필드)
    (function ensureIdentityFields() {
        const rootEl = document.getElementById('forecast-root');
        const ds = (rootEl?.dataset) || {};
        const sget = (k) => (sessionStorage.getItem(k) || '').trim();

        if (!ctx.buildingName) {
            ctx.buildingName =
                ds.buildingName || ds.bname ||
                sget('buildingName') || sget('buldNm') ||
                null;
        }
        if (!ctx.pnu) {
            ctx.pnu = ds.pnu || sget('pnu') || null;
        }

        if (!ctx.address) {
            const addr = ds.roadAddr || ds.jibunAddr || sget('roadAddr') || sget('jibunAddr') || '';
            ctx.address = addr && addr.trim() ? addr.trim() : null;
        }

        if (typeof ctx.buildingName === 'string' && !ctx.buildingName.trim()) ctx.buildingName = null;
        if (typeof ctx.pnu === 'string' && !ctx.pnu.trim()) ctx.pnu = null;
    })();

    // ML KPI 호출
    try {
        const mlResp = await trainThenPredictOrFallback(() => buildMlPayload(ctx, data));
        const kpi = mlResp?.kpi || null;
        if (kpi) {
            kpiFromServer = {
                savingKwhYr: Number(kpi.savingKwhYr) || 0,
                savingCostYr: Number(kpi.savingCostYr) || 0,
                savingPct: Number(kpi.savingPct) || 0,
                paybackYears: Number.isFinite(Number(kpi.paybackYears)) ? Number(kpi.paybackYears) : 99,
                label: kpi.label || 'NOT_RECOMMEND'
            };
        } else {
            kpiFromServer = { savingKwhYr: 0, savingCostYr: 0, savingPct: 0, paybackYears: 99, label: 'NOT_RECOMMEND' };
        }
    } catch (e) {
        SaveGreen.log.warn('kpi', 'ML bridge failed → fallback', e?.message || e);
        kpiFromServer = { savingKwhYr: 0, savingCostYr: 0, savingPct: 0, paybackYears: 99, label: 'NOT_RECOMMEND' };
    }

    // [가드] 숫자 강제
    if (kpiFromServer) {
        kpiFromServer.savingKwhYr = Number(kpiFromServer.savingKwhYr) || 0;
        kpiFromServer.savingCostYr = Number(kpiFromServer.savingCostYr) || 0;
        kpiFromServer.savingPct = Number(kpiFromServer.savingPct) || 0;
        kpiFromServer.paybackYears = Number.isFinite(Number(kpiFromServer.paybackYears))
            ? Number(kpiFromServer.paybackYears)
            : 99;
        kpiFromServer.label = kpiFromServer.label || 'NOT_RECOMMEND';
    }

    // 클라이언트 재계산 최소화(서버 신뢰 모드)
    /**
     * 서버가 반환한 절감 KPI/시계열이 있으면 그대로 사용하고,
     * 없을 때만 최소한의 보정(Forward-fill, 타입 확인)만 수행한다.
     * - 재계산/덮어쓰기를 하지 않아 FE-서버 숫자 불일치를 방지.
     */
    (function harmonizeSavingWithMl_Safe() {
    	// 서버 응답 신뢰 플래그(기본 true). 필요 시 디버그용으로만 false.
    	const TRUST_SERVER = true;

    	if (!TRUST_SERVER) return;	// 과거 재계산 로직 쓰려면 false로.

    	// 서버 시계열 존재 여부 확인
    	const hasServerSavingKwh = Array.isArray(window.FORECAST_DATA?.series?.saving)
    		&& window.FORECAST_DATA.series.saving.some(v => Number.isFinite(Number(v)));

    	// 서버 비용 절감 존재 여부
    	const hasServerSavingCost = Array.isArray(window.FORECAST_DATA?.cost?.saving)
    		&& window.FORECAST_DATA.cost.saving.some(v => Number.isFinite(Number(v)));

    	// 서버가 제공하면 그대로 신뢰. 없다면 타입 보정만.
    	if (hasServerSavingKwh && hasServerSavingCost) {
    		// nothing: 신뢰 모드에서는 덮어쓰지 않음
    		return;
    	}

    	// 없을 때만 간단 보정: 단가×kWh (에스컬레이션은 서버에 일임)
    	try {
    		const unit = Number(window.__FORECAST_ASSUMP__?.tariffUnit) || 145;
    		const saving = Array.isArray(window.FORECAST_DATA?.series?.saving)
    			? window.FORECAST_DATA.series.saving.map(v => Number(v) || 0)
    			: [];

    		if (!hasServerSavingCost && saving.length) {
    			window.FORECAST_DATA.cost = window.FORECAST_DATA.cost || {};
    			window.FORECAST_DATA.cost.saving = saving.map(k => Math.round(k * unit));
    		}
    	} catch { /* no-op */ }
    })();


    // 배열 길이/타입 보정(Forward-fill)
    {
        const expectedYears = Array.isArray(data.years) ? data.years.map(String) : [];
        const L = expectedYears.length;

        data.years = expectedYears;
        data.series = data.series || {};
        data.cost = data.cost || {};

        data.series.after = toNumArrFFill(data.series.after, L);
        data.series.saving = toNumArrFFill(data.series.saving, L);
        data.cost.saving = toNumArrFFill(data.cost.saving, L);
    }

    // 메타패널(기간/모델/특징)
    updateMetaPanel({
        years: window.FORECAST_DATA.years,
        model: '머신러닝 예측',
        features: (function () {
            const feats = ['연도'];
            if (Array.isArray(window.FORECAST_DATA?.series?.after)) feats.push('사용량');
            if (Array.isArray(window.FORECAST_DATA?.cost?.saving)) feats.push('비용 절감');
            return feats;
        })()
    });

    /**
     * reconcileKpiAndGraph() — 서버 KPI와 그래프 시계열의 “시각화 정합”
     * ------------------------------------------------------------
     * [의도] 서버 KPI(savingKwhYr/savingCostYr)와 FE 그래프(cost.saving)의 단가/상승 곡선을 일치시킴.
     * [핵심]
     *  1) 단가 역추정: savingCostYr / savingKwhYr 로 unitUsed 추정(합리 범위: 80~1000 KRW/kWh),
     *     불가 시 FE 가정 단가(__FORECAST_ASSUMP__.tariffUnit) 사용.
     *  2) 비용 절감 시계열 생성: series.saving(kWh) × unitUsed × (1+escalation)^t
     *  3) 회수기간 폴백: 서버 paybackYears가 0/NaN이면 computePaybackYears()의 계산값 사용.
     *  4) 절감률 현실 가드: savingPct는 5~40% 범위로 클램프(실무 체감범위).
     * [주의] 이 단계는 “정합(align)”만 수행하며, 서버가 준 값이 있으면 우선 신뢰하고 덮어쓰지 않음.
     */
	(function reconcileKpiAndGraph() {
		if (!kpiFromServer || !Array.isArray(data?.series?.saving) || !data.series.saving.length) return;

		// 1) 단가 역추정(서버값 신뢰) → 그래프 비용절감 정합
		const unitFe = Number(window.__FORECAST_ASSUMP__?.tariffUnit) || 145;
		const uInf = (Number(kpiFromServer.savingCostYr) > 0 && Number(kpiFromServer.savingKwhYr) > 0)
			? (Number(kpiFromServer.savingCostYr) / Number(kpiFromServer.savingKwhYr))
			: NaN;

		// 한국 요금 단가 합리 범위
		const unitUsed = (Number.isFinite(uInf) && uInf >= 80 && uInf <= 1000) ? uInf : unitFe;

		// 에스컬레이션 반영하여 그래프 비용 시계열 생성
		const esc = Number(window.__FORECAST_ASSUMP__?.tariffEscalation) || 0; // 예: 0.03
		data.cost.saving = data.series.saving.map((k, i) => Math.round((Number(k) || 0) * unitUsed * Math.pow(1 + esc, i)));

		// 2) 첫 해 기준 KPI 재정렬 및 '회수기간' 폴백 계산
		const fb = computePaybackYears(ctx, data, unitUsed, kpiFromServer);

		// 서버 payback이 0/NaN 이거나 과도하게 벗어나면 폴백값으로 교체
		let pb = Number(kpiFromServer.paybackYears);
		const badPb = !Number.isFinite(pb) || pb <= 0;
		if (badPb) pb = fb.paybackYears;

		// savingPct 현실 범위 가드
		let savingPct = Number(kpiFromServer.savingPct) || 0;
		if (savingPct < 5 || savingPct > 40) savingPct = window.clamp(savingPct, 5, 40);

		// KPI를 ‘첫 해 기준’으로 확정
		kpiFromServer = {
			savingKwhYr: Number(fb.firstSavingKwh) || Number(kpiFromServer.savingKwhYr) || 0,
			savingCostYr: Number(fb.firstSavingCost) || Number(kpiFromServer.savingCostYr) || 0,
			savingPct: Math.round(savingPct),
			paybackYears: Number.isFinite(pb) ? pb : 99,
			label: kpiFromServer.label || 'NOT_RECOMMEND'
		};
	})();

    // KPI/등급/배너  (← harmonize 이후 계산!)
    const floorArea = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);

    // 비용/회수기간을 프런트 가정으로 즉시 재계산(서버 KPI 무시)
    // false로 바꾸면 다시 '서버 KPI 우선' 모드로 복귀
    const FE_OVERRIDES_COST_PAYBACK = false;
    const kpiFromApiForCompute = FE_OVERRIDES_COST_PAYBACK ? null : kpiFromServer;

    const kpi = SaveGreen.Forecast.computeKpis({
        years: data.years,
        series: data.series,
        cost: data.cost,
        kpiFromApi: kpiFromApiForCompute,
        base: ctx.daeBase || null,
        floorArea: Number.isFinite(floorArea) ? floorArea : undefined
    });

    // 회수기간 현실화(소프트코스트·초기 3년 평균·유지보수 차감)
    // 서버 KPI 무시 모드(FE 재계산 우선)에서만 의미가 큼
    (function adjustPaybackRealistic() {
    	try {
    		const base = ctx?.daeBase || {};
    		const floorArea = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
    		const capexPerM2 = Number(base?.capexPerM2 ?? 0);

    		// 타입별 간접비(soft cost) + 규모 보정 + 중복가산 방지 (공격적)
    		const t = String(ctx?.mappedType || '').toLowerCase();
    		let softCostPct = 0.10; // 기본 더 낮춤
    		if (t === 'hospital') softCostPct = 0.10;
    		else if (t === 'factory') softCostPct = 0.10;
    		else if (t === 'school')  softCostPct = 0.08;
    		else if (t === 'office')  softCostPct = 0.08;

    		if (Number.isFinite(floorArea)) { // 규모의 경제
    			if (floorArea >= 20000) softCostPct -= 0.02;
    			else if (floorArea >= 10000) softCostPct -= 0.01;
    		}
    		const includesSoft = String((ctx?.daeBase || {}).capexIncludesSoftCost || '').toLowerCase();
    		if (includesSoft === 'true' || includesSoft === '1') softCostPct = 0;
    		softCostPct = Math.max(0, softCostPct);

    		// 적용범위(scope) + 보조금(subsidy) 더 강화 (CAPEX ↓)
    		let scopeRatio = 0.85, subsidyRatio = 0.15;
    		if (t === 'hospital') { scopeRatio = 0.50; subsidyRatio = 0.35; } // 가장 강하게
    		else if (t === 'factory') { scopeRatio = 0.60; subsidyRatio = 0.25; }
    		else if (t === 'school')  { scopeRatio = 0.90; subsidyRatio = 0.15; }
    		else if (t === 'office')  { scopeRatio = 0.90; subsidyRatio = 0.15; }

    		const capexHard = (Number.isFinite(capexPerM2) && Number.isFinite(floorArea))
    			? capexPerM2 * floorArea
    			: 0;
    		const capexWithSoft = capexHard * (1 + softCostPct);
    		const capexEff = capexWithSoft * scopeRatio * (1 - subsidyRatio); // 분자에 사용

    		// 절감비용 시계열 기반
    		const arr = Array.isArray(data?.cost?.saving) ? data.cost.saving : [];
    		let avg3 = 0;
    		if (arr.length > 0) {
    			const n = Math.min(3, arr.length);
    			let sum = 0;
    			for (let i = 0; i < n; i++) {
    				const v = Number(arr[i]); sum += Number.isFinite(v) ? v : 0;
    			}
    			avg3 = sum / (n || 1);
    		}

    		// 상승 반영 폭 확대: 5/7/10년차 중 가장 큰 값 채택
    		const year5 = Number(arr[4]), year7 = Number(arr[6]), year10 = Number(arr[9]);
    		const baseSaving = Math.max(
    			avg3,
    			Number.isFinite(year5) ? year5 : -Infinity,
    			Number.isFinite(year7) ? year7 : -Infinity,
    			Number.isFinite(year10) ? year10 : -Infinity
    		);

    		// 타입별 유지보수(더 낮춤) + 운영개선(더 높임) (분모 ↑)
    		let maintenanceOpexPct = 0.007, opUpliftPct = 0.05;
    		if (t === 'hospital') { maintenanceOpexPct = 0.008; opUpliftPct = 0.10; }
    		else if (t === 'factory') { maintenanceOpexPct = 0.009; opUpliftPct = 0.07; }
    		else if (t === 'school')  { maintenanceOpexPct = 0.007; opUpliftPct = 0.05; }
    		else if (t === 'office')  { maintenanceOpexPct = 0.007; opUpliftPct = 0.05; }

    		let effSavingCost = baseSaving * (1 - maintenanceOpexPct) * (1 + opUpliftPct);

    		// 회수기간 재산정 + 클램프(최대 60년으로 완화)
    		let payback = (effSavingCost > 0) ? (capexEff / effSavingCost) : Infinity;
    		if (!Number.isFinite(payback)) payback = 60;
    		payback = Math.max(0.5, Math.min(60, payback));

    		kpi.paybackYears = Math.round(payback * 10) / 10;

    		if (window.SaveGreen?.log?.kv) {
    			window.SaveGreen.log.kv('kpi', 'payback realistic override', {
    				type: t,
    				capexPerM2,
    				floorArea,
    				softCostPct,
    				scopeRatio,
    				subsidyRatio,
    				capexHard: Math.round(capexHard),
    				capexWithSoft: Math.round(capexWithSoft),
    				capexEff: Math.round(capexEff),
    				avg3SavingCost: Math.round(avg3),
    				year5SavingCost: Number.isFinite(year5) ? Math.round(year5) : null,
    				year7SavingCost: Number.isFinite(year7) ? Math.round(year7) : null,
    				year10SavingCost: Number.isFinite(year10) ? Math.round(year10) : null,
    				maintenanceOpexPct,
    				opUpliftPct,
    				paybackYears: kpi.paybackYears
    			});
    		}
    	} catch (e) {
    		SaveGreen.log.warn('forecast', 'adjust payback realistic skipped', e);
    	}
    })();

    /**
     * EUI 등급 유틸(문자 등급 포함) — 안전한 밴드 탐색/경계값 추출
     * ------------------------------------------------------------
     * [지원] primaryGradeBands / electricityGradeThresholds / gradeBands / bands
     * [규칙] min ≤ eui < max (마지막 밴드는 max 포함), 문자 등급('1++')도 안전 처리.
     * [목표 등급 경계] 현재 등급의 ‘한 단계 위’ 밴드의 상한(max)을 경계로 사용.
     * [주의] 룰이 비어있거나 EUI가 NaN이면 null/폴백을 반환(렌더 쪽에서 내고 가드).
     */
    // ===== EUI 등급 계산 안전판 (키 명 혼동/누락 대응) =====
    function _extractBands(rules) {
        if (!rules || typeof rules !== 'object') return [];
        // 가장 먼저 존재하는 키를 사용
        const candidates = [
            rules.gradeBands,
            rules.electricityGradeBands,
            rules.primaryGradeBands,
            rules.bands
        ].filter(Array.isArray);
        return candidates[0] || [];
    }

    // min ≤ eui < max 규칙(마지막 구간은 max 포함)
    function pickGradeByRulesSafe(eui, rules) {
        if (!Number.isFinite(eui)) return null;
        const bands = _extractBands(rules);
        if (!bands.length) return null;

        // 정렬 보정(안전)
        bands.sort((a, b) => Number(a.min) - Number(b.min));

        for (let i = 0; i < bands.length; i++) {
            const b = bands[i];
            const min = Number(b.min);
            const max = Number(b.max);
            const isLast = i === bands.length - 1;
            const inRange = isLast
                ? (eui >= min && eui <= max)
                : (eui >= min && eui < max);
            // [수정] grade가 '1++' 같은 문자일 수도 있으므로, 숫자로 강제 변환하지 않고 안전 반환
            if (inRange) return (Number.isFinite(Number(b.grade)) ? Number(b.grade) : String(b.grade));
        }
        return null;
    }

    // 목표 등급(숫자)에 해당하는 EUI 경계값(상한)을 가져오기
    function getBoundaryForGradeSafe(targetGrade, rules) {
        const bands = _extractBands(rules);
        if (!bands.length) return null;
        const band = bands.find(b => Number(b.grade) === Number(targetGrade));
        if (!band) return null;
        // 관례: '그 등급의 상한값'을 경계로 보여줌
        return { value: Number(band.max), unit: 'kWh/m²·년' };
    }

    const euiRules = ctx.euiRules || window.SaveGreen?.Forecast?._euiRules || null;
    const currentEui = window.__EUI_NOW; // ← baseline 기준으로 방금 계산한 값

    let gradeNow = null;
    if (euiRules && Number.isFinite(currentEui)) {
        gradeNow = pickGradeByRulesSafe(currentEui, euiRules);
    }

    // 폴백은 진짜로 룰/면적이 없을 때만
    if (gradeNow == null) {
        gradeNow = (kpi.savingPct >= 30) ? 1
                : (kpi.savingPct >= 20) ? 2
                : (kpi.savingPct >= 10) ? 3
                : 4;
    }

    // 결과 요약 경계도 같은 룰로
    let boundary = null;
    // 등급이 숫자형/문자형(예: 1++, 1+++) 모두 지원
    if (euiRules && gradeNow != null) {
    	const bands = (function (rules) {
    		const arr = rules?.primaryGradeBands || rules?.electricityGradeThresholds || [];
    		return Array.isArray(arr) ? arr.slice().sort((a, b) => Number(a.min) - Number(b.min)) : [];
    	})(euiRules);

    	if (bands.length) {
    		let idx = -1;
    		for (let i = 0; i < bands.length; i++) {
    			const g = bands[i]?.grade;
    			if ((typeof gradeNow === 'number' && Number(g) === Number(gradeNow)) ||
    				(typeof gradeNow !== 'number' && String(g) === String(gradeNow))) {
    				idx = i; break;
    			}
    		}
    		if (idx > 0) {
    			// 한 단계 상향(숫자 더 좋은 쪽) 경계 = 바로 위 밴드의 상한
    			const better = bands[idx - 1];
    			boundary = { value: Number(better.max), unit: 'kWh/m²·년' };
    		} else if (idx === 0) {
    			// 이미 최고 등급이면, 현재 밴드 상한을 그대로 노출
    			boundary = { value: Number(bands[0].max), unit: 'kWh/m²·년' };
    		}
    	}
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

    // ABC 순차 실행(차트)
    await runABCSequence({
    	ctx,
    	baseForecast: data,
    	onCComplete: () => {
    		// KPI 카드
    		renderKpis(kpi, { gradeNow });

    		// euiNow 보강: 면적 + (after0 또는 savingKwhYr & savingPct)로 역산
    		let euiNowSafe = Number(currentEui);
    		if (!Number.isFinite(euiNowSafe)) {
    			const fa = Number(ctx?.floorAreaM2 ?? 0);
    			const sp = Number(kpi?.savingPct ?? NaN);               // 서버 KPI 절감률(%)
    			const after0 = Number(data?.series?.after?.[0] ?? NaN);  // 첫해 절감 후 kWh
    			const savingKwhYr = Number(kpi?.savingKwhYr ?? NaN);     // 첫해 절감 kWh

    			if (fa > 0 && Number.isFinite(sp) && sp > 0) {
    				let baseline = NaN;
    				if (Number.isFinite(after0)) {
    					baseline = after0 / (1 - sp / 100);
    				} else if (Number.isFinite(savingKwhYr)) {
    					baseline = savingKwhYr / (sp / 100);
    				}
    				if (Number.isFinite(baseline)) {
    					euiNowSafe = baseline / fa; // kWh/㎡·년
    				}
    			}
    		}

    		// 보강된 값을 전달
    		renderSummary({ gradeNow, kpi, rules: euiRules, euiNow: euiNowSafe, ctx });

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
    			} catch {
    				show($surface);
    			}
    		}
    	}
    });
    setPreloadState('complete');
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

let euiNowSafe = Number(euiNow);
if (!Number.isFinite(euiNowSafe)) {
	const fa = Number(ctx?.floorAreaM2 ?? 0);
	const sp = Number(kpi?.savingPct ?? NaN);         // 서버 KPI 절감률(%)
	const after0 = Number(series?.after?.[0] ?? NaN); // 첫해 절감 후 kWh
	const savingKwhYr = Number(kpi?.savingKwhYr ?? NaN);

	if (fa > 0 && Number.isFinite(sp) && sp > 0) {
		if (Number.isFinite(after0)) {
			const baseline = after0 / (1 - sp / 100);
			euiNowSafe = baseline / fa;
		} else if (Number.isFinite(savingKwhYr)) {
			const baseline = savingKwhYr / (sp / 100);
			euiNowSafe = baseline / fa;
		}
	}
}

/** 요약 리스트(EUI 경계/필요 절감률 등) — euiRules 기반 */
function renderSummary({ gradeNow, kpi, rules, euiNow, ctx }) {
	// 안전한 숫자 포맷(소수 1자리, 천단위)
	function fmt1(n) {
		const x = Number(n);
		if (!Number.isFinite(x)) return '-';
		// 소수 1자리 반올림 + 천단위 콤마
		return x.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	}
	const ul = $el('#summary-list');
	if (!ul) return;
	ul.innerHTML = '';

	const gradeNowNum = Number(String(gradeNow ?? '').match(/\d+/)?.[0]);
    /**
     * 결과 요약 패널(텍스트) — 현재/목표/경계/EUI + 메타(연도/면적)
     * ------------------------------------------------------------
     * [구성]
     *  - 현재 등급 / 목표(한 단계 상향) / 등급 상승 경계(EUI 값) / 추정 현재 EUI
     *  - 메타: 사용승인연도, 면적 (dataset 우선, ctx 보완)
     * [스타일]
     *  - 주요 수치는 <strong>으로 강조(굵게), 리스트는 <li>로 추가.
     *  - innerHTML 사용 시 XSS 예방: 여기서는 정해진 포맷 + 숫자/단위만 사용.
     * [주의]
     *  - 등급이 문자(예: '1++')인 경우도 그대로 표기.
     *  - 목표 등급은 이미 최상위면 '최고 등급'으로 표기(경계값 노출은 현재 밴드 상한).
     */
	// dae.json 기준: 배열형 grade bands에서 목표 경계(max) 찾기
	function _extractBands(r) {
		if (!r || typeof r !== 'object') return [];
		const cands = [r.primaryGradeBands, r.electricityGradeBands, r.gradeBands, r.bands].filter(Array.isArray);
		return cands[0] || [];
	}
	function getBoundaryForGradeSafe(targetGrade, r) {
		const bands = _extractBands(r);
		if (!bands.length) return null;
		const band = bands.find(b => Number(b.grade) === Number(targetGrade));
		if (!band) return null;
		return { value: Number(band.max), unit: 'kWh/㎡·년' }; // 상한 경계 사용
	}

    // 등급 밴드 안전 추출(좋은 등급 → 나쁜 등급 순으로 정렬)
    function __pickBandsAsc(rules) {
    	// rules.primaryGradeBands | electricityGradeThresholds | gradeBands | bands 중 첫 번째
    	const cand = rules?.primaryGradeBands || rules?.electricityGradeThresholds || rules?.gradeBands || rules?.bands || [];
    	if (!Array.isArray(cand)) return [];
    	// EUI는 값이 낮을수록 좋으므로 min 오름차순 = 좋은→나쁜
    	return cand.slice().sort((a, b) => Number(a.min) - Number(b.min));
    }

    // 현재 등급에서 '한 단계 상향' 라벨/경계 구하기(숫자/문자 등급 모두 지원)
    function __getNextBetterGrade(gradeNow, rules) {
    	const bands = __pickBandsAsc(rules);
    	if (!bands.length || gradeNow == null) return { label: '상위 등급', boundary: null };

    	// 현재 등급의 인덱스 찾기(문자 완전일치 우선, 그다음 숫자 동치)
    	let idx = bands.findIndex(b => String(b.grade) === String(gradeNow));
    	if (idx < 0 && Number.isFinite(Number(gradeNow))) {
    		const gnum = Number(gradeNow);
    		idx = bands.findIndex(b => Number(b.grade) === gnum);
    	}

    	// 못 찾으면 안전 폴백
    	if (idx < 0) return { label: '상위 등급', boundary: null };

    	// 인덱스 0이면 이미 최고 등급
    	if (idx === 0) {
    		const top = bands[0];
    		return {
    			label: '최고 등급',
    			boundary: { value: Number(top.max), unit: 'kWh/m²·년' }
    		};
    	}

    	// 한 단계 더 좋은 등급 = 바로 '앞' 밴드
    	const better = bands[idx - 1];
    	const betterLabel = `${better.grade}등급`; // '1++등급' 처럼 문자/숫자 모두 자연스럽게 처리
    	return {
    		label: betterLabel,
    		boundary: { value: Number(better.max), unit: 'kWh/m²·년' }
    	};
    }

    // 목표 등급(한 단계 상향) 결정
    const { label: targetGradeText, boundary } = __getNextBetterGrade(gradeNow, rules);

	// 텍스트 구성(한 번만 렌더)
	const lines = [];

	// 현재 등급
	lines.push(`현재 등급 : <strong>${(typeof gradeNow === 'number') ? `${gradeNow}등급` : String(gradeNow)}</strong>`);

	// 목표 등급
	lines.push(`목표 등급 : <strong>${targetGradeText}</strong>`);

	// EUI 현재값
	if (Number.isFinite(euiNow)) {
		lines.push(`추정 현재 EUI : <strong>${fmt1(euiNow)} kWh/㎡·년</strong>`);
	}

	// 목표 경계(있을 때만)
	if (boundary && Number.isFinite(boundary.value)) {
		lines.push(`등급 상승 기준(EUI 경계값) : <strong>${fmt1(boundary.value)} ${boundary.unit}</strong>`);
	}

	// --- 사용승인연도/면적을 lines에 추가(같은 스타일, strong 포함) ---
    {
    	const n = (v) => {
    		const x = Number(String(v ?? '').replace(/[,\s]/g, ''));
    		return Number.isFinite(x) ? x : NaN;
    	};
    	const ds = (document.getElementById('forecast-root')?.dataset) || {};

    	// 값 수집
    	let built = n(ctx?.builtYear);
    	if (!Number.isFinite(built)) built = n(ds.builtYear);

    	let areaM2 = n(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
    	if (!Number.isFinite(areaM2)) areaM2 = n(ds.floorAreaM2 ?? ds.floorArea ?? ds.area);

    	// 표시 텍스트
    	const builtText = (Number.isFinite(built) && built > 0) ? String(built) : '정보 없음';
    	const areaText  = (Number.isFinite(areaM2) && areaM2 > 0)
        	? `${Number(areaM2).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`
        	: '정보 없음';

    	// 맨 위에 오도록 prepend: built → area 순서
    	lines.unshift(`면적 : <strong>${areaText}</strong>`);
    	lines.unshift(`사용승인연도 : <strong>${builtText}</strong>`);
    }

	// 렌더(단 한 번)
	for (const html of lines) {
		const li = document.createElement('li');
		li.innerHTML = html;
		ul.appendChild(li);
	}

	// 주석/주의 문구
	const notes = [];
	if (ctx?.__flags?.missingArea) notes.push('면적 데이터 미확정 → EUI 등급 추정');
	if (ctx?.__flags?.missingBuiltYear) notes.push('사용연도 데이터 미확정 → 추정 연식');

	try {
		const summaryEl = document.getElementById('summary-panel') || ul.parentElement || ul;
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
    const esc = (t) => String(t).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
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
    if (b.builtYear && !fromQs('builtYear')) rows.push(row('준공연도', String(b.builtYear)));
    box.innerHTML = `<div class="card building-card"><h4>건물 정보</h4>${rows.join('')}</div>`;
    box.classList.remove('hidden');
}

// ML 로그 스냅샷 기본 경로(Spring 경유)
window.__ML_LOG_URL__ = '/api/forecast/ml/logs/latest?lastN=80';
window.__DISABLE_ML_LOG_SNAPSHOT__ = false; // 필요 시 true로 끔

let __ML_LOG_LAST_ETAG__ = null;

async function fetchMlLogSnapshot() {
    if (window.__DISABLE_ML_LOG_SNAPSHOT__) return { ok: false };
    const url = window.__ML_LOG_URL__;
    if (!url) return { ok: false };

    try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
        if (!res.ok) return { ok: false };

        const et = res.headers.get('ETag') || res.headers.get('Last-Modified') || '';
        const json = await res.json();

        if (et && et === __ML_LOG_LAST_ETAG__) {
            return { ok: true, changed: false, data: json };
        }
        __ML_LOG_LAST_ETAG__ = et;
        return { ok: true, changed: true, data: json };
    } catch {
        return { ok: false };
    }
}

// 최신 엔트리만 뽑아오는 래퍼 (점수 파싱용)
async function fetchMlLogSnapshotLatest() {
    const snap = await fetchMlLogSnapshot();
    if (!snap?.ok) return null;
    const data = snap.data || {};
    const arr = Array.isArray(data.lastN) ? data.lastN : [];
    const entry = data.lastEntry || (arr.length ? arr[arr.length - 1] : null);
    if (!entry) return null;
    return { entry, path: data.path || data.file || data.url || '' };
}

/* ------------------------------------------------------------
 * ML 점수 파서:
 *  - 입력: snapshot.latest entry (JSONL 한 줄 파싱 결과)
 *  - 지원 포맷:
 *      a) entry.metrics = { model:'B_RandomForest', train:{mae,rmse,r2}, test:{...} }
 *      b) entry.message 문자열에 [score] ... MAE=..., RMSE=..., R2=... 패턴 존재
 *  - 출력 예:
 *      {
 *        model: 'B_RandomForest',
 *        train: { mae:1.7068, rmse:2.1606, r2:0.8920 },
 *        test : { mae:1.9992, rmse:2.5800, r2:0.8760 }
 *      }
 * ------------------------------------------------------------ */
function parseMlScoresFromEntry(entry) {
	if (!entry) return null;

	// 1) 명시적 metrics 필드 우선
	if (entry.metrics && (entry.metrics.train || entry.metrics.test)) {
		const m = entry.metrics;
		const norm = (o) => (!o ? null : {
			mae: Number(o.mae),
			rmse: Number(o.rmse),
			r2: Number(o.r2)
		});
		return {
			model: m.model || m.name || 'unknown',
			train: norm(m.train),
			test:  norm(m.test)
		};
	}

	// 2) message 문자열 파싱([score] ... MAE=..., RMSE=..., R2=...)
	const line = String(entry.message || entry.msg || '').trim();
	if (!line) return null;

	// 모델명
	let model = 'unknown';
	const mModel = line.match(/\[score\]\s+([A-Z]_[\w]+|\w+)/i);
	if (mModel && mModel[1]) model = mModel[1];

	// TRAIN
	const mTrain = line.match(/TRAIN\s+MAE\s*=\s*([0-9.]+)\s*,\s*RMSE\s*=\s*([0-9.]+)\s*,\s*R2\s*=\s*([\-0-9.]+)/i);
	// TEST
	const mTest  = line.match(/TEST\s+MAE\s*=\s*([0-9.]+)\s*,\s*RMSE\s*=\s*([0-9.]+)\s*,\s*R2\s*=\s*([\-0-9.]+)/i);

	const take = (arr) => (!arr ? null : {
		mae: Number(arr[1]),
		rmse: Number(arr[2]),
		r2: Number(arr[3])
	});

	if (!mTrain && !mTest) return null;
	return { model, train: take(mTrain), test: take(mTest) };
}

/* ------------------------------------------------------------
 * 최신 스냅샷에서 점수 추출(+ΔMAE 계산) 후 콘솔에 A/B/C로 분배 로깅
 * - A/B/C 매핑 규칙:
 *    · A: 선형/기초 (키워드: Linear, Ridge 등)
 *    · B: 랜덤포레스트/트리류 (키워드: RandomForest, XGB, LightGBM 등)
 *    · C: 앙상블/스태킹/블렌딩 (키워드: Ensemble, Stacking, Blending, Weighted 등)
 * ------------------------------------------------------------ */
async function logScoresFromSnapshotToCharts() {
	try {
		const snap = await fetchMlLogSnapshotLatest();
		if (!snap?.entry) return;

		const score = parseMlScoresFromEntry(snap.entry);
		if (!score) return;

		// ΔMAE (test - train)
		const dMae = (score.test?.mae != null && score.train?.mae != null)
			? (Number(score.test.mae) - Number(score.train.mae))
			: null;

		// 시리즈 라벨 판정
		const name = String(score.model || '').toLowerCase();
		let serie = 'chart A';
		if (/(forest|xgb|lightgbm|tree)/.test(name)) serie = 'chart B';
		else if (/(ensemble|stack|blend|weighted)/.test(name)) serie = 'chart C';

		// 출력 형식
		const fmt = (o) => (!o ? 'MAE=n/a, RMSE=n/a, R2=n/a'
			: `MAE=${(o.mae ?? 'n/a')}, RMSE=${(o.rmse ?? 'n/a')}, R2=${(o.r2 ?? 'n/a')}`);

		// 원하는 포맷으로 2줄 출력
		SaveGreen.log.info(serie, `[score] ${score.model} TRAIN  ${fmt(score.train)}`);
		if (dMae != null) {
			SaveGreen.log.info(serie, `[score] ${score.model} TEST   ${fmt(score.test)}  (ΔMAE=${dMae > 0 ? '+' : ''}${dMae?.toFixed(4)})`);
		} else {
			SaveGreen.log.info(serie, `[score] ${score.model} TEST   ${fmt(score.test)}`);
		}
	} catch {
		// 조용히 무시
	}
}

// 학습은 "비동기 시작"만 트리거하고, 예측은 즉시 진행한다.
// - 서버는 이미 202 Accepted로 즉시 응답하므로 FE가 기다릴 필요 없음.
// - waitTrainDone()은 백그라운드로만 돌려서 진행상황 로그/스냅샷을 보조 출력(UX 차단 X).
async function trainThenPredictOrFallback(buildPredictPayload) {
	try {
		// 1) 학습 트리거(즉시 202 예상)
		let jobId = null;
		try {
			jobId = await startMlTrain();
			SaveGreen.log.info('kpi', 'train started (async), predict with current model');

			// ------------------------------------------------------------------
			// 학습 트리거 직후 run_id 확보
			// - 원칙: 서버가 "현재 세션의 최신 run_id"를 알고 있으므로
			//   window.SaveGreen.MLLogs.ensureRunId() 로 URL/전역/세션/서버 순으로 복구
			// - 성공 시 dataset(#forecast-root[data-run-id])에도 심어 공유
			// ------------------------------------------------------------------
			try {
				if (window.SaveGreen?.MLLogs?.ensureRunId) {
					const rid = await window.SaveGreen.MLLogs.ensureRunId();
					if (rid) {
						const root = document.getElementById('forecast-root');
						if (root?.dataset) root.dataset.runId = rid;
						SaveGreen.log.debug('kpi', `run_id set (post-train trigger) → ${rid}`);
					}
				}
			} catch (e) {
				SaveGreen.log.debug('kpi', `ensureRunId post-train trigger failed: ${String(e)}`);
			}
			// ------------------------------------------------------------------

		} catch (err) {
			// 학습 트리거 실패해도 예측은 진행 (경고만 남김)
			SaveGreen.log.warn('kpi', `train not started → ${String(err)}`);
		}

		// 2) 학습 상태 폴링은 "백그라운드"로만 수행 (UI 블로킹 금지)
		//    - 완료되면 info 로그와 ml-log snapshot만 업데이트
		if (jobId) {
			(async () => {
				try {
					const res = await waitTrainDone(jobId, {
						intervalMs: 1200,          // 시작 1.2s
						timeoutMs: 5 * 60 * 1000,  // 총 5분
						perRequestTimeoutMs: 12000,
						maxNetErr: 5,
						onTick: (s) => SaveGreen.log.debug('kpi', 'train tick', s)
					});

					if (res?.ok) {
						SaveGreen.log.info('kpi', 'train finished (bg)');

						// 백그라운드 완료 시점에 한 번 더 보장
						// 일부 환경에선 완료 시점에 run_id가 세션에 최종 반영되므로 재확보
						try {
							if (window.SaveGreen?.MLLogs?.ensureRunId) {
								const rid2 = await window.SaveGreen.MLLogs.ensureRunId();
								if (rid2) {
									const root = document.getElementById('forecast-root');
									if (root?.dataset) root.dataset.runId = rid2;
									SaveGreen.log.debug('kpi', `run_id verified (bg done) → ${rid2}`);
								}
							}
						} catch (e) {
							SaveGreen.log.debug('kpi', `ensureRunId on bg-done failed: ${String(e)}`);
						}

						try {
							const snap = await fetchMlLogSnapshotLatest();
							if (snap) {
								SaveGreen.log.info(
									'chart C',
									'ml-log snapshot (post-train)',
									snap.path ? snap.path.split(/[\\/]/).pop() : ''
								);
							}
						} catch {}
					} else {
						SaveGreen.log.debug('kpi', 'train still running (bg), non-blocking', res?.status || 'UNKNOWN');
					}

				} catch (e) {
					SaveGreen.log.info('kpi', `train bg polling stopped → ${String(e)}`);
				}
			})();
		}

		// 3) 예측은 즉시 진행
		const payload = buildPredictPayload();
		try { logMlPayloadPretty(payload); } catch {}

		// 예측 직전 로그 스냅샷(선택) — 요약만 debug로
		try {
			const snap = await fetchMlLogSnapshotLatest();
			if (snap?.entry) {
				SaveGreen.log.debug('chart C', `ml-log ready (pre-predict) · last=1 line @ ${snap.path ? snap.path.split(/[\\/]/).pop() : ''}`);
			}
		} catch {}

		// 예측 직전에도 run_id 최종 보장(경고 방지용)
		// 차트 A/B/C 시작 시 consoleScoresByRunAndLetter(...)에서 runId 필요
		try {
			if (window.SaveGreen?.MLLogs?.ensureRunId) {
				await window.SaveGreen.MLLogs.ensureRunId();
			}
		} catch {}

		return await callMl(payload);

	} catch (e) {
		// 진짜 예외 시에도 폴백으로 예측은 시도
		SaveGreen.log.warn('kpi', `train+predict flow error → ${String(e)}`);
		try {
			const payload = buildPredictPayload();

			// 폴백에서도 run_id 보장 시도
			try {
				if (window.SaveGreen?.MLLogs?.ensureRunId) {
					await window.SaveGreen.MLLogs.ensureRunId();
				}
			} catch {}

			return await callMl(payload);
		} catch (e2) {
			SaveGreen.log.error('kpi', `predict failed → ${String(e2)}`);
			throw e2;
		}
	}
}

/* ==========================================================
 * 8) 차트/데이터/유틸 모음
 * ========================================================== */
// 사용자 경고/알림용 미니 토스트
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
    } catch { }
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
    const renderEnergyComboChart =
        typeof F.renderEnergyComboChart === 'function' ? F.renderEnergyComboChart : (window.renderEnergyComboChart || undefined);

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
            SaveGreen.log.warn('forecast', 'model error, fallback', { id, error: e });
        }
        // modelOrFallback() 내부 폴백용 src 생성 라인
        const src = Array.isArray(baseForecast?.series?.after)
            ? baseForecast.series.after.slice(0, n)
            : new Array(n).fill(0);

        const yhat = src.map((v, i, a) => Math.round(((Number(a[i - 1] ?? v)) + Number(v) + Number(a[i + 1] ?? v)) / 3));
        return { model: { id, version: 'fallback' }, years: years.slice(), yhat };
    }

    const y_true = Array.isArray(baseForecast?.series?.after) ? baseForecast.series.after.slice(0, n) : new Array(n).fill(0);

    // 기본: 로컬 점수 로그 끔(ML [score] 라인만 쓰기)
    const SHOW_LOCAL_SCORES = (window.__SHOW_LOCAL_SCORES__ === true);

    // ── A
    const A = modelOrFallback('A');
    await renderModelAChart?.({ years: A.years, yhat: A.yhat, costRange });
    // 서버 점수(A) 한 줄 로그
    await SaveGreen.MLLogs.consoleScoresByRunAndLetter('A');

    // ── B
    const B = modelOrFallback('B');
    await renderModelBChart?.({ years: B.years, yhat: B.yhat, costRange });
    // 서버 점수(B) 한 줄 로그
    await SaveGreen.MLLogs.consoleScoresByRunAndLetter('B');

    // ── C (Ensemble)
    try { if (makeEnsemble) void makeEnsemble([A, B]); } catch {}
    const Cyhat = years.map((_, i) => {
        const a = Number(A.yhat?.[i]);
        const b = Number(B.yhat?.[i]);
        const vals = [a, b].filter(Number.isFinite);
        return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
    });

    const subtitleOverride = resolveChartSubtitle(document.getElementById('forecast-root'));
    await renderEnergyComboChart?.({
        years,
        series: baseForecast.series,
        cost: baseForecast.cost,
        costRange,
        subtitleOverride
    });
    // 서버 점수(C) 한 줄 로그
    await SaveGreen.MLLogs.consoleScoresByRunAndLetter('C');
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

    const after = toNumArrFFill(d?.series?.after, L);
    const saving = toNumArrFFill(d?.series?.saving, L);
    const cost = { saving: toNumArrFFill(d?.cost?.saving, L) };
    const kpi = d?.kpi ?? null;

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
    const el = document.getElementById('meta-data-range');
    if (!el) return;

    // 시작 전(대기 상태)에는 무조건 "-" 강제 표시
    // setPreloadState('idle')가 init()에서 이미 붙여둔 body 클래스 사용
    if (document.body.classList.contains('is-idle')) {
        el.textContent = '-';
        return;
    }

    // 실행 중/완료 상태에서는 dataset 값이 있을 때만 표시
    const root = document.getElementById('forecast-root');
    if (!root) { el.textContent = '-'; return; }

    const from = root.dataset.from;
    const to   = root.dataset.to;

    if (!from || !to) {
        el.textContent = '-';
        return;
    }
    el.textContent = (String(from) === String(to)) ? `${from}년` : `${from}–${to}`;
}

/* ===== 차트 점수 계산 & 한 줄 로그 유틸 (정제/가드 포함) ===== */
function _alignFinitePairs(y, yhat) {
    const a = Array.isArray(y) ? y : [];
    const b = Array.isArray(yhat) ? yhat : [];
    const n = Math.min(a.length, b.length);
    const Y = [], P = [];
    for (let i = 0; i < n; i++) {
        const yi = Number(a[i]);
        const pi = Number(b[i]);
        if (Number.isFinite(yi) && Number.isFinite(pi)) {
            Y.push(yi);
            P.push(pi);
        }
    }
    return { Y, P };
}

function _calcScore(y, yhat) {
    const { Y, P } = _alignFinitePairs(y, yhat);
    const n = Y.length;
    if (!n) return { mae: null, rmse: null, r2: null };

    let se = 0, ae = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
        const e = Y[i] - P[i];
        ae += Math.abs(e);
        se += e * e;
        sumY += Y[i];
    }
    const mae = ae / n;
    const rmse = Math.sqrt(se / n);

    let sst = 0, ssr = 0;
    const ybar = sumY / n;
    for (let i = 0; i < n; i++) {
        sst += (Y[i] - ybar) ** 2;
        ssr += (Y[i] - P[i]) ** 2;
    }
    const r2 = sst > 0 ? 1 - (ssr / sst) : null;
    return { mae, rmse, r2 };
}

function _preferServerMetricsOrLocal(modelId, y, yhat) {
    // 1) 서버 지표 시도
    try {
        const get = window.SaveGreen?.Forecast?.getServerMetric;
        if (typeof get === 'function') {
            const s = get(modelId, 'test'); // 기대: { mae, rmse, r2 }
            const m = {
                mae: Number(s?.mae),
                rmse: Number(s?.rmse),
                r2: (s?.r2 == null ? null : Number(s.r2))
            };
            const okMae = Number.isFinite(m.mae) && m.mae > 0;
            const okRmse = Number.isFinite(m.rmse) && m.rmse > 0;
            const okR2 = (m.r2 === null) || (Number.isFinite(m.r2) && m.r2 <= 0.9999 && m.r2 >= -1);
            // 서버 값이 전부 0이거나 R2=1.0000 고정이면 신뢰하지 않음
            if (okMae || okRmse || okR2) return m;
        }
    } catch { /* ignore */ }
    // 2) 로컬 계산
    return _calcScore(y, yhat);
}

function _logChartOneLine(label, metrics) {
    const F4 = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? (Math.round(n * 1e4) / 1e4).toFixed(4) : '-';
    };
    const mae = F4(metrics?.mae);
    const rmse = F4(metrics?.rmse);
    const r2 = F4(metrics?.r2);
    // label은 'chart A' | 'chart B' | 'chart C' 형태로 전달
    SaveGreen.log.info(label, `MAE=${mae},  RMSE=${rmse},  R2=${r2}`);
}

/** 포맷/헬퍼 */
function nf(n) { try { return new Intl.NumberFormat('ko-KR').format(Math.round(Number(n) || 0)); } catch { return String(n); } }
// 소수점 1자리 포맷터 (전력단가 등)
function nf1(n) { const v = Number(n); return new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number.isFinite(v) ? v : 0); }
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
    let to = parseInt(urlp.get('to') || String(NOW_YEAR + HORIZON_YEARS), 10);
    if (!Number.isFinite(from)) from = NOW_YEAR;
    if (!Number.isFinite(to)) to = from + HORIZON_YEARS;
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