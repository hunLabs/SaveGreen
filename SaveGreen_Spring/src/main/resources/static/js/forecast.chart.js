// forecast.chart.js — Chart.js 렌더 모듈(IIFE, 전역/네임스페이스 동시 노출)
//
// [설계 개요 / Design Overview]
// - 이 모듈은 Chart.js 기반으로 에너지/비용 예측 차트를 단계별(A/B/C)로 렌더링합니다.
// - 공통 유틸(UTILS) → 배지/라벨(UX) → 모델별 렌더(A/B/C) 순서로 정의합니다.
// - 애니메이션 정책
//    • A/B: 포인트를 순차 애니메이션 후 선/영역 ON (좌측 yEnergy 축은 "처음부터" 고정)
//    • C   : 막대(좌측 y) → 포인트(우측 y) → 선 순서
//           막대는 “초기 0데이터”에서 i번째만 값 갱신(update) → 한 개씩 계단식으로 성장
// - 좌측 yEnergy 축 요동/베이스라인 흔들림 방지
//    • 차트 생성 “직전”에 최종 데이터의 최대치로 yEnergy 범위를 고정(min=0, max/step 고정)
//    • normalized: true, elements.bar.borderSkipped='bottom', borderWidth:0 적용
// - 타이머 관리
//    • 단계 전환 때 이전 단계의 setTimeout을 모두 정리하여 충돌/중복 애니를 방지
//

