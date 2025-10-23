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

// 버튼 락 전역 변수
let __RUN_LOCK__ = false;

// 헤더 기본 높이(최소값) 캐시
let __HEADER_BASE_MIN__ = null;

/* ======================================================================
 * [ADD][SG-LOGS] ML 점수 로그 유틸 — runId 기반으로 A/B/C 최신 점수를 콘솔에 3줄 포맷 출력
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

        // ▼ 모델 접두사 필터
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

        // ── 표준: train/test 가 둘 다 있으면 그걸로
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

        // ── 폴백: cv(mean/std)만 있어도 표기
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

        // ── ensemble만 있는 경우는 상위 print 함수에서 처리(C 전용)
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

        const lineOf = o => `MAE=${o.mae}, RMSE=${o.rmse}, R2=${o.r2}`;

        if (picked?.train && picked?.test) {
            console.log(`[train] ${lineOf(picked.train)}`);
            console.log(
                `[test ] ${lineOf(picked.test)}${
                picked.test.dmae !== 'n/a' ? `  (ΔMAE=${picked.test.dmae})` : ''
                }`
            );
        } else if (letter === 'C') {
            // C는 앙상블 전용(하드코딩 허용)
            const ens = latestByTs(
                logs.filter(r => r.type === 'metrics' && /^ensemble$/i.test(String(r.kind || '')))
            );
            if (ens?.metrics) {
                const wA = typeof ens.metrics.wA === 'number' ? ens.metrics.wA.toFixed(4) : 'n/a';
                const wB = typeof ens.metrics.wB === 'number' ? ens.metrics.wB.toFixed(4) : 'n/a';
                console.log(`[ensemble] wA=${wA}, wB=${wB}`);
            } else {
                console.log('[ensemble] (no weights)');
            }
        } else {
        console.log('(no train/test logs for this run)');
        }
        console.groupEnd();
    }


    // [ADD] 디버그 도우미: 모델 접두사(A/B/C)별 어떤 kind가 찍혔는지와 최신 metrics를 바로 확인
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
        const logs = await fetchLogsByRun(id);
        printChartScoreLogs(logs, letter);
    }


    // --- (1) 런아이디 세팅: 전역 + 세션에 저장(하드코딩 금지, 동적 주입용) ---
    function setRunId(runId) {
        if (!runId || !String(runId).trim()) return;
        const id = String(runId).trim();
        // 전역(즉시 사용)
        window.__SG_RUN_ID = id;
        // 세션(탭/새로고침 복구)
        try { sessionStorage.setItem('ml.runId', id); } catch {}
    }

    // --- (2) 서버에서 현재 세션의 run_id를 받아오는 API 헬퍼 ---
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

    // --- (3) 보장 헬퍼: 없으면 서버/스토리지에서 찾아서 세팅 후 반환 ---
    async function ensureRunId() {
        // 0) 이미 메모리에 있으면 바로
        if (window.__SG_RUN_ID && String(window.__SG_RUN_ID).trim()) return String(window.__SG_RUN_ID).trim();

        // 1) URL
        try {
            const url = new URL(window.location.href);
            const q = url.searchParams.get('runId');
            if (q && q.trim()) { setRunId(q.trim()); return q.trim(); }
        } catch {}

        // 2) dataset
        try {
            const ds = document.getElementById('forecast-root')?.dataset || {};
            const d = (ds.runId || ds.runid || '').trim();
            if (d) { setRunId(d); return d; }
        } catch {}

        // 3) session/local storage
        try {
            const s = (sessionStorage.getItem('ml.runId') || localStorage.getItem('ml.runId') || '').trim();
            if (s) { setRunId(s); return s; }
        } catch {}

        // 4) 서버-세션(최종 복구 루트)
        const srv = await getServerRunId();
        if (srv) { setRunId(srv); return srv; }

        return null;
    }


    return {
        getRunId, fetchLogsByRun, pickLatestScores, printChartScoreLogs, consoleScoresByRunAndLetter,
        // [NEW]
        setRunId, ensureRunId,
        debugDump   // ← 추가
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

    // ▼ KST 타임스탬프 (HH:MM:SS)
    function _stamp() {
        try {
            return new Intl.DateTimeFormat('ko-KR', {
                timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
            }).format(new Date());
        } catch { return ''; }
    }

    // ▼ 태그별 색상 팔레트
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

    // ▽ 객체를 '키 : 값' 들의 여러 줄 문자열로 변환
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

    // ▽ 실제 출력: 라벨 헤더 + 줄바꿈 + '키 : 값' 블록
    function ctx(label, obj, tag) {
        if (!_ok('info', tag)) return;
        const block = _fmtCtx(obj);
        console.info(`%c[${_stamp()}][${label}]%c\n${block}\n`, _sty(tag), 'color:inherit');
    }

    // [추가] 어떤 객체든 '키 : 값' 형식의 멀티라인으로 출력하는 유틸
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

    // [수정본] Logger 출력 함수 4종
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

// ── 메인(base) 로그 이쁘게: 한글(영어) 라벨 + 숫자 포맷
function logMainBasePretty({ mappedType, base }) {
    const b = base || {};
    const view = {
        '유형(type)': mappedType || '-',
        '전력단가(tariff)': (b?.tariff?.unit ?? b?.tariff ?? '-'),
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
 * ① 건물 컨텍스트(명/주소/용도…) ② 예측 가정(1·2줄) ③ 리스크 배지
 */
