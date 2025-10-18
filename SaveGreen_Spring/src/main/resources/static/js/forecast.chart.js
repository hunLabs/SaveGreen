// forecast.chart.js — Chart.js 렌더 모듈(IIFE, 전역/네임스페이스 동시 노출)
(function () {
	// 네임스페이스 보장
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

	/* ---------- Chart.js ---------- */
	// 차트 인스턴스(단일)
	let energyChart = null;

	// [NEW] 단계별 애니메이션 타이머 관리(단계 전환 시 잔여 타이머로 인한 충돌 방지)
	// - 여러 setTimeout을 한 단계에서 사용하므로, 다음 단계 진입 전에 정리 필요
	let __stageTimers = [];
	function __clearStageTimers() {
		__stageTimers.forEach(id => { try { clearTimeout(id); } catch {} });
		__stageTimers = [];
	}
	function __pushTimer(id) { __stageTimers.push(id); }

    // ✨ [추가] 제목 아래에 "건물명 · 주소" 라벨을 렌더/업데이트
    function renderChartBuildingLabel(containerEl, datasetLike) {
        // 1) 컨테이너 탐색(캔버스를 싸고 있는 카드/박스 엘리먼트)
        const box = containerEl?.closest?.('.chart-card, .chart-box, .chart, .card, .kpi-card') || containerEl?.parentElement || containerEl;
        if (!box) return;

        // 2) 라벨 엘리먼트 확보(1회 생성, 이후 재사용)
        let label = box.querySelector('#chart-building-label');
        if (!label) {
            label = document.createElement('div');
            label.id = 'chart-building-label';
            label.className = 'chart-building-label';
            // 제목은 h1~h3 또는 .chart-title 를 모두 허용
            const titleEl = box.querySelector('h1,h2,h3,.chart-title');
            if (titleEl && titleEl.parentElement === box) {
                titleEl.insertAdjacentElement('afterend', label);
            } else {
                const canvasEl = box.querySelector('canvas, .echart, .chartjs');
                if (canvasEl) box.insertBefore(label, canvasEl);
                else box.appendChild(label);
            }
        }

        // 3) 값 구성(폴백 포함)
        const name = (datasetLike?.buildingName || '건물명 없음').trim();
        const addr = (datasetLike?.roadAddr || datasetLike?.jibunAddr || datasetLike?.address || '-').trim();

        // 4) 텍스트 주입
        label.textContent = `${name} · ${addr}`;
    }


	// [NEW] 단계 배지 엘리먼트 보장(차트 우상단)
	// - 차트 우측 상단에 A/B/C 단계 배지를 표시(요구 사양: A=적색, B=주황, C=녹색)
	function ensureStageBadge() {
		// 차트 캔버스를 감싸는 래퍼가 다를 수 있어 안전하게 탐색
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

            /* ✨ 위치/크기/정렬을 좌측 배지와 최대한 동일하게 맞춘다.
             *  - top을 6px로 살짝 올려 ‘미세하게 아래’ 보이는 느낌 제거
             *  - 높이/라인높이/패딩을 좌측(32px 캡슐)과 동일
             *  - inline-flex + align-items:center로 세로 중앙정렬 보장
             */
            badge.style.position    = 'absolute';
            badge.style.top         = '6px';                 // ← 기존 8px ▶ 6px로 미세 조정
            badge.style.right       = '8px';

            badge.style.display     = 'inline-flex';
            badge.style.alignItems  = 'center';
            badge.style.height      = '32px';                // 좌측 캡슐과 동일 높이
            badge.style.lineHeight  = '32px';
            badge.style.padding     = '0 12px';              // 좌/우 여백 맞춤
            badge.style.borderRadius= '999px';

            badge.style.fontSize    = '13px';                // 좌측 기준(13/600)과 동일
            badge.style.fontWeight  = '600';
            badge.style.color       = '#fff';
            badge.style.boxShadow   = '0 2px 6px rgba(0,0,0,0.15)';
            badge.style.zIndex      = '10';

            /* 🧩 좌측 배지 기준으로 우측 배지 top 동기화
             * - container 변수를 쓰지 않고, badge를 기준으로 안전하게 루트를 탐색
             * - 폰트/렌더러 차이에 의한 1px 오프셋까지 흡수
             */
            (function syncTopWithLeftBadge(){
            	try {
            		// 1) 루트 컨테이너 탐색(가장 안전한 순서)
            		let root =
            			badge.closest('#chartA, #chartB, #chartC, .chart-card, .chart-box, .chart-wrap')
            			|| document.getElementById('chartA')
            			|| document.getElementById('chartB')
            			|| document.getElementById('chartC')
            			|| badge.parentElement;

            		if (!root) return;

            		// 2) 좌측 배지(차트 라벨) 찾기
            		const leftBadge =
            			root.querySelector('.chart-context.chart-badge')
            			|| document.querySelector('.chart-context.chart-badge'); // 최후 폴백

            		if (!leftBadge) return;

            		// 3) 좌측 배지의 top(컨테이너 기준) 계산
            		const rootRect = root.getBoundingClientRect();
            		const leftRect = leftBadge.getBoundingClientRect();
            		const topPx = Math.max(0, Math.round(leftRect.top - rootRect.top));

            		// 4) 미세 보정치(필요 시 -1/0/+1)
            		const nudge = -2;
            		badge.style.top = (topPx + nudge) + 'px';
            	} catch(e) {
            		console.warn('[stageBadge] syncTopWithLeftBadge skipped:', e);
            	}
            })();



			wrap.appendChild(badge);
		}
		return badge;
	}

	// [NEW] 배지 업데이트(A: 적색, B: 주황, C: 녹색)
	function updateStageBadge(stage /* 'A'|'B'|'C' */, label /* 텍스트 */) {
		const badge = ensureStageBadge();
		if (!badge) return;
		let bg = '#666';
		if (stage === 'A') bg = '#D80004';
		else if (stage === 'B') bg = '#F57C00';
		else if (stage === 'C') bg = '#133D1E';
		badge.style.background = bg;
		badge.textContent = label || stage;
	}

	// [UPDATED] 애니메이션 총 소요시간 계산(막대/점/선 순차 기준)
	//  - fast: A/B용(점 위주 + 마지막 선/영역 ON까지 버퍼 포함)
	//  - normal: C용(막대+점+선)
	function calcChartAnimMs(n, anim /* 'fast'|'normal' */) {
		const BAR_GROW_MS  = (anim === 'fast' ? 300 : 600);
		const BAR_GAP_MS   = (anim === 'fast' ? 60  : 120);
		const POINT_MS     = (anim === 'fast' ? 300 : 240);
		const POINT_GAP_MS = (anim === 'fast' ? 120 : 90);
		if (anim === 'fast') {
			// 점 n개 순차 + 선/영역 reveal 버퍼(≈ 400~500ms)
			return n * (POINT_MS + POINT_GAP_MS) + 500;
		}
		// 막대 전체 + 포인트 전체 + 소폭 버퍼
		return n * (BAR_GROW_MS + BAR_GAP_MS) + 200 + n * (POINT_MS + POINT_GAP_MS) + 50;
	}

	// 전역 노출(메인에서 단계 대기시간 계산에 사용)
	window.SaveGreen.Forecast.calcChartAnimMs = calcChartAnimMs;

	// 공통 포맷터(숫자 → 현지 문자열)
	function nfLocal(v) {
		try { return (typeof nf === 'function') ? nf(v) : Number(v).toLocaleString('ko-KR'); }
		catch { return String(v); }
	}

	// 공통: Y=0 기준 픽셀(막대/점이 바닥에서 올라오는 효과용)
	function fromBaseline(ctx) {
		const chart = ctx.chart;
		const ds = chart.data.datasets[ctx.datasetIndex];
		const axisId = ds.yAxisID || (ds.type === 'line' ? 'yEnergy' : 'yEnergy');
		const scale = chart.scales[axisId];
		return scale.getPixelForValue(0);
	}

	// 공통: yhat 보정(길이 맞추기 + 누락 forward-fill)
	// - A/B에서 예측치 배열 길이 불일치/결측값을 부드럽게 보정
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

	/* ===== [NEW] 비용축 눈금 계산/라벨 포맷 (완전 동적, 1–2–5 규칙) ===== */
	// - C에서 산정된 비용축 범위를 A/B에도 넘겨 동일 스케일 유지
	function getNiceStep(min, max, targetTicks = 6) {
		const range = Math.max(1, Math.abs(Number(max) - Number(min)));
		const raw = range / Math.max(1, targetTicks);
		const exp = Math.floor(Math.log10(raw));            // 10의 지수
		const base = raw / Math.pow(10, exp);               // 1~10 사이
		let niceBase = (base <= 1) ? 1 : (base <= 2) ? 2 : (base <= 5) ? 5 : 10;
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
	// 헬퍼도 네임스페이스에 노출(원하면 main에서 재사용)
	window.SaveGreen.Forecast.getNiceStep = getNiceStep;
	window.SaveGreen.Forecast.roundMinMaxToStep = roundMinMaxToStep;
	window.SaveGreen.Forecast.fmtCostTick = fmtCostTick;

	/* ========== [STEP5] 차트 컨텍스트 라벨(제목 아래, 범례 위) 공통 유틸 ========== */
	// - 차트 카드에 “빌딩명 → 주소 → 용도” 라인을 제목 바로 아래에 삽입
	(function(){
		'use strict';
		window.SaveGreen = window.SaveGreen || {};
		window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

		/* ========== [STEP5] 차트 컨텍스트 라벨(제목 아래, 범례 위) 공통 유틸 ========== */
        /**
         * 차트 카드(예: chartA/B/C) 안에 "건물명 or 주소 or '건물명 없음'" 라벨을 1회만 삽입한다.
         * - 우선순위: (1) 건물명 → (2) 주소(roadAddr→jibunAddr→address) → (3) '건물명 없음'
         * - Chart.js 제목(plugins.title)은 캔버스 내부에 그려지므로 DOM에 .chart-title가 없을 수 있음.
         *   → 제목 엘리먼트가 없으면 캔버스 앞에 라벨을 꽂는다.
         * - Chart A에서 한 번 생성되면 Chart B/C 호출 시에는 덮어쓰지 않고 유지한다.
         * - dataset은 #forecast-root.dataset 에서 읽는다(세션은 이 단계에서 건드리지 않음).
         */
        function injectChartContextLine(chartCardId) {
        	// 1) 루트 컨테이너 탐색: chartCardId → (폴백) 에너지 캔버스 부모
        	let root = document.getElementById(chartCardId);
        	if (!root) {
        		// 폴백 후보: 에너지 콤보 차트 캔버스 및 그 부모
        		const canvas = document.getElementById('chart-energy-combo');
        		root = document.getElementById('chart-energy-container')
        			|| document.getElementById('chart-energy-wrap')
        			|| (canvas ? canvas.parentElement : null);
        	}
        	if (!root) return;

        	// 2) 제목 요소(있으면 사용), 없으면 캔버스 엘리먼트를 확보하여 앞에 꽂는다.
        	const titleEl	= root.querySelector('h1,h2,h3,.chart-title');	// 제목 DOM (없을 수 있음)
        	const canvasEl	= root.querySelector('#chart-energy-combo, canvas');	// 주요 캔버스

        	// 3) 텍스트 구성: 우선순위 (건물명 → 주소 → '건물명 없음')
        	const ds		= document.getElementById('forecast-root')?.dataset || {};
        	const name		= (ds.buildingName || '').trim();
        	const addr		= (ds.roadAddr || ds.jibunAddr || ds.address || '').trim();
        	let infoText	= '';
        	if (name) infoText = name;
        	else if (addr) infoText = addr;
        	else infoText = '건물명 없음';
        	if (!infoText) return;

        	// 4) 이미 라벨이 있고 텍스트가 비어있지 않다면 유지(Chart A에서 만든 걸 B/C에서 계속 사용)
        	const existsText = root.querySelector('.chart-context')?.textContent?.trim();
        	if (existsText) return;

        	// 5) 라벨 엘리먼트 생성/삽입 (제목 아래 → 캔버스 앞 → 루트 맨 앞 순)
        	let ctxEl = root.querySelector('.chart-context');
        	if (!ctxEl) {
                ctxEl = document.createElement('div');
                /* ✨ 차트 라벨: 현재 위치(제목 아래) + 배지(알약) 스타일. 오버레이는 쓰지 않음 */
                ctxEl.className = 'chart-context chart-badge';
        		if (titleEl) {
        			// 제목 DOM이 있으면 "그 아래"에 삽입
        			titleEl.insertAdjacentElement('afterend', ctxEl);
        		} else if (canvasEl) {
        			// 제목 DOM이 없고, 차트 제목이 캔버스 내부에 그려지는 경우 → 캔버스 "앞"에 삽입
        			root.insertBefore(ctxEl, canvasEl);
        		} else {
        			// 최후 폴백: 루트의 맨 앞
        			root.prepend(ctxEl);
        		}
        	}

        	// 6) 텍스트 주입
        	ctxEl.textContent = infoText;
        }


		// 외부에서 호출
		window.SaveGreen.Forecast.injectChartContextLine = injectChartContextLine;
	})();

	/* =========================
	 * A 모델 — 스플라인 영역 (점 → 선·영역)
	 *  - 점들을 순차로 그리고, 마지막에 선/영역을 한 번에 켜서
	 *    '우측 바닥과 연결되는 꼬리' 현상을 방지.
	 *  - 비용축(yCost)은 C에서 계산된 범위를 받아 표시만 고정(값은 0으로 유지 가능)
	 * ========================= */
	async function renderModelAChart(opts) {
		__clearStageTimers();

		// ⬇️ 기존처럼 years, yhat 사용하되 “중복 선언” 없이 안전 분해
		const { years, yhat } = opts || {};
		const cr = (opts && opts.costRange) ? opts.costRange : null; // 비용축 범위(없으면 기본값)

		if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
		const canvas = document.getElementById('chart-energy-combo');
		if (!canvas) { console.warn('#chart-energy-combo not found'); return; }

		// 기존 차트 제거 (겹침 방지)
		if (Chart.getChart) {
			const existed = Chart.getChart(canvas);
			if (existed) existed.destroy();
		}
		if (energyChart) energyChart.destroy();

		const ctx = canvas.getContext('2d');
		const labels = (years || []).map(String);
		const n = labels.length;

		// 팔레트 / 타이밍(시연 속도 보장: 점 → 선)
		const AREA_LINE = '#D80004';
		const AREA_BG   = 'rgba(216, 0, 4, 0.18)';
		const POINT_MS = 500, POINT_GAP_MS = 300; // ← 점 하나당 시간/간격

		updateStageBadge('A', '모델 A : 선형 회귀'); // 우상단 배지

		// 길이/결측 보정(Forward-fill)
		const yFixed = fixSeriesToLength(yhat, n);

		// C와 동일한 “점 → 선(영역)” 방식
		const ds = {
			type: 'line',
			order: 1,
			label: '에너지 사용량',
			data: yFixed,
			yAxisID: 'yEnergy',
			fill: false,                       // 처음엔 면 끔
			tension: 0.35,
			cubicInterpolationMode: 'monotone',
			borderWidth: 2,
			borderColor: AREA_LINE,
			backgroundColor: AREA_BG,
			showLine: false,                   // 처음엔 선 끔(→ 나중에 한 번에 켬)
			pointRadius: new Array(n).fill(0), // 포인트는 순차 등장
			pointBorderWidth: 0,
			pointBackgroundColor: AREA_LINE,
			animations: {
				// y 애니메이션: 베이스라인에서 점만 순차로 올라오게
				y: {
					from: fromBaseline,
					duration: POINT_MS,
					delay: (c) => (c.type !== 'data' || c.mode !== 'default')
						? 0
						: c.dataIndex * (POINT_MS + POINT_GAP_MS),
					easing: 'easeOutCubic'
				}
			}
		};

		energyChart = new Chart(ctx, {
			type: 'line',
			data: { labels, datasets: [ds] },
			options: {
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
				scales: {
					yEnergy: {
						type: 'linear', position: 'left',
						title: { display: true, text: '에너지 사용량 (kWh/년)' },
						ticks: { callback: (v) => nfLocal(v) }
					},
					yCost: {
						type: 'linear',
						position: 'right',
						grid: { drawOnChartArea: false },
						title: { display: true, text: '비용 절감 (원/년)' },
						// ⬇️ C와 동일 스케일 고정(넘겨받지 못하면 0~auto)
						ticks: {
							callback: (v) => fmtCostTick(v),
							stepSize: cr ? (cr.step || getNiceStep(cr.min, cr.max)) : undefined
						},
						min: 0,
						max: cr ? cr.max : undefined
					},
					x: { title: { display: false } }
				},
				elements: { point: { hoverRadius: 5 } }
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

		// 모든 점 표시 후, 선/영역을 한 번에 켬 → 바닥 꼬리 없음
		const totalPointDuration = n * (POINT_MS + POINT_GAP_MS);
		const idReveal = setTimeout(() => {
			if (energyChart !== chartRef) return;
			const _ds = chartRef.data.datasets[0];
			_ds.showLine = true;
			_ds.fill = true; // 영역 ON
			chartRef.update('none');
		}, totalPointDuration + 80);
		__pushTimer(idReveal);

		window.energyChart = energyChart;

		// A 차트 렌더 함수 마지막에 추가(제목 아래 컨텍스트 라인 삽입)
		if (window.SaveGreen?.Forecast?.injectChartContextLine) {
			window.SaveGreen.Forecast.injectChartContextLine('chartA');
		}

		// [NEW] 이 단계의 "실제 애니메이션 종료" 시점을 반환
		//  - 포인트 전부 + reveal 버퍼(120ms)
		const doneMs = totalPointDuration + 80 + 120;
		await new Promise((r) => setTimeout(r, doneMs));
		return doneMs;
	}

	/* =========================
	 * B 모델 — 꺾은선 (점 → 선)
	 *  - 점들을 순차로 그리고, 마지막에 선을 한 번에 켜서
	 *    '우측 바닥과 연결되는 꼬리' 현상을 방지.
	 *  - 비용축(yCost)은 C에서 계산된 범위를 받아 표시만 고정(값은 0으로 유지 가능)
	 * ========================= */
	async function renderModelBChart(opts) {
		__clearStageTimers();

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

		// 팔레트 / 타이밍
		const LINE_COLOR = '#F57C00';
		const POINT_MS = 500, POINT_GAP_MS = 300;

		updateStageBadge('B', '모델 B : 로지스틱 회귀');

		const yFixed = fixSeriesToLength(yhat, n);

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
			showLine: false,                    // 처음엔 선 숨김
			pointRadius: new Array(n).fill(0),
			pointBackgroundColor: LINE_COLOR,
			pointBorderWidth: 0,
			animations: {
				y: {
					from: fromBaseline,
					duration: POINT_MS,
					delay: (c) => (c.type !== 'data' || c.mode !== 'default')
						? 0
						: c.dataIndex * (POINT_MS + POINT_GAP_MS),
					easing: 'easeOutCubic'
				}
			}
		};

		energyChart = new Chart(ctx, {
			type: 'line',
			data: { labels, datasets: [ds] },
			options: {
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
				scales: {
					yEnergy: {
						type: 'linear', position: 'left',
						title: { display: true, text: '에너지 사용량 (kWh/년)' },
						ticks: { callback: (v) => nfLocal(v) }
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
				},
				elements: { point: { hoverRadius: 5 } }
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

		// 포인트 모두 표시한 뒤 선을 한 번에 켠다(꼬리 방지)
		const totalPointDuration = n * (POINT_MS + POINT_GAP_MS);
		const idReveal = setTimeout(() => {
			if (energyChart !== chartRef) return;
			const _ds = chartRef.data.datasets[0];
			_ds.showLine = true;
			chartRef.update('none');
		}, totalPointDuration + 80);
		__pushTimer(idReveal);

		window.energyChart = energyChart;

		// B 차트 렌더 함수 마지막에 추가(제목 아래 컨텍스트 라인 삽입)
		if (window.SaveGreen?.Forecast?.injectChartContextLine) {
			window.SaveGreen.Forecast.injectChartContextLine('chartB');
		}

		// [NEW] B 단계 애니메이션 종료 시점 반환
		const doneMs = totalPointDuration + 80 + 120;
		await new Promise((r) => setTimeout(r, doneMs));
		return doneMs;
	}

	/* =========================
	 * C 모델 — 에너지 막대 + 비용 선 콤보 (점 → 선)
	 *  - 우측 yCost를 costRange로 고정해서 A/B와 동일 스케일
	 *  - 막대 → 포인트 → 선 순서(요구 사양 충족)
	 *  - 선/점은 항상 막대 위 레이어로 보이도록 플러그인으로 강제
	 * ========================= */
	async function renderEnergyComboChart(opts) {
		__clearStageTimers();

		if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
		const canvas = document.getElementById('chart-energy-combo');
		if (!canvas) { console.warn('#chart-energy-combo not found'); return; }

		// [NEW] 옵션 안전 분해
		const years  = (opts?.years || []).map(String);
		const series = opts?.series || {};
		const cost   = opts?.cost   || {};
		const cr     = opts?.costRange || null; // ← A/B와 맞추는 비용축 범위

		// 기존 차트 제거
		if (Chart.getChart) {
			const existed = Chart.getChart(canvas);
			if (existed) existed.destroy();
		}
		if (energyChart) energyChart.destroy();

		const ctx = canvas.getContext('2d');

		// C단계 타이밍(막대 → 포인트 → 선)
		const BAR_GROW_MS = 600;
		const BAR_GAP_MS  = 120;
		const POINT_MS    = 240;
		const POINT_GAP_MS= 90;

		const labels = years;
		const bars   = Array.isArray(series?.after) ? series.after.slice(0, labels.length) : [];
		const costs  = Array.isArray(cost?.saving) ? cost.saving.slice(0, labels.length) : [];
		const n = labels.length;

		// 팔레트
		const BAR_BG = 'rgba(54, 162, 235, 0.5)';
		const BAR_BORDER = 'rgb(54, 162, 235)';
		const LINE_ORANGE = '#F57C00';

		// 전체 타임라인 계산(막대 → 포인트 → 선)
		const totalBarDuration = n * (BAR_GROW_MS + BAR_GAP_MS);
		const pointStartAt     = totalBarDuration + 200;
		const totalPointDuration = n * (POINT_MS + POINT_GAP_MS);
		const lineRevealAt     = pointStartAt + totalPointDuration;

		updateStageBadge('C', '모델 C : 종합');

		// 선 데이터셋(비용 절감, 우측 축)
		const lineDs = {
			type: 'line',
			order: 9999,
			label: '비용 절감',
			data: costs,
			yAxisID: 'yCost',
			tension: 0.3,
			spanGaps: false,
			fill: false,
			showLine: false, // 포인트 먼저 나타나고 라인은 나중에
			pointRadius: new Array(n).fill(0),
			borderWidth: 3,
			borderColor: LINE_ORANGE,
			backgroundColor: LINE_ORANGE,
			pointBackgroundColor: LINE_ORANGE,
			pointBorderWidth: 0,
			animations: {
				y: {
					from: fromBaseline,
					duration: POINT_MS,
					delay: (ctx) => {
						if (ctx.type !== 'data' || ctx.mode !== 'default') return 0;
						return pointStartAt + ctx.dataIndex * (POINT_MS + POINT_GAP_MS);
					},
					easing: 'easeOutCubic'
				}
			}
		};

		// 막대 데이터셋(에너지 사용량, 좌측 축)
		const barDs = {
			type: 'bar',
			order: 1,
			label: '에너지 사용량',
			data: bars,
			yAxisID: 'yEnergy',
			backgroundColor: BAR_BG,
			borderColor: BAR_BORDER,
			borderWidth: 1,
			animations: {
				x: { duration: 0 },
				y: {
					from: fromBaseline,
					duration: BAR_GROW_MS,
					delay: (ctx) => {
						if (ctx.type !== 'data' || ctx.mode !== 'default') return 0;
						return ctx.dataIndex * (BAR_GROW_MS + BAR_GAP_MS);
					},
					easing: 'easeOutCubic'
				}
			}
		};

		// 선을 항상 막대 위에 그리기 위한 플러그인
		const forceLineFront = {
			id: 'forceLineFront',
			afterDatasetsDraw(chart) {
				const idx = chart.data.datasets.indexOf(lineDs);
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
			data: { labels, datasets: [barDs, lineDs] },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: true },
					tooltip: {
						callbacks: {
							label: (ctx) => {
								const isCost = ctx.dataset.yAxisID === 'yCost';
								const val = ctx.parsed?.y ?? 0;
								return `${ctx.dataset.label}: ${nfLocal(val)} ${isCost ? '원/년' : 'kWh/년'}`;
							}
						}
					},
					title: { display: true, text: '에너지 / 비용 예측', padding: { top: 8, bottom: 4 } },
					subtitle: { display: false },
					forceLineFront: {}
				},
				elements: { point: { hoverRadius: 5 } },
				scales: {
					yEnergy: {
						type: 'linear',
						position: 'left',
						ticks: { callback: (v) => nfLocal(v) },
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
						min: 0,   // C도 동일 범위 사용(넘어오면)
						max: cr ? cr.max : undefined
					},
					x: { title: { display: false } }
				}
			},
			plugins: [forceLineFront]
		});

		// 선 포인트 순차 등장(막대가 다 그려진 뒤 시작)
		const chartRef = energyChart;
		for (let i = 0; i < n; i++) {
			const delay = pointStartAt + i * (POINT_MS + POINT_GAP_MS);
			const id = setTimeout(() => {
				if (energyChart !== chartRef) return;
				const ds = chartRef?.data?.datasets?.[1];
				if (!ds) return;
				if (!Array.isArray(ds.pointRadius)) ds.pointRadius = new Array(n).fill(0);
				if (i >= ds.pointRadius.length) return;
				ds.pointRadius[i] = 3;
				chartRef.update('none');
			}, delay);
			__pushTimer(id);
		}

		// 라인 표시 타이머(포인트 모두 등장 후 라인 ON)
		const idReveal = setTimeout(() => {
			if (energyChart !== chartRef) return;
			const bar = chartRef?.data?.datasets?.[0];
			const line = chartRef?.data?.datasets?.[1];
			if (bar)  bar.animations = false;
			if (line) line.showLine = true;
			chartRef.update('none');
		}, lineRevealAt + 50);
		__pushTimer(idReveal);

		// C(에너지/비용) 차트 렌더 함수 마지막에 추가(제목 아래 컨텍스트 라인 삽입)
		if (window.SaveGreen?.Forecast?.injectChartContextLine) {
			window.SaveGreen.Forecast.injectChartContextLine('chartC');
		}

		window.energyChart = energyChart;
	}

	// 전역/네임스페이스에 노출(외부 호출부/메인 시퀀스에서 사용)
	window.SaveGreen.Forecast.renderModelAChart = renderModelAChart;
	window.SaveGreen.Forecast.renderModelBChart = renderModelBChart;
	window.renderEnergyComboChart = renderEnergyComboChart;
	window.SaveGreen.Forecast.renderEnergyComboChart = renderEnergyComboChart;
})();