(function () {
	/* ============================================================
	 * 0) NAMESPACE
	 * ============================================================ */
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

	/* ============================================================
	 * 1) UTILS (공통 유틸리티 구간)
	 *    - 애니 타이머/인덱스/축 보정/숫자 포맷 등
	 * ============================================================ */

	// 단일 차트 인스턴스(겹침 방지용)
	let energyChart = null;

	// [UTIL] 단계별 애니메이션 타이머(잔여 타이머 정리)
	let __stageTimers = [];
	function __clearStageTimers() {
		__stageTimers.forEach(id => { try { clearTimeout(id); } catch {} });
		__stageTimers = [];
	}

	function __pushTimer(id) { __stageTimers.push(id); }

	// [UTIL] 애니메이션 인덱스 안전 취득(v3/v4 + edge)
	function __getAnimIndex(ctx) {
		if (typeof ctx?.dataIndex === 'number') return ctx.dataIndex;
		if (typeof ctx?.index === 'number') return ctx.index;
		try {
			const chart = ctx?.chart;
			const di = ctx?.datasetIndex;
			const el = ctx?.element;
			if (chart && typeof di === 'number' && el) {
				const meta = chart.getDatasetMeta(di);
				if (meta && Array.isArray(meta.data)) {
					const i = meta.data.indexOf(el);
					if (i >= 0) return i;
				}
			}
		} catch {}
		return 0;
	}

	// [UTIL] 숫자 현지 포맷
	function nfLocal(v) {
		try { return (typeof nf === 'function') ? nf(v) : Number(v).toLocaleString('ko-KR'); }
		catch { return String(v); }
	}

	// [UTIL] Y=0 기준 픽셀(막대/점이 바닥에서 올라오는 효과용)
	function fromBaseline(ctx) {
		const chart = ctx.chart;
		const ds = chart.data.datasets[ctx.datasetIndex];
		const axisId = ds.yAxisID || 'yEnergy';
		const scale = chart.scales[axisId];
		return scale.getPixelForValue(0);
	}

	// [UTIL] A/B용 yhat 보정(길이/결측 forward-fill)
	function fixSeriesToLength(series, n) {
		const base = Array.isArray(series) ? series : [];
		const out = new Array(n);
		let last = Number(base.find(v => Number(v) > 0)) || 0;
		for (let i = 0; i < n; i++) {
			const v = Number(base[i]);
			if (Number.isFinite(v) && v > 0) { last = v; out[i] = v; }
			else out[i] = last;
		}
		return out;
	}

	// [UTIL] 1–2–5 규칙으로 눈금간격(step) 도출
	function getNiceStep(min, max, targetTicks = 6) {
		const range = Math.max(1, Math.abs(Number(max) - Number(min)));
		const raw = range / Math.max(1, targetTicks);
		const exp = Math.floor(Math.log10(raw));
		const base = raw / Math.pow(10, exp);
		const niceBase = (base <= 1) ? 1 : (base <= 2) ? 2 : (base <= 5) ? 5 : 10;
		return niceBase * Math.pow(10, exp);
	}
	function roundMinMaxToStep(min, max, step) {
		const s = Number(step) || 1;
		const nmin = Math.floor(min / s) * s;
		const nmax = Math.ceil(max / s) * s;
		return { min: nmin, max: nmax };
	}
	function fmtCostTick(v) {
		const n = Math.round(Number(v) / 1000) * 1000; // 000 단위 정렬
		return (isFinite(n) ? n : 0).toLocaleString('ko-KR');
	}

	// [UTIL] 에너지축(yEnergy) “처음부터 고정” 범위 계산(min=0, max/step 고정)
	function getFixedLinearRangeFromMax(maxVal, padRatio = 0.08, targetTicks = 6) {
		const rawMax = Math.max(0, Number(maxVal) || 0);
		const padded = rawMax * (1 + padRatio);                  // 살짝 여유
		const step = getNiceStep(0, padded, targetTicks);        // 1–2–5 규칙
		const range = roundMinMaxToStep(0, padded, step);
		return { min: 0, max: Math.max(step, range.max), step };
	}

	// [UTIL] 단계 배지(우상단)
	function ensureStageBadge() {
		const canvas = document.getElementById('chart-energy-combo');
		const wrap =
			document.getElementById('chart-energy-wrap') ||
			document.getElementById('chart-energy-container') ||
			(canvas ? canvas.parentElement : null);
		if (!wrap) return null;
		if (!wrap.style.position) wrap.style.position = 'relative';
		let badge = wrap.querySelector('#chart-stage-badge');
		if (!badge) {
			badge = document.createElement('div');
			badge.id = 'chart-stage-badge';
			badge.className = 'chart-stage-badge';
			// 시각 정렬/스타일
			badge.style.position     = 'absolute';
			badge.style.top          = '6px';
			badge.style.right        = '8px';
			badge.style.display      = 'inline-flex';
			badge.style.alignItems   = 'center';
			badge.style.height       = '32px';
			badge.style.lineHeight   = '32px';
			badge.style.padding      = '0 12px';
			badge.style.borderRadius = '999px';
			badge.style.fontSize     = '13px';
			badge.style.fontWeight   = '600';
			badge.style.color        = '#fff';
			badge.style.boxShadow    = '0 2px 6px rgba(0,0,0,0.15)';
			badge.style.zIndex       = '10';
			// 좌측 배지 높이와 동기화(있을 때)
			(function syncTop(){
				try {
					let root =
						badge.closest('#chartA, #chartB, #chartC, .chart-card, .chart-box, .chart-wrap')
						|| document.getElementById('chartA')
						|| document.getElementById('chartB')
						|| document.getElementById('chartC')
						|| badge.parentElement;
					if (!root) return;
					const leftBadge =
						root.querySelector('.chart-context.chart-badge')
						|| document.querySelector('.chart-context.chart-badge');
					if (!leftBadge) return;
					const rootRect = root.getBoundingClientRect();
					const leftRect = leftBadge.getBoundingClientRect();
					const topPx = Math.max(0, Math.round(leftRect.top - rootRect.top));
					const nudge = -2;
					badge.style.top = (topPx + nudge) + 'px';
				} catch(e) {}
			})();
			wrap.appendChild(badge);
		}
		return badge;
	}
	function updateStageBadge(stage, label) {
		const badge = ensureStageBadge();
		if (!badge) return;
		let bg = '#666';
		if (stage === 'A') bg = '#D80004';
		else if (stage === 'B') bg = '#F57C00';
		else if (stage === 'C') bg = '#133D1E';
		badge.style.background = bg;
		badge.textContent = label || stage;
	}

	// [UTIL] 총 애니 시간 계산(외부에서 대기시간 산출에 사용 가능)
	function calcChartAnimMs(n, anim /* 'fast'|'normal' */) {
		const BAR_GROW_MS  = (anim === 'fast' ? 300 : 600);
		const BAR_GAP_MS   = (anim === 'fast' ? 60  : 120);
		const POINT_MS     = (anim === 'fast' ? 300 : 240);
		const POINT_GAP_MS = (anim === 'fast' ? 120 : 90);
		if (anim === 'fast') {
			return n * (POINT_MS + POINT_GAP_MS) + 500;
		}
		return n * (BAR_GROW_MS + BAR_GAP_MS) + 200 + n * (POINT_MS + POINT_GAP_MS) + 50;
	}

	// 네임스페이스에 유틸 노출
	window.SaveGreen.Forecast.calcChartAnimMs = calcChartAnimMs;
	window.SaveGreen.Forecast.getNiceStep = getNiceStep;
	window.SaveGreen.Forecast.roundMinMaxToStep = roundMinMaxToStep;
	window.SaveGreen.Forecast.fmtCostTick = fmtCostTick;

	/* ============================================================
	 * 2) CONTEXT LABEL (제목 아래 라벨 삽입 유틸)
	 * ============================================================ */
	(function(){
		'use strict';
		function injectChartContextLine(chartCardId) {
			let root = document.getElementById(chartCardId);
			if (!root) {
				const canvas = document.getElementById('chart-energy-combo');
				root = document.getElementById('chart-energy-container')
					|| document.getElementById('chart-energy-wrap')
					|| (canvas ? canvas.parentElement : null);
			}
			if (!root) return;
			const titleEl = root.querySelector('h1,h2,h3,.chart-title');
			const canvasEl = root.querySelector('#chart-energy-combo, canvas');

			const ds = document.getElementById('forecast-root')?.dataset || {};
			const name = (ds.buildingName || '').trim();
			const addr = (ds.roadAddr || ds.jibunAddr || ds.address || '').trim();
			let infoText = name || addr || '건물명 없음';
			if (!infoText) return;

			const existsText = root.querySelector('.chart-context')?.textContent?.trim();
			if (existsText) return;

			let ctxEl = root.querySelector('.chart-context');
			if (!ctxEl) {
				ctxEl = document.createElement('div');
				ctxEl.className = 'chart-context chart-badge';
				if (titleEl) titleEl.insertAdjacentElement('afterend', ctxEl);
				else if (canvasEl) root.insertBefore(ctxEl, canvasEl);
				else root.prepend(ctxEl);
			}
			ctxEl.textContent = infoText;
		}
		window.SaveGreen.Forecast.injectChartContextLine = injectChartContextLine;
	})();

	/* ============================================================
	 * 3) MODEL A — 스플라인 영역 (점 → 선·영역)
	 *    - 좌측 yEnergy 축: yhat 최대값 기준 “처음부터 고정”
	 * ============================================================ */
	async function renderModelAChart(opts) {
		__clearStageTimers();
		// [SG-LOGS] A 차트 시작: runId 로그 3줄 찍기
        try { await window.SaveGreen.MLLogs.consoleScoresByRunAndLetter('A'); } catch (e) {}


		const { years, yhat } = opts || {};
		const cr = (opts && opts.costRange) ? opts.costRange : null;

		if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
		const canvas = document.getElementById('chart-energy-combo');
		if (!canvas) { console.warn('#chart-energy-combo not found'); return; }

		// 기존 차트 제거
		if (Chart.getChart) {
			const existed = Chart.getChart(canvas);
			if (existed) existed.destroy();
		}
		if (energyChart) energyChart.destroy();

		const ctx = canvas.getContext('2d');
		const labels = (years || []).map(String);
		const n = labels.length;

		// 데이터 보정 및 좌측 y 고정 범위 계산
		const yFixed = fixSeriesToLength(yhat, n);
		const energyMaxA = Math.max(0, ...yFixed.map(v => Number(v) || 0));
		const yEnergyRangeA = getFixedLinearRangeFromMax(energyMaxA, 0.08, 6);

		// 스타일/애니
		const AREA_LINE = '#D80004';
		const AREA_BG   = 'rgba(216, 0, 4, 0.18)';
		const POINT_MS = 500, POINT_GAP_MS = 300;

		updateStageBadge('A', '모델 A : 선형 회귀 (Elastic Net)');

		const ds = {
			type: 'line',
			order: 1,
			label: '에너지 사용량',
			data: yFixed,
			yAxisID: 'yEnergy',
			fill: false,
			tension: 0.35,
			cubicInterpolationMode: 'monotone',
			borderWidth: 2,
			borderColor: AREA_LINE,
			backgroundColor: AREA_BG,
			showLine: false,
			pointRadius: new Array(n).fill(0),
			pointBorderWidth: 0,
			pointBackgroundColor: AREA_LINE,
			animations: {
				y: {
					from: fromBaseline,
					duration: POINT_MS,
					delay: (c) => (c.type !== 'data') ? 0 : c.dataIndex * (POINT_MS + POINT_GAP_MS),
					easing: 'easeOutCubic'
				}
			}
		};

		energyChart = new Chart(ctx, {
			type: 'line',
			data: { labels, datasets: [ds] },
			options: {
				normalized: true,
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: true },
					title: { display: true, text: '에너지 / 비용 예측', padding: { top: 8, bottom: 4 } },
					subtitle: { display: false },
					tooltip: {
						callbacks: {
							label: (c) => `에너지 사용량: ${nfLocal(c.parsed?.y ?? 0)} kWh/년`
						}
					}
				},
				elements: {
					bar: { borderWidth: 0, borderSkipped: 'bottom' },
					point: { hoverRadius: 5 }
				},
				scales: {
					yEnergy: {
						type: 'linear', position: 'left',
						min: yEnergyRangeA.min,
						max: yEnergyRangeA.max,
						ticks: { stepSize: yEnergyRangeA.step, callback: (v) => nfLocal(v) },
						title: { display: true, text: '에너지 사용량 (kWh/년)' }
					},
					yCost: {
						type: 'linear', position: 'right',
						grid: { drawOnChartArea: false },
						title: { display: true, text: '비용 절감 (원/년)' },
						ticks: {
							callback: (v) => fmtCostTick(v),
							stepSize: cr ? (cr.step || getNiceStep(cr.min, cr.max)) : undefined
						},
						min: 0, max: cr ? cr.max : undefined
					},
					x: { title: { display: false } }
				}
			}
		});

		// 포인트 반경 순차 ON
		const chartRef = energyChart;
		for (let i = 0; i < n; i++) {
			const delay = i * (POINT_MS + POINT_GAP_MS);
			const id = setTimeout(() => {
				if (energyChart !== chartRef) return;
				const _ds = chartRef.data.datasets[0];
				if (Array.isArray(_ds.pointRadius) && i < _ds.pointRadius.length) {
					_ds.pointRadius[i] = 3;
					chartRef.update('none');
				}
			}, delay);
			__pushTimer(id);
		}

		// 모든 점 표시 후, 선/영역 ON
		const totalPointDuration = n * (POINT_MS + POINT_GAP_MS);
		const idReveal = setTimeout(() => {
			if (energyChart !== chartRef) return;
			const _ds = chartRef.data.datasets[0];
			_ds.showLine = true;
			_ds.fill = true;
			chartRef.update('none');
		}, totalPointDuration + 80);
		__pushTimer(idReveal);

		window.energyChart = energyChart;

		if (window.SaveGreen?.Forecast?.injectChartContextLine) {
			window.SaveGreen.Forecast.injectChartContextLine('chartA');
		}

		const doneMs = totalPointDuration + 80 + 120;
		await new Promise((r) => setTimeout(r, doneMs));
		return doneMs;
	}

	/* ============================================================
	 * 4) MODEL B — 꺾은선 (점 → 선)
	 *    - 좌측 yEnergy 축: yhat 최대값 기준 “처음부터 고정”
	 * ============================================================ */
	async function renderModelBChart(opts) {
		__clearStageTimers();
		// [SG-LOGS] B 차트 시작: runId 로그 3줄 찍기
        try { await window.SaveGreen.MLLogs.consoleScoresByRunAndLetter('B'); } catch (e) {}


		const { years, yhat } = opts || {};
		const cr = (opts && opts.costRange) ? opts.costRange : null;

		if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
		const canvas = document.getElementById('chart-energy-combo');
		if (!canvas) { console.warn('#chart-energy-combo not found'); return; }

		// 기존 차트 제거
		if (Chart.getChart) {
			const existed = Chart.getChart(canvas);
			if (existed) existed.destroy();
		}
		if (energyChart) energyChart.destroy();

		const ctx = canvas.getContext('2d');
		const labels = (years || []).map(String);
		const n = labels.length;

		const yFixed = fixSeriesToLength(yhat, n);
		const energyMaxB = Math.max(0, ...yFixed.map(v => Number(v) || 0));
		const yEnergyRangeB = getFixedLinearRangeFromMax(energyMaxB, 0.08, 6);

		const LINE_COLOR = '#F57C00';
		const POINT_MS = 500, POINT_GAP_MS = 300;

		updateStageBadge('B', '모델 B : 랜덤 포레스트 (Random Forest)');

		const ds = {
			type: 'line',
			order: 1,
			label: '에너지 사용량',
			data: yFixed,
			yAxisID: 'yEnergy',
			fill: false,
			tension: 0.3,
			cubicInterpolationMode: 'monotone',
			borderWidth: 3,
			borderColor: LINE_COLOR,
			showLine: false,
			pointRadius: new Array(n).fill(0),
			pointBackgroundColor: LINE_COLOR,
			pointBorderWidth: 0,
			animations: {
				y: {
					from: fromBaseline,
					duration: POINT_MS,
					delay: (c) => (c.type !== 'data') ? 0 : c.dataIndex * (POINT_MS + POINT_GAP_MS),
					easing: 'easeOutCubic'
				}
			}
		};

		energyChart = new Chart(ctx, {
			type: 'line',
			data: { labels, datasets: [ds] },
			options: {
				normalized: true,
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: true },
					title: { display: true, text: '에너지 / 비용 예측', padding: { top: 8, bottom: 4 } },
					subtitle: { display: false },
					tooltip: {
						callbacks: {
							label: (c) => `에너지 사용량: ${nfLocal(c.parsed?.y ?? 0)} kWh/년`
						}
					}
				},
				elements: {
					bar: { borderWidth: 0, borderSkipped: 'bottom' },
					point: { hoverRadius: 5 }
				},
				scales: {
					yEnergy: {
						type: 'linear', position: 'left',
						min: yEnergyRangeB.min,
						max: yEnergyRangeB.max,
						ticks: { stepSize: yEnergyRangeB.step, callback: (v) => nfLocal(v) },
						title: { display: true, text: '에너지 사용량 (kWh/년)' }
					},
					yCost: {
						type: 'linear', position: 'right',
						grid: { drawOnChartArea: false },
						title: { display: true, text: '비용 절감 (원/년)' },
						ticks: {
							callback: (v) => fmtCostTick(v),
							stepSize: cr ? (cr.step || getNiceStep(cr.min, cr.max)) : undefined
						},
						min: 0, max: cr ? cr.max : undefined
					},
					x: { title: { display: false } }
				}
			}
		});

		// 포인트 순차 등장
		const chartRef = energyChart;
		for (let i = 0; i < n; i++) {
			const delay = i * (POINT_MS + POINT_GAP_MS);
			const id = setTimeout(() => {
				if (energyChart !== chartRef) return;
				const _ds = chartRef.data.datasets[0];
				if (Array.isArray(_ds.pointRadius) && i < _ds.pointRadius.length) {
					_ds.pointRadius[i] = 3;
					chartRef.update('none');
				}
			}, delay);
			__pushTimer(id);
		}

		// 포인트 후 선 ON
		const totalPointDuration = n * (POINT_MS + POINT_GAP_MS);
		const idReveal = setTimeout(() => {
			if (energyChart !== chartRef) return;
			const _ds = chartRef.data.datasets[0];
			_ds.showLine = true;
			chartRef.update('none');
		}, totalPointDuration + 80);
		__pushTimer(idReveal);

		window.energyChart = energyChart;

		if (window.SaveGreen?.Forecast?.injectChartContextLine) {
			window.SaveGreen.Forecast.injectChartContextLine('chartB');
		}

		const doneMs = totalPointDuration + 80 + 120;
		await new Promise((r) => setTimeout(r, doneMs));
		return doneMs;
	}












	/* ============================================================
     * 5) MODEL C — 에너지 막대 + 비용 선 콤보 (막대 → 포인트 → 선)
     *
     *   개요
     *   - Chart.js 내장 애니메이션은 모두 끄고(animation:false, update('none')),
     *     requestAnimationFrame 기반의 수동 트윈으로 “해당 요소만” 부드럽게 보간합니다.
     *   - 막대: 0 → 타깃 값을 i번째마다 계단식(순차)으로 트윈.
     *   - 포인트: 막대 전체가 끝난 뒤, y값 0 → 타깃으로 순차 트윈 + 반경 0 → 3 트윈.
     *   - 선(showLine)은 마지막에 딱 한 번 ON하여 전체 재애니 느낌 제거.
     *   - 좌측 yEnergy 축은 “최종 bars 기준”으로 최초 한 번 고정 → 눈금/레이블 요동 제거.
     * ============================================================ */
    async function renderEnergyComboChart(opts) {
    	// 0) 잔여 타이머 정리(단계 전환 시 충돌 방지)
    	__clearStageTimers();
    	// [SG-LOGS] C 차트 시작: runId 로그 3줄 찍기 (C가 없으면 wA/wB 폴백)
        try { await window.SaveGreen.MLLogs.consoleScoresByRunAndLetter('C'); } catch (e) {}


    	// 1) 준비물
    	if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
    	const canvas = document.getElementById('chart-energy-combo');
    	if (!canvas) { console.warn('#chart-energy-combo not found'); return; }

    	// 2) 옵션 분해
    	const years  = (opts?.years || []).map(String);
    	const series = opts?.series || {};
    	const cost   = opts?.cost   || {};
    	const cr     = opts?.costRange || null;	// 비용축 범위(있으면 고정)

    	// 3) 기존 차트 제거(겹침 방지)
    	if (Chart.getChart) {
    		const existed = Chart.getChart(canvas);
    		if (existed) existed.destroy();
    	}
    	if (energyChart) energyChart.destroy();

    	const ctx = canvas.getContext('2d');

    	// 4) 타이밍/이징
    	const BAR_MS   = 600;	// 막대 한 개 트윈 길이
    	const BAR_GAP  = 120;	// 막대 간 지연(계단식 핵심)
    	const PT_MS    = 260;	// 포인트 y 트윈 길이
    	const PT_GAP   = 90;	// 포인트 간 지연
    	const RAD_MS   = 200;	// 포인트 반경 트윈 길이
    	const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    	// 5) 데이터
    	const labels = years;
    	const bars   = Array.isArray(series?.after) ? series.after.slice(0, labels.length) : [];
    	const costs  = Array.isArray(cost?.saving) ? cost.saving.slice(0, labels.length) : [];
    	const n = labels.length;

    	// 6) 좌측 yEnergy 축 고정(최종 bars 기준으로 한 번만 계산 → 눈금 요동 제거)
    	const energyMax = Math.max(0, ...bars.map(v => Number(v) || 0));
    	const yEnergyRange = (() => {
    		const padded = Math.max(0, energyMax) * 1.08;
    		const step = getNiceStep(0, padded, 6);
    		const { max } = roundMinMaxToStep(0, padded, step);
    		return { min: 0, max: Math.max(step, max), step };
    	})();

    	// 7) 팔레트
    	const BAR_BG      = 'rgba(54, 162, 235, 0.5)';
    	const BAR_BORDER  = 'rgb(54, 162, 235)';
    	const LINE_ORANGE = '#F57C00';

    	// 8) 우상단 단계 배지
    	updateStageBadge('C', '모델 C : 앙상블 (A + B)');

    	// 9) “초기 0 데이터”로 차트 생성 + 모든 내장 애니메이션 OFF
    	const barsZero  = new Array(n).fill(0);
    	const costsZero = new Array(n).fill(0);

    	// 선이 항상 막대 위로 보이도록 보정 플러그인
    	const forceLineFront = {
    		id: 'forceLineFront',
    		afterDatasetsDraw(chart) {
    			const idx = chart.data.datasets.findIndex(d => d.label === '비용 절감');
    			if (idx < 0) return;
    			const meta = chart.getDatasetMeta(idx);
    			if (!meta) return;
    			const { ctx } = chart;
    			meta.dataset?.draw?.(ctx);
    			if (Array.isArray(meta.data)) meta.data.forEach(el => el?.draw && el.draw(ctx));
    		}
    	};

    	energyChart = new Chart(ctx, {
    		type: 'bar',
    		data: {
    			labels,
    			datasets: [
    				{
    					type: 'bar',
    					order: 1,
    					label: '에너지 사용량',
    					data: barsZero,					// 0에서 시작 → 이후 rAF 트윈으로 개별 인덱스만 갱신
    					yAxisID: 'yEnergy',
    					backgroundColor: BAR_BG,
    					borderColor: BAR_BORDER,
    					borderWidth: 0					// 하단 보더 제거(바닥 깜빡임/움찔 방지)
    				},
    				{
    					type: 'line',
    					order: 9999,
    					label: '비용 절감',
    					data: costsZero,				// 0에서 시작 → 이후 rAF 트윈
    					yAxisID: 'yCost',
    					tension: 0.3,
    					spanGaps: false,
    					fill: false,
    					showLine: false,				// 마지막에 한 번 ON
    					pointRadius: new Array(n).fill(0),
    					borderWidth: 3,
    					borderColor: LINE_ORANGE,
    					backgroundColor: LINE_ORANGE,
    					pointBackgroundColor: LINE_ORANGE,
    					pointBorderWidth: 0
    				}
    			]
    		},
    		options: {
    			// ★★★ Chart.js 내장 애니 전부 비활성화 → 전체 재애니 방지
    			animation: false,
    			normalized: true,
    			responsive: true,
    			maintainAspectRatio: false,
    			interaction: { mode: 'index', intersect: false },
    			plugins: {
    				legend: { display: true },
    				title: { display: true, text: '에너지 / 비용 예측', padding: { top: 8, bottom: 4 } },
    				subtitle: { display: false },
    				tooltip: {
    					callbacks: {
    						label: (c) => {
    							const isCost = c.dataset.yAxisID === 'yCost';
    							const val = c.parsed?.y ?? 0;
    							return `${c.dataset.label}: ${nfLocal(val)} ${isCost ? '원/년' : 'kWh/년'}`;
    						}
    					}
    				},
    				forceLineFront: {}
    			},
    			elements: {
    				bar:   { borderWidth: 0, borderSkipped: 'bottom' },
    				point: { hoverRadius: 5 }
    			},
    			scales: {
    				yEnergy: {
    					type: 'linear',
    					position: 'left',
    					min: yEnergyRange.min,
    					max: yEnergyRange.max,
    					ticks: { stepSize: yEnergyRange.step, callback: (v) => nfLocal(v) },
    					title: { display: true, text: '에너지 사용량 (kWh/년)' }
    				},
    				yCost: {
    					type: 'linear',
    					position: 'right',
    					grid: { drawOnChartArea: false },
    					title: { display: true, text: '비용 절감 (원/년)' },
    					ticks: {
    						callback: (v) => fmtCostTick(v),
    						stepSize: cr ? (cr.step || getNiceStep(cr.min, cr.max)) : undefined
    					},
    					min: 0,
    					max: cr ? cr.max : undefined
    				},
    				x: { title: { display: false } }
    			}
    		},
    		plugins: [forceLineFront]
    	});

    	// 10) rAF 수동 트윈 유틸
    	function tween({ from, to, ms, onUpdate, onComplete, ease = easeOutCubic, startAt = performance.now() }) {
    		let rafId = 0;
    		function loop(now) {
    			const t = Math.min(1, (now - startAt) / ms);
    			const v = from + (to - from) * ease(t);
    			onUpdate(v);
    			if (t < 1) {
    				rafId = requestAnimationFrame(loop);
    			} else {
    				onComplete && onComplete();
    			}
    		}
    		rafId = requestAnimationFrame(loop);
    		return () => cancelAnimationFrame(rafId);	// 취소 함수 반환
    	}
    	function updateNow() {
    		// Chart.js 내장 애니 없이 즉시 렌더
    		energyChart && energyChart.update('none');
    	}

    	// 11) 막대: i번째만 순차 트윈(0 → bars[i]) — 전체 재렌더 느낌 제거
    	const chartRef = energyChart;
    	for (let i = 0; i < n; i++) {
    		const startDelay = i * (BAR_MS + BAR_GAP);
    		const id = setTimeout(() => {
    			if (energyChart !== chartRef) return;
    			const ds = chartRef.data.datasets[0];	// bar
    			const target = Number(bars[i]) || 0;
    			const cancel = tween({
    				from: 0,
    				to: target,
    				ms: BAR_MS,
    				onUpdate: (v) => { ds.data[i] = v; updateNow(); }
    			});
    			// rAF 취소 핸들(객체 형태로 저장) — clearTimeout과 별개
    			__pushTimer({ cancel });
    		}, startDelay);
    		__pushTimer(id);
    	}

    	// 12) 포인트: 막대 끝난 뒤(약간의 버퍼 후) y 트윈 + 반경 트윈을 순차 수행
    	const pointStartAt = n * (BAR_MS + BAR_GAP) + 200;
    	for (let i = 0; i < n; i++) {
    		const startDelay = pointStartAt + i * (PT_MS + PT_GAP);
    		const id = setTimeout(() => {
    			if (energyChart !== chartRef) return;
    			const ds = chartRef.data.datasets[1];	// line
    			const targetY = Number(costs[i]) || 0;

    			// y값 트윈
    			const cancelY = tween({
    				from: 0,
    				to: targetY,
    				ms: PT_MS,
    				onUpdate: (v) => { ds.data[i] = v; updateNow(); }
    			});
    			// 반경 트윈(0 → 3)
    			if (!Array.isArray(ds.pointRadius)) ds.pointRadius = new Array(n).fill(0);
    			const cancelR = tween({
    				from: 0,
    				to: 3,
    				ms: RAD_MS,
    				onUpdate: (r) => { ds.pointRadius[i] = r; updateNow(); }
    			});

    			__pushTimer({ cancelY, cancelR });
    		}, startDelay);
    		__pushTimer(id);
    	}

    	// 13) 모든 포인트 등장 이후, 선을 한 번에 ON (애니 없이)
    	const lineRevealAt = pointStartAt + n * (PT_MS + PT_GAP) + 60;
    	const idReveal = setTimeout(() => {
    		if (energyChart !== chartRef) return;
    		const line = chartRef.data.datasets[1];
    		if (line) line.showLine = true;
    		updateNow();
    	}, lineRevealAt);
    	__pushTimer(idReveal);

    	// 14) 제목 아래 컨텍스트 라인(빌딩명/주소) 삽입
    	if (window.SaveGreen?.Forecast?.injectChartContextLine) {
    		window.SaveGreen.Forecast.injectChartContextLine('chartC');
    	}

    	// 15) 재참조용
    	window.energyChart = energyChart;
    }



	/* ============================================================
	 * 6) EXPORTS (전역/네임스페이스 노출)
	 * ============================================================ */
	window.SaveGreen.Forecast.renderModelAChart = renderModelAChart;
	window.SaveGreen.Forecast.renderModelBChart = renderModelBChart;
	window.renderEnergyComboChart = renderEnergyComboChart;
	window.SaveGreen.Forecast.renderEnergyComboChart = renderEnergyComboChart;
})();