function renderPreloadInfoAndRisks() {
    const root = document.getElementById('forecast-root');
    if (!root) return;
    const ds = root.dataset || {};
    const ls = (k) => localStorage.getItem('forecast.' + k) || '';
    const pick = (k) => (ds[k] || ls(k) || '').toString().trim();
    const numOk = (v) => v !== '' && !isNaN(parseFloat(v));

    /* ① 건물 컨텍스트 카드 */
    const bmap = {
        buildingName: pick('buildingName') || ds.bname || '',
        roadAddr: pick('roadAddr') || pick('jibunAddr') || '',
        useName: pick('use') || pick('useName') || '',
        builtYear: pick('builtYear') || '',
        floorArea: pick('area') || pick('floorArea') || '',
        pnu: '' // 사용자 혼란 방지로 비노출
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
        const ds = root.dataset || {};
        const numOk = (v) => v !== '' && !isNaN(parseFloat(v));

        // 단가 표시: dataset.unitPrice 있으면 사용, 없으면 '기본(가정)'
        const unit = ds.unitPrice;
        const tariffText = (unit && numOk(unit)) ? `${nf(unit)} 원/kWh (가정)` : '기본(가정)';

        // 계산 기준: (초기 렌더 시 ctx 없음) → 전역 보관 룰만 참조
        let basisText = 'EUI 기준 산출';
        try {
            const rules = window.SaveGreen?.Forecast?._euiRules || null;
            if (rules?.mode === 'primary') basisText = '1차에너지 기준 산출';
        } catch { }

        const t = $el('#assump-tariff'); if (t) t.textContent = tariffText;
        const bEl = $el('#assump-basis'); if (bEl) bEl.textContent = basisText;
    }

    /* ② 예측 가정(1줄: 단가/상승률/할인율) */
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

    /* ② 예측 가정(2줄: 배출계수/효율개선 또는 요금제/가동률) */
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
    // init 시작: provider 로그는 임시로 숨긴다 (preload/탐색 중 찍히는 miss 제거)
    try { SaveGreen.log.enableTags('main','catalog','kpi','chart','forecast'); } catch {}
    document.getElementById('preload-warn-badges')?.remove();

    initHeaderOffset();

    const root = document.getElementById('forecast-root');


    // 3-1) sessionStorage → dataset 부트스트랩
    bootstrapContextFromStorage(root);

    // [SG-ANCHOR:GF-SESSION-NORMALIZE] ─────────────────────────────────────────────
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

    		// (호환) 일부 코드가 dataset.use를 참조하므로 미러링
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
    setPreloadState('idle');
    renderPreloadInfoAndRisks();

    // [추가] 시작 전에 세션→카탈로그 매칭을 미리 시도하고 로그 남김(있으면 히어로/칩도 하이드레이트)
    if (window.SaveGreen?.Forecast?.bindPreloadFromSessionAndCatalog) {
        SaveGreen.log.info('catalog', 'preload: try session → catalog bind');
        try {
            await window.SaveGreen.Forecast.bindPreloadFromSessionAndCatalog();
            SaveGreen.log.info('catalog', 'preload: session → catalog bind done');
        } catch (e) {
            SaveGreen.log.warn('catalog', 'preload: session → catalog bind failed', e);
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

//        SaveGreen.log.kv('provider', 'preflight seeds (after bind)', seeds, [
//            'buildingName', 'roadAddr', 'jibunAddr', 'pnu', 'builtYear', 'useName', 'floorArea', 'lat', 'lon', 'from', 'to'
//        ]);
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
    } catch { }
}

/** 시작 버튼 결선(없으면 자동 시작) */
function wireStartButtonAndFallback() {
    const btn = document.getElementById('forecast-start');

    setPreloadState('idle');
    renderPreloadInfoAndRisks();

    if (btn) {
        btn.onclick = async () => {
            if (__RUN_LOCK__) return;
            __RUN_LOCK__ = true;
            btn.disabled = true;
            try {
                // 실행 시점부터 provider 로그 다시 허용 (최종 1회만 보이도록)
                try { SaveGreen.log.clearTags(); } catch {}
                setPreloadState('running');
                await runForecast();
            } catch (e) {
                SaveGreen.log.error('forecast', 'run failed', e);
            } finally {
                __RUN_LOCK__ = false;
                btn.disabled = false;
            }
        };
    } else {
        setPreloadState('running');
        try { SaveGreen.log.clearTags(); } catch {}
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

// [SG-ANCHOR:USE-MAP] — 한글 용도 키워드 보강(office 쏠림 완화)
// 한글 → 코어 타입 맵 (mapUseToCoreType에서 사용)
const KOR_USE_TO_CORE = {
    // 제조/산단
    '공장': 'factory', '제조': 'factory', '산단': 'factory', '산업단지': 'factory', '플랜트': 'factory',
    // 의료
    '병원': 'hospital', '종합병원': 'hospital', '의료': 'hospital', '요양': 'hospital',
    '의원': 'hospital', '클리닉': 'hospital', '메디컬': 'hospital', '의료원': 'hospital',
    '치과': 'hospital', '한방': 'hospital',
    // 교육
    '학교': 'school', '교육': 'school', '대학': 'school', '초등': 'school', '중학': 'school', '고등': 'school',
    '캠퍼스': 'school',
    // 업무/그외
    '사무': 'office', '업무': 'office', '오피스': 'office', '연구': 'office', '근린생활': 'office',
    '판매': 'office', '집회': 'office', '문화': 'office', '체육': 'office', '숙박': 'office',
    '창고': 'office', '타워': 'office'
};



function mapUseToCoreType(str) {
    const s = (str || "").toLowerCase();
    for (const [k, v] of Object.entries(KOR_USE_TO_CORE)) {
        if (s.includes(k)) return v;
    }
    return null; // 매칭 실패 시 조기 'office' 확정 금지
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

    function _isNear(a, b, radiusM = 30) {
        if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
        const dx = (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
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

        if ((!candidates || candidates.length === 0) && (session.lat != null && session.lng != null)) {
            candidates = catalog.filter(it => _isNear(
                { lat: session.lat, lng: session.lng },
                { lat: parseFloat(it.lat), lng: parseFloat(it.lon ?? it.lng) },
                30
            ));
        }

        if (!candidates || candidates.length === 0) {
            const bname = (session.buildingName || '').trim();
            if (bname) {
                const lw = bname.toLowerCase();
                candidates = catalog.filter(it => (it.buildingName || '').toLowerCase().includes(lw));
            }
        }

        if (!candidates || candidates.length === 0) return null;
        return candidates[0];
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

    function hydratePreloadUI(rec) {
        try {
            const dateEl = qs('#chipDataDate');
            if (dateEl && rec?.meta?.dataDate) dateEl.textContent = rec.meta.dataDate;

            if (typeof window.renderPreloadInfoAndRisks === 'function') {
                const root = qs('#forecast-root');
                // [추가] 카탈로그에 useName이 없으면 buildingType2 → buildingType1로 보강
                if (!rec.useName) {
                    rec.useName = rec.buildingType2 || rec.buildingType1 || '';
                }

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
    const ra = (ctx.roadAddr || ctx.roadAddress || '').trim();
    const ja = (ctx.jibunAddr || '').trim();
    const bn = (ctx.buildingName || '').trim();
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
            const d = roughDistM({ lat, lon }, { lat: Number(it.lat), lon: Number(it.lon ?? it.lng) });
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
        const base = ctx?.daeBase || {};
        // unitPrice 우선 → tariff.unit → tariff 필드 폴백
        const unitRaw = (base?.unitPrice ?? base?.tariff?.unit ?? base?.tariff);
        const tariffText = (unitRaw != null && unitRaw !== '')
            ? `${nf(unitRaw)} 원/kWh (가정)`
            : '기본(가정)';

        let basisText = 'EUI 기준 산출';
        try {
            // ① 컨텍스트에 이미 룰이 있으면 사용
            let rules = ctx?.euiRules || null;

            // ② 없으면 dae 로드 후 타입별 룰 조회
            if (!rules && SaveGreen?.Forecast?.loadDaeConfig) {
                const dae = await SaveGreen.Forecast.loadDaeConfig();
                const getT = SaveGreen.Forecast.getEuiRulesForType || SaveGreen.Forecast.getEuiRules;
                if (typeof getT === 'function') {
                    rules = getT(dae, ctx?.mappedType || 'office');
                }
            }

            if (rules?.mode === 'primary') {
                basisText = '1차에너지 기준 산출';
            }
        } catch { /* no-op */ }

        const t = $el('#assump-tariff');
        const bEl = $el('#assump-basis');
        if (t && !t.textContent.trim()) t.textContent = tariffText;
        if (bEl && !bEl.textContent.trim()) bEl.textContent = basisText;
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
// [ADD][SG-TRAIN] 학습 트리거/상태 폴링/로그 스냅샷 헬퍼 (import 불필요)
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

	// ★ run_id가 오면 즉시 전역/세션에 저장(하드코딩 금지)
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

// (선택) 최근 ML 로그 스냅샷 1줄 요약
async function fetchMlLogSnapshotLatest() {
	try {
		const res = await fetch('/api/forecast/ml/logs/snapshot/latest', { headers:{ 'Accept':'application/json' } });
		if (!res.ok) return null;
		const js = await res.json();
		// 기대 형식 예: { path:"D:\\CO2\\ml\\data\\manifest.json", entry:"[score] TEST   ..." }
		return js || null;
	} catch { return null; }
}


// === ML 브리지 호출(POST /api/forecast/ml/predict?variant=C) ===
async function callMl(payload) {
    /*
        payload 구조(이미 buildMlPayload에서 맞춰줌)
        {
             typeRaw,            // 예: '사무동' (컨트롤러에서 ML 서버로 그대로 전달)
             regionRaw,          // 예: '대전 서구'
             builtYear,          // 숫자
             floorAreaM2,        // 숫자
             yearlyConsumption: [ { year, electricity } ],   // 옵션
             monthlyConsumption: [ ... ]                     // 옵션
        }
        스프링 → FastAPI로 그대로 프록시되며, FastAPI의 Pydantic 스키마와 일치
    */

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

// === FE가 받은 data로 ML 페이로드 구성 (FastAPI 스키마 준수 버전) ===
// FastAPI /predict 가 기대하는 키:
//   type (string), region (string),
//   builtYear (number), floorAreaM2 (number),
//   energy_kwh (number)  또는  eui_kwh_m2y (number)  둘 중 하나(또는 둘 다)
//   monthlyConsumption?, yearlyConsumption?  ← 있을 때만 포함
// forecast.main.js

// -------------------------------------------------------
// FE → ML 요청 페이로드 생성 (ml_dataset.json 기반 ctx 사용)
// - 목적: FastAPI 스키마에 맞게 yearly/monthly 시계열을
//   "객체 배열" 형태로 전송. (예: { year, electricity })
// - 호환: window.__ML_PAYLOAD_FORM__ = 'array' 로 설정 시
//   레거시(숫자 배열) 형태로 전송 가능(학원/집 환경 차이 대비).
//   기본값은 'objects' (권장).
// -------------------------------------------------------
function buildMlPayload(ctx, data) {
    // 0) 환경별 호환 토글 (기본: 'objects')
    //    - 'objects' : [{year, electricity}], [{ym, electricity}]
    //    - 'array'   : [2150000, 2021000, ...]  (레거시)
    const FORM = (window.__ML_PAYLOAD_FORM__ || 'objects').toLowerCase();

    // 1) 타입 표준화
    const core = new Set(['factory', 'school', 'hospital', 'office']);

    let rawType =
      (ctx?.mappedType) ||
      (ctx?.type) ||
      (ctx?.useName) ||
      (ctx?.buildingType2) ||
      'office';

    rawType = String(rawType).trim().toLowerCase();

    // 한글/자유 텍스트면 매핑 테이블로 변환
    let type = core.has(rawType) ? rawType : mapUseToCoreType(rawType);

    // 2) 면적(㎡) — floorAreaM2 → floorArea → area, 최종 폴백 1000
    const areaNum = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
    const floorAreaM2 = (Number.isFinite(areaNum) && areaNum > 0) ? areaNum : 1000;

    // 3) 사용연도 — 없으면 2000
    const builtYearNum = Number(ctx?.builtYear);
    const builtYear = Number.isFinite(builtYearNum) && builtYearNum > 0 ? builtYearNum : 2000;

    // 4) 지역 문자열 정규화(광역시/특별시 표기 간소화)
    const addrBase = (ctx?.roadAddr || ctx?.jibunAddr || ctx?.address || '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .trim();
    let regionRaw = (ctx?.regionRaw || addrBase.split(/\s+/).slice(0, 2).join(' ') || '대전') + '';
    regionRaw = regionRaw.replace('광역시', '').replace('특별시', '').trim();
    const region = regionRaw; // 백엔드 호환 키

    // 5) 연/월 사용량(있으면 전달) — 스키마 맞춰 변환
    let yearly = undefined, monthly = undefined;

    // 연간: years + series.after 를 매핑
    try {
        const yearsArr = Array.isArray(data?.years) ? data.years.slice() : [];
        const afterArr = Array.isArray(data?.series?.after) ? data.series.after.slice() : [];
        if (yearsArr.length && afterArr.length && yearsArr.length === afterArr.length) {
            if (FORM === 'objects') {
                // 신규 스키마: [{ year, electricity }]
                yearly = yearsArr.map((y, i) => ({
                    year: Number(y),
                    electricity: Number(afterArr[i])
                })).filter(r => Number.isFinite(r.year) && Number.isFinite(r.electricity));
                if (!yearly.length) yearly = undefined;
            } else {
                // 레거시 스키마: 숫자 배열
                yearly = afterArr.map(v => Number(v)).filter(v => Number.isFinite(v));
                if (!yearly.length) yearly = undefined;
            }
        }
    } catch { }

    // 월간: months + series.monthly 를 매핑(있을 때만)
    try {
        const monthsArr  = Array.isArray(data?.months) ? data.months.slice() : [];
        const monthlyArr = Array.isArray(data?.series?.monthly) ? data.series.monthly.slice() : [];

        // "YYYY-MM" 또는 "MM" → 1..12 정수로 변환
        const toMonth01_12 = (s) => {
            const v = String(s || '').trim();
            // 케이스1: YYYY-MM
            const m = v.match(/^\d{4}-?(\d{2})$/);
            if (m) return parseInt(m[1], 10);           // "2025-01" → 1
            // 케이스2: "01" ~ "12" 또는 1 ~ 12
            const n = Number(v);
            return (Number.isFinite(n) && n >= 1 && n <= 12) ? n : NaN;
        };

        if (monthsArr.length && monthlyArr.length && monthsArr.length === monthlyArr.length) {
            if (FORM === 'objects') {
                // 신규 스키마: [{ month:int(1..12), electricity:number }]
                monthly = monthsArr
                    .map((ym, i) => {
                        const month = toMonth01_12(ym);
                        const electricity = Number(monthlyArr[i]);
                        return { month, electricity };
                    })
                    .filter(r => Number.isFinite(r.month) && Number.isFinite(r.electricity));

                if (!monthly.length) monthly = undefined;
            } else {
                // 레거시 스키마: 숫자 배열
                monthly = monthlyArr
                    .map(v => Number(v))
                    .filter(v => Number.isFinite(v));

                if (!monthly.length) monthly = undefined;
            }
        }
    } catch { /* no-op */ }


    // 6) 모델 힌트: 최근연 에너지(kWh)와 EUI(kWh/㎡·년)
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
    } catch { }

    // ★ 유틸: 비어있으면 undefined로(전송 누락), 값 있으면 trimmed string
    const toStrOrUndef = (v) => {
        if (v == null) return undefined;
        const s = String(v).trim();
        return s ? s : undefined;
    };

    // 7) 식별/로그용 필드 — 기존 null → undefined/문자열
    const buildingName = toStrOrUndef(ctx?.buildingName);
    const pnu = toStrOrUndef(ctx?.pnu);
    const address = toStrOrUndef(ctx?.address || ctx?.jibunAddr || ctx?.roadAddr);

    // 8) 최종 조립
    const win = calcForecastWindow(ctx, data);

    const payload = {
      type, region, regionRaw, builtYear, floorAreaM2,
      energy_kwh, eui_kwh_m2y, yearsFrom: win.from, yearsTo: win.to
    };
    if (buildingName !== undefined) payload.buildingName = buildingName;
    if (pnu !== undefined)          payload.pnu = pnu;
    if (address !== undefined)      payload.address = address;

    // 9) 시계열(옵션) — 값이 있을 때만 붙임(없으면 JSON에서 생략)
    if (Array.isArray(yearly) && yearly.length) payload.yearlyConsumption = yearly;
    if (Array.isArray(monthly) && monthly.length) payload.monthlyConsumption = monthly;

    return payload;
}


// [SG-ANCHOR:CTX-BUILDER] ─────────────────────────────────────────────
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
	const pnu = pickStr(ds.pnu, sget('pnu'), bi.pnu, fromUrl('pnu'));

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


function resolveCoreType(ctx) {
    // 0) 카탈로그/기존 힌트(있다면 입력으로만 수용)
    //    - applyCatalogToContext 가 만든 ctx.mappedType, 혹은
    //      외부에서 set한 ctx.type 이 코어타입이면 그대로 확정
    const hint = String(
        (ctx && (ctx.mappedType || ctx.type)) || ''
    ).trim().toLowerCase();
    if (['factory', 'school', 'hospital', 'office'].includes(hint)) {
        return hint;
    }

    // 1) useName / buildingType2 / buildingType1 기반 1차 매핑
    let t = mapUseToCoreType(
        (ctx && (ctx.useName || ctx.buildingType2 || ctx.buildingType1)) || ''
    );

    // 2) 건물명/주소 휴리스틱 (병원/학교/공장 우선)
    if (!t) {
        const hay = [
            ctx && ctx.buildingName,
            ctx && ctx.roadAddr,
            ctx && ctx.jibunAddr
        ].filter(Boolean).join(' ').toLowerCase();

        // 의료 키워드 (한/영 혼용)
        if (/(종합병원|요양병원|의료원|의료법인|병원|의원|클리닉|메디컬|치과|한의원|한방|rehab|재활|hospital|clinic|dental)\b/i.test(hay)) {
            t = 'hospital';
        } else if (/(학교|초등|중학|고등|대학|캠퍼스)/.test(hay)) {
            t = 'school';
        } else if (/(공장|제조|산단|산업단지|플랜트)/.test(hay)) {
            t = 'factory';
        }
    }

    // 3) 저장소 보조는 'office'는 무시 (factory/school/hospital만 수용)
    if (!t) {
        const fromStore = (
            sessionStorage.getItem('forecast.type') ||
            localStorage.getItem('forecast.type') ||
            ''
        ).trim().toLowerCase();
        if (['factory', 'school', 'hospital'].includes(fromStore)) {
            t = fromStore;
        }
    }

    // 4) 최종 폴백
    return t || 'office';
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
        // 5-1) 컨텍스트 수집
        ctx = await getBuildingContext();

        // 5-1-1) 컨텍스트 수집 직후 기간 고정/데이터셋 반영
        {
            const win = calcForecastWindow(ctx, /* data 아직 없음 */ null);
            if (!Number.isFinite(Number(ctx.from))) ctx.from = String(win.from);
            if (!Number.isFinite(Number(ctx.to))) ctx.to = String(win.to);

            const rootEl = document.getElementById('forecast-root');
            if (rootEl && rootEl.dataset) {
                if (!rootEl.dataset.from) rootEl.dataset.from = String(win.from);
                if (!rootEl.dataset.to) rootEl.dataset.to = String(win.to);
            }
        }

        // 5-2) 컨텍스트 보강(enrich)
        try {
            const P = window.SaveGreen?.Forecast?.providers;
            if (P && typeof P.enrichContext === 'function') {
                ctx = await P.enrichContext(ctx) || ctx;
            }
        } catch (e) {
            SaveGreen.log.warn('forecast', 'enrich skipped', e);
        }

        // 5-3) 카탈로그 로드/매칭 → 컨텍스트/프리로드 보강
        try {
            const catalogList = await loadCatalog();
            const matched = matchCatalogItem(ctx, catalogList);
            ctx.catalog = matched || null;

            if (matched) {
                SaveGreen.log.info('catalog', 'matched');

                if (window.SaveGreen?.Forecast?.providers?.applyCatalogToContext) {
                    ctx = window.SaveGreen.Forecast.providers.applyCatalogToContext(matched, ctx);
                } else {
                    // 폴백 주입
                    const pick = (v) => (v == null || String(v).trim() === '') ? undefined : v;
                    ctx.buildingName = ctx.buildingName || pick(matched.buildingName);
                    ctx.pnu          = ctx.pnu          || pick(matched.pnu);
                    ctx.roadAddr     = ctx.roadAddr     || pick(matched.roadAddr || matched.roadAddress);
                    ctx.jibunAddr    = ctx.jibunAddr    || pick(matched.jibunAddr);
                    ctx.useName      = ctx.useName      || pick(matched.useName || matched.use);
                    ctx.builtYear    = ctx.builtYear    || pick(matched.builtYear);
                    ctx.floorAreaM2  = ctx.floorAreaM2  || pick(Number(matched.floorArea));
                }

                await applyCatalogHints(ctx);
            }
        } catch (e) {
            SaveGreen.log.warn('catalog', 'pipeline error', e);
        }

        // ── enrich + catalog 보강이 모두 끝난 '최종' 스냅샷 1회만 로그
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


        // [추가] 컨텍스트 검증(필수값 누락 안내)
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
                // ✅ 확정 면적을 표준 키(floorAreaM2)에 고정
                ctx.floorAreaM2 = areaVal;
            }

            if (!hasBuiltYear) {
                showToast('사용연도가 없어 추정값으로 계산됩니다.', 'warn');
                SaveGreen.log.info('main', 'validation = missing builtYear (use inferred)');
            }
        })();



        // 5-4) 타입 결정 + dae.json 로드 + 기본가정(base) 추출
        try {
            const F = window.SaveGreen?.Forecast || {};

            // (a) 타입 결정 — 단일 진입
            const mappedType = resolveCoreType(ctx);


            // (b) dae.json 로드 & 타입별 base 가정
            const dae = (typeof F.loadDaeConfig === 'function') ? await F.loadDaeConfig() : null;
            let base = (dae && typeof F.getBaseAssumptions === 'function')
                ? F.getBaseAssumptions(dae, mappedType)
                : null;
            if (!base && mappedType !== 'office' && dae && typeof F.getBaseAssumptions === 'function') {
                base = F.getBaseAssumptions(dae, 'office');
            }

            // (c) 컨텍스트에 보관 + euiRules/defaults 보관
            ctx.mappedType = mappedType;
            ctx.daeBase = base || null;

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
            } catch { /* no-op */ }

            // (d) 표시용/계산용 가정 반영
            applyAssumptionsToDataset(root, ctx);

            // (e) 로더 상태 라벨
            try {
                if (window.LOADER && ctx.mappedType) {
                    const labelMap = { factory: '제조/공장', school: '교육/학교', hospital: '의료/병원', office: '업무/오피스' };
                    window.LOADER.setStatus(`예측 가정: ${labelMap[ctx.mappedType] || ctx.mappedType}`);
                }
            } catch { /* no-op */ }

            const b = ctx.daeBase || {};
            logMainBasePretty({ mappedType: ctx.mappedType, base: b });

        } catch (e) {
            SaveGreen.log.warn('forecast', 'dae.json/base inject skipped', e);
        }

    } catch (e) {
        SaveGreen.log.warn('forecast', 'no context → fallback to dummy', e);
        ctx = fallbackDefaultContext(root);
        useDummy = true;
        applyAssumptionsToDataset(root, ctx);
    }

    // 5-5) 데이터 로드(실제 API 또는 더미)
    const data = useDummy ? makeDummyForecast(ctx.from, ctx.to) : await fetchForecast(ctx);
    window.FORECAST_DATA = data;

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

    // ▼ ML KPI 호출
    let kpiFromServer = null;
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

    // [권장 가드] 숫자 강제
    if (kpiFromServer) {
        kpiFromServer.savingKwhYr = Number(kpiFromServer.savingKwhYr) || 0;
        kpiFromServer.savingCostYr = Number(kpiFromServer.savingCostYr) || 0;
        kpiFromServer.savingPct = Number(kpiFromServer.savingPct) || 0;
        kpiFromServer.paybackYears = Number.isFinite(Number(kpiFromServer.paybackYears))
            ? Number(kpiFromServer.paybackYears)
            : 99;
        kpiFromServer.label = kpiFromServer.label || 'NOT_RECOMMEND';
    }

    // [SG-ANCHOR:HARMONIZE-ML-KPI] — 클라이언트 재계산 최소화(서버 신뢰 모드)
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


    // 5-6) 배열 길이/타입 보정(Forward-fill)
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

    // 5-7) 메타패널(기간/모델/특징)
    updateMetaPanel({
        years: window.FORECAST_DATA.years,
        model: 'Linear Regression',
        features: (function () {
            const feats = ['연도'];
            if (Array.isArray(window.FORECAST_DATA?.series?.after)) feats.push('사용량');
            if (Array.isArray(window.FORECAST_DATA?.cost?.saving)) feats.push('비용 절감');
            return feats;
        })()
    });


    (function reconcileKpiAndGraph() {
        if (!kpiFromServer || !Array.isArray(data?.series?.saving) || !data.series.saving.length) return;

        // 1) 단가 역추정 → 그래프 단가 정합
        const unitFe = Number(window.__FORECAST_ASSUMP__?.tariffUnit) || 145;
        const uInf = (Number(kpiFromServer.savingCostYr) > 0 && Number(kpiFromServer.savingKwhYr) > 0)
            ? (Number(kpiFromServer.savingCostYr) / Number(kpiFromServer.savingKwhYr))
            : NaN;

        // 한국 전력단가 합리 범위(원/kWh): 80~1,000 정도 가드
        const unitUsed = (Number.isFinite(uInf) && uInf >= 80 && uInf <= 1000) ? uInf : unitFe;

        // (선택) 에스컬레이션 반영하려면 esc를 곱해주자
        const esc = Number(window.__FORECAST_ASSUMP__?.tariffEscalation) || 0; // 예: 0.03
        data.cost.saving = data.series.saving.map((k, i) => Math.round(k * unitUsed * Math.pow(1 + esc, i)));

        // 2) KPI ‘현실성’ 검증/교정
        const firstSavingKwh = Number(data.series.saving[0]) || 0;
        const firstSavingCost = Math.round(firstSavingKwh * unitUsed);

        // CAPEX: capexPerM2 × 면적
        const area = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area) || 0;
        const capexPerM2 = Number(ctx?.daeBase?.capexPerM2) || 0;
        const capexTotal = Math.max(0, Math.round(capexPerM2 * area));

        // 모델 payback과 산식 payback 간 싱크(±25% 허용, 벗어나면 교정)
        const paybackCalc = (firstSavingCost > 0) ? (capexTotal / firstSavingCost) : 99;
        let payback = Number(kpiFromServer.paybackYears);
        if (!Number.isFinite(payback) || Math.abs(payback - paybackCalc) / Math.max(1, paybackCalc) > 0.25) {
            payback = paybackCalc;
        }

        // savingPct 합리 범위(실무 기준): 5~40% 가드 (너프/버프 방지, 필요 시 알림만)
        let savingPct = Number(kpiFromServer.savingPct) || 0;
        if (savingPct < 5 || savingPct > 40) {
            SaveGreen.log.warn('kpi', `savingPct out of practical range: ${savingPct}% (clamped)`);
            savingPct = window.clamp(savingPct, 5, 40);
        }

        // 서버 KPI 표시값을 ‘첫 해 기준’으로 덮어써서 카드/요약 일관성 확보
        kpiFromServer = {
            savingKwhYr: firstSavingKwh,
            savingCostYr: firstSavingCost,
            savingPct: Math.round(savingPct),
            paybackYears: payback,
            label: kpiFromServer.label || 'NOT_RECOMMEND'
        };
    })();




    // 5-8) KPI/등급/배너  (← harmonize 이후 계산!)
    const floorArea = Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area);
    const kpi = SaveGreen.Forecast.computeKpis({
        years: data.years,
        series: data.series,
        cost: data.cost,
        kpiFromApi: kpiFromServer,
        base: ctx.daeBase || null,
        floorArea: Number.isFinite(floorArea) ? floorArea : undefined
    });

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
            if (inRange) return Number(b.grade) || null;
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


    // 기존:
    // const euiRules = ctx.euiRules || window.SaveGreen?.Forecast?._euiRules || null;
    // const euiNow = SaveGreen.Forecast.KPI.computeCurrentEui(data, ...);
    // let gradeNow = null;
    // if (euiRules && euiNow != null) {
    //     gradeNow = SaveGreen.Forecast.KPI.pickGradeByRules(euiNow, euiRules);
    // }
    // if (gradeNow == null) { gradeNow = (kpi.savingPct >= 30) ? 1 : ... }

    const euiRules = ctx.euiRules || window.SaveGreen?.Forecast?._euiRules || null;
    const euiNow = SaveGreen.Forecast.KPI.computeCurrentEui(
        data,
        Number(ctx?.floorAreaM2 ?? ctx?.floorArea ?? ctx?.area)
    );

    let gradeNow = null;
    if (euiRules && Number.isFinite(euiNow)) {
        gradeNow = pickGradeByRulesSafe(euiNow, euiRules);
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
    if (typeof gradeNow === 'number' && euiRules) {
        const targetGradeNum = Math.max(1, gradeNow - 1);
        boundary = getBoundaryForGradeSafe(targetGradeNum, euiRules);
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

    // ── renderSummary 내부에 추가(안전 경계 추출)
    function _extractBands(rules) {
        if (!rules || typeof rules !== 'object') return [];
        const cands = [rules.gradeBands, rules.electricityGradeBands, rules.primaryGradeBands, rules.bands].filter(Array.isArray);
        return cands[0] || [];
    }
    function getBoundaryForGradeSafe(targetGrade, rules) {
        const bands = _extractBands(rules);
        if (!bands.length) return null;
        const band = bands.find(b => Number(b.grade) === Number(targetGrade));
        if (!band) return null;
        return { value: Number(band.max), unit: 'kWh/m²·년' }; // 상한 경계 사용
    }


    let targetGradeText, boundary = null;
    if (typeof gradeNow === 'number') {
        const targetGradeNum = Math.max(1, gradeNow - 1);
        targetGradeText = `${targetGradeNum}등급`;
        boundary = getBoundaryForGradeSafe(targetGradeNum, rules);
    } else {
        targetGradeText = '상위 등급';
    }

    let currentEuiText = '-';
    let boundaryText = '-';
    let needSavingPct = 0;

    if (Number.isFinite(euiNow)) {
        currentEuiText = `${nf(euiNow)} kWh/m²/년`;
    }
    if (boundary && Number.isFinite(boundary.value)) {
        boundaryText = `${nf(boundary.value)} ${boundary.unit}`;
    }


    const canRuleBased = (
        Number.isFinite(euiNow) &&
        boundary &&
        Number.isFinite(boundary.value) &&
        boundary.value > 0
    );

    if (canRuleBased) {
        // 공식: 필요 절감률 = (1 - 목표등급경계 / 현재EUI) × 100
        needSavingPct = Math.max(0, Math.round((1 - (boundary.value / euiNow)) * 100));
    } else {
        // 룰/면적이 없을 때만 폴백(= UI 설명도 '추정'으로 표시됨)
        if (Number.isFinite(kpi?.savingPct)) {
            needSavingPct = Math.max(0, Math.round(100 - kpi.savingPct));
        } else {
         needSavingPct = 0;
        }
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
    } catch { }
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
    if (b.pnu && !fromQs('pnu')) rows.push(row('PNU', esc(b.pnu)));
    if (b.builtYear && !fromQs('builtYear')) rows.push(row('준공연도', String(b.builtYear)));
    box.innerHTML = `<div class="card building-card"><h4>건물 정보</h4>${rows.join('')}</div>`;
    box.classList.remove('hidden');
}

// [SG-ANCHOR:ML-LOG-ENDPOINT] — ML 로그 스냅샷 기본 경로(Spring 경유)
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




// [SG-ANCHOR:ML-SCORE-PARSE]
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


/* ==========================================================
 * 7) ML Train → Status Poll → 결과 대기 유틸
 * 학습 시작: POST /api/forecast/ml/train → { jobId | id | runId }
 * @returns {Promise<string>} jobId
 * ========================================================== */
async function startMlTrain() {
    const url = `${ML_ENDPOINT}/train`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`TRAIN ${res.status} ${res.statusText}`);
    const json = await res.json().catch(() => ({}));
    // 서버 구현마다 키가 다를 수 있어 안전하게 집계
    const jobId = (json.jobId || json.id || json.runId || '').toString().trim();
    if (!jobId) throw new Error('TRAIN: invalid job id');
    SaveGreen.log.info('provider', `train started (jobId=${jobId})`);
    return jobId;
}



/**
 * 학습 상태 폴링: 화면 로더 문구는 절대 변경하지 않음.
 * 필요하면 opt.onTick으로 외부(로거/패널)로만 전달.
 * 반환: 최종 status 문자열(DONE / FAILED / CANCELLED / TIMEOUT)
 */
async function waitTrainDone(jobId, opt = {}) {
    // 기본값(여유 있게)
    const totalTimeoutMs     = opt.timeoutMs ?? 5 * 60 * 1000;    // 총 대기 5분
    const perRequestTimeout  = opt.perRequestTimeoutMs ?? 12000;  // 요청당 12초
    const baseIntervalMs     = opt.intervalMs ?? 1200;            // 시작 간격 1.2s
    const maxIntervalMs      = 6000;                               // 최대 간격 6s
    const maxNetErr          = opt.maxNetErr ?? 5;
    const onTick             = typeof opt.onTick === 'function' ? opt.onTick : null;

    const t0 = Date.now();
    let consecutiveNetErr = 0;
    let intervalMs = baseIntervalMs;

    while (true) {
        let state = 'unknown';
        let json = null;

        try {
            const ctrl = new AbortController();
            const kill = setTimeout(() => ctrl.abort(), perRequestTimeout);

            const url = `${ML_ENDPOINT}/train/status?jobId=${encodeURIComponent(jobId)}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal });
            clearTimeout(kill);

            if (!res.ok) {
                consecutiveNetErr++;
                state = 'retry';
            } else {
                json = await res.json().catch(() => ({}));
                state = String(json?.status || json?.state || '').toLowerCase();
                consecutiveNetErr = 0;
            }
        } catch (e) {
            consecutiveNetErr++;
            state = 'retry';
        }

        try { onTick && onTick({ state, json, consecutiveNetErr }); } catch {}

        // 완료/성공 신호(서버 표기 다양성 수용)
        if (state === 'done' || state === 'success' || state === 'ready' || state === 'completed') {
            SaveGreen.log.info('provider', `train status: done (ms=${Date.now() - t0})`);
            return 'DONE';
        }
        // 실패/취소
        if (state === 'failed' || state === 'error') {
            SaveGreen.log.warn('provider', 'train status: failed');
            return 'FAILED';
        }
        if (state === 'cancelled' || state === 'canceled') {
            SaveGreen.log.warn('provider', 'train status: cancelled');
            return 'CANCELLED';
        }

        // 네트워크 연속 오류 초과
        if (consecutiveNetErr > maxNetErr) {
            SaveGreen.log.warn('provider', `train status: too many network errors (${consecutiveNetErr})`);
            return 'FAILED';
        }

        // 총 타임아웃
        if ((Date.now() - t0) > totalTimeoutMs) {
            SaveGreen.log.warn('provider', 'train status: timeout');
            return 'TIMEOUT';
        }

        // 지수 백오프
        await new Promise(r => setTimeout(r, intervalMs));
        intervalMs = Math.min(Math.round(intervalMs * 1.5), maxIntervalMs);
    }
}







/**
 * “항상 학습 후 예측” — 로더 문구는 손대지 않음.
 * 실패/타임아웃 시 경고 토스트만 띄우고 현재 모델로 predict.
 */
// [SG-ANCHOR:FE-TRAIN-FLOW]
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
			// [ADD][SG-RUNID] 학습 트리거 직후 run_id 확보
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

					// [SG-ANCHOR:TRAIN-BG-TIMEOUT-SOFT]  ← 이 블록으로 교체
					if (res?.ok) {
						SaveGreen.log.info('kpi', 'train finished (bg)');

						// ----------------------------------------------------------
						// [ADD][SG-RUNID] 백그라운드 완료 시점에 한 번 더 보장
						//  - 일부 환경에선 완료 시점에 run_id가 세션에 최종 반영되므로 재확보
						// ----------------------------------------------------------
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
						// ----------------------------------------------------------

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
						// 기존: info/warn로 떠서 거슬림 → debug 로 톤 다운
						// status: 'TIMEOUT' | 'UNREACHABLE' | 'RETRY' 등
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

		// ----------------------------------------------------------------------
		// [ADD][SG-RUNID] 예측 직전에도 run_id 최종 보장(경고 방지용)
		//  - 차트 A/B/C 시작 시 consoleScoresByRunAndLetter(...)에서 runId 필요
		// ----------------------------------------------------------------------
		try {
			if (window.SaveGreen?.MLLogs?.ensureRunId) {
				await window.SaveGreen.MLLogs.ensureRunId();
			}
		} catch {}
		// ----------------------------------------------------------------------

		return await callMl(payload);

	} catch (e) {
		// 진짜 예외 시에도 폴백으로 예측은 시도
		SaveGreen.log.warn('kpi', `train+predict flow error → ${String(e)}`);
		try {
			const payload = buildPredictPayload();

			// [ADD][SG-RUNID] 폴백에서도 run_id 보장 시도
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
        // [수정본] modelOrFallback() 내부 폴백용 src 생성 라인
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
    if (SHOW_LOCAL_SCORES) {
        _logChartOneLine('chart A', _preferServerMetricsOrLocal('A', y_true, A.yhat));
    }
    await sleep(EXTRA_STAGE_HOLD_MS);

    // ── B
    const B = modelOrFallback('B');
    await renderModelBChart?.({ years: B.years, yhat: B.yhat, costRange });
    if (SHOW_LOCAL_SCORES) {
        _logChartOneLine('chart B', _preferServerMetricsOrLocal('B', y_true, B.yhat));
    }
    await sleep(EXTRA_STAGE_HOLD_MS);

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
    if (SHOW_LOCAL_SCORES) {
        _logChartOneLine('chart C', _preferServerMetricsOrLocal('C', y_true, Cyhat));
    }


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
    const root = document.getElementById('forecast-root');
    if (!root) return;
    const from = root.dataset.from || new Date().getFullYear();
    const to = root.dataset.to || (new Date().getFullYear() + 10);
    const el = document.getElementById('meta-data-range');
    if (el) el.textContent = (String(from) === String(to)) ? `${from}년` : `${from}–${to}`;
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


