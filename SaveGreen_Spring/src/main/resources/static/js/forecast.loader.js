// forecast.loader.js — ML 로더 전용 모듈(IIFE, 전역/네임스페이스 동시 노출)
(function () {
	'use strict'; // Strict 모드: 암묵적 전역/삭제불가 속성 삭제 등 실수 방지

	/* =========================================================================
	   네임스페이스 (전역 오염 방지 + 기존 코드와 호환)
	   -------------------------------------------------------------------------
	   - window.SaveGreen / window.SaveGreen.Forecast가 없으면 생성합니다.
	   - 이후 API는 window.SaveGreen.Forecast.* 로도 접근 가능하도록 동등 노출합니다.
	   ========================================================================= */
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

	/* =========================================================================
	   내부 유틸 (메인 의존 최소화)
	   -------------------------------------------------------------------------
	   - _rand(min,max): 진행바 가속/감속 느낌을 위한 난수
	   - _sleep(ms): 최소 노출시간 보장 등에서 대기 처리
	     (외부에 window.rand/window.sleep이 있으면 그것을 사용, 없으면 폴백 제공)
	   ========================================================================= */
	const _rand  = (typeof window.rand  === 'function')
		? window.rand
		: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

	const _sleep = (typeof window.sleep === 'function')
		? window.sleep
		: (ms) => new Promise(r => setTimeout(r, ms));

	/* =========================================================================
	   ML Loader 상태/파라미터
	   -------------------------------------------------------------------------
	   - TICK_MS: 진행바 업데이트 주기(ms). 작을수록 더 자주, 더 부드럽게 갱신.
	   - STEP_MIN/MAX: 틱당 증가폭 범위. 최소~최대치 사이에서 난수로 증가.
	   - STEP_PAUSE_MS: 5단계(20/40/60/80/100%) 사이 전환 때 잠깐 멈춰 체감 안정성 제공.
	   - MIN_VISIBLE_MS: 로더 화면 최소 노출 시간(너무 번쩍 꺼지는 느낌 방지).
	   - CLOSE_DELAY_MS: 100% 채운 뒤 화면 닫힘까지의 지연(잔여 애니메이션 시간).
	   - cap: 현재 단계의 목표 % (초기 20 → 이후 단계마다 +20 → 최대 100).
	   - startedAt: 시작 시각(performance.now), 최소 노출시간 계산에 사용.
	   ========================================================================= */
	const LOADER = {
		timer: null,        // 진행바 setInterval 핸들(주기적 tick)
		stepTimer: null,    // 단계 전환 setTimeout 핸들
		done: false,        // 외부 종료 플래그(중복 동작 방지)
		TICK_MS: 120,       // 진행바 업데이트 간격
		STEP_MIN: 1,        // 틱당 최소 증가치
		STEP_MAX: 3,        // 틱당 최대 증가치
		// 단계 사이 일시 정지(1→2, 2→3, 3→4, 4→5)
		STEP_PAUSE_MS: [1500, 1500, 1500, 1500],

		// UX를 위해 10초 이상은 노출 보장 (너무 번쩍 꺼지는 느낌 방지)
		MİN_VISIBLE_MS: 10000, // [오탈자 주의: 기존 키 유지 필요 시 변경 금지] ← 실제 사용 키는 아래 MIN_VISIBLE_MS 입니다.
		MIN_VISIBLE_MS: 10000,

		// 100% 도달 후 화면 닫힘 지연 (애니메이션 여유)
		CLOSE_DELAY_MS: 2000,

		// 진행 목표치(각 단계 도달 목표 %)
		cap: 20,
		startedAt: 0
	};

	/* =========================================================================
	   UI 셀렉터 헬퍼
	   -------------------------------------------------------------------------
	   - 선택자 접근 축약. document 범위를 다른 루트로 바꿔 테스트하기 쉽도록 root 인자 허용.
	   ========================================================================= */
	function $(s, root = document) { return root.querySelector(s); }
	function $all(s, root = document) { return Array.from(root.querySelectorAll(s)); }

	/* =========================================================================
	   내부: DOM 초기화 (재시작 대비)
	   -------------------------------------------------------------------------
	   - 진행바 0%로 초기화
	   - 단계 체크 표시 제거
	   - 상태 문구 '초기화'로 설정
	   - 주의: 상태 텍스트는 #preload-status를 사용(일부 코드에서 #mlStatusText를 쓰는 부분도 있으나
	           여기서는 기존 동작 유지 차원에서 변경하지 않음)
	   ========================================================================= */
	function _resetDom() {
		const $bar  = $('#progressBar');
		const steps = $all('.progress-map .step');
		const $text = $('#preload-status');

		if ($bar) {
			$bar.style.width = '0%';
			$bar.setAttribute('aria-valuenow', '0');
		}
		if (steps.length) steps.forEach(el => el.classList.remove('done'));
		if ($text) $text.textContent = '초기화';
	}

	/* =========================================================================
	   공개: 단계 라벨
	   -------------------------------------------------------------------------
	   - 로딩 단계별로 표시할 사람 친화적 문구.
	   - 필요 시 setStatus로 보조 문구를 병행 표시할 수 있음(예: 모델명, 서버 응답 대기 등).
	   ========================================================================= */
	const LABELS = {
		1: '데이터 로딩',
		2: '정규화 / 스케일링',
		3: '모델 피팅',
		4: '예측 / 검증',
		5: '차트 렌더링'
	};

	/* =========================================================================
	   공개: 로더 시작
	   -------------------------------------------------------------------------
	   - 내부 타이머 초기화 후 tick()으로 진행바를 단계별(cap 기준)로 증가시킵니다.
	   - 각 단계 도달 시 맵(.progress-map .step)에 체크 표시, 상태 라벨 갱신.
	   - 마지막 단계(5)에서는 tick 종료만 하고 닫지는 않습니다(외부 finishLoader가 담당).
	   ========================================================================= */
	function startLoader() {
		LOADER.startedAt = performance.now();
		LOADER.done = false;
		if (LOADER.timer) clearInterval(LOADER.timer);
		if (LOADER.stepTimer) clearTimeout(LOADER.stepTimer);

		_resetDom();

		const $bar  = $('#progressBar');
		const steps = $all('.progress-map .step');
		const $text = $('#preload-status'); // 참고: 경고 메시지에는 #mlStatusText가 언급되지만 실제 셀렉터는 #preload-status를 사용

		if (!$bar || steps.length < 5 || !$text) {
			console.warn('[loader] 필수 요소가 없습니다 (#progressBar, .progress-map .step×5, #mlStatusText)');
		}

		let progress = 0;  // 현재 진행 %
		let level = 1;     // 1~5 단계

		if ($text) $text.textContent = '초기화';
		LOADER.cap = 20;
		LOADER.timer = setInterval(tick, LOADER.TICK_MS);

		// 내부: 주기적 진행 함수
		function tick() {
			if (LOADER.done) return;
			if (!$bar) return;

			// 현재 목표(cap)까지 틱마다 증가
			if (progress < LOADER.cap) {
				progress += _rand(LOADER.STEP_MIN, LOADER.STEP_MAX);
				if (progress > LOADER.cap) progress = LOADER.cap;
				$bar.style.width = progress + '%';
				$bar.setAttribute('aria-valuenow', String(progress));
				return;
			}

			if (LOADER.done) return;

			// cap 도달 → 단계 완료 체크 + 라벨 업데이트
			const stepEl = steps[level - 1];
			if (stepEl) stepEl.classList.add('done');
			if ($text) $text.textContent = LABELS[level] || '진행 중';

			// 마지막 단계(5)면 틱 종료 (닫힘은 finishLoader가 담당)
			if (level === 5) {
				clearInterval(LOADER.timer);
				return;
			}

			// 다음 단계 준비: cap을 +20 하고 잠깐 멈췄다가 다음 틱 재개
			level += 1;
			LOADER.cap = Math.min(100, level * 20);

			clearInterval(LOADER.timer);
			LOADER.stepTimer = setTimeout(() => {
				if (LOADER.done) return;
				LOADER.timer = setInterval(tick, LOADER.TICK_MS);
			}, LOADER.STEP_PAUSE_MS[level - 2] || 0); // level-2: 1→2 전환 시 인덱스 0
		}
	}

	/* =========================================================================
	   공개: 수동 단계 동기화 setStep(step, text?)
	   -------------------------------------------------------------------------
	   - 자동틱을 멈추고 외부(실제 네트워크/연산 단계)에 맞춰 UI를 즉시 동기화합니다.
	   - step: 1~5, text: 상태 문구(선택). 미지정 시 LABELS[step].
	   - 권장 사용: 실제 “데이터 로딩/전처리/모델링/예측/차트” 각 단계 완료 타이밍에 호출.
	   ========================================================================= */
	function setStep(step, text) {
		const s = Math.max(1, Math.min(5, Number(step) || 1));

		const $bar  = $('#progressBar');
		const steps = $all('.progress-map .step');
		const $text = $('#mlStatusText'); // 이 함수에서는 #mlStatusText를 사용(기존 구조 유지)

		// 자동 진행 중지 → 수동 제어로 전환
		if (LOADER.timer) clearInterval(LOADER.timer);
		if (LOADER.stepTimer) clearTimeout(LOADER.stepTimer);

		// 맵 체크 표시: s 이전까지 체크, 이후는 해제
		for (let i = 0; i < steps.length; i++) {
			if (i < s) steps[i].classList.add('done');
			else steps[i].classList.remove('done');
		}

		// 진행바 퍼센트 동기화 (단계×20)
		LOADER.cap = s * 20;
		if ($bar) {
			$bar.style.width = LOADER.cap + '%';
			$bar.setAttribute('aria-valuenow', String(LOADER.cap));
		}

		// 라벨 갱신
		if ($text) $text.textContent = (text && String(text).trim()) || LABELS[s] || '진행 중';
	}

	/* =========================================================================
	   공개: 상태 문구만 바꾸기
	   -------------------------------------------------------------------------
	   - 모델명, 네트워크 상태 등 보조 텍스트 교체용
	   - 주의: 여기서는 #preload-status를 대상으로 함(기존 코드 호환 목적)
	   ========================================================================= */
	function setStatus(text) {
		const $text = $('#preload-status');
		if ($text && text != null) $text.textContent = String(text);
	}

	/* =========================================================================
	   공개: 모델명 칩 업데이트
	   -------------------------------------------------------------------------
	   - 모델 A/B/ENS 등 현재 동작 모델 표시
	   - UI에서 모델명 표시 배지를 따로 두는 케이스에 대응
	   ========================================================================= */
	function setModelName(name) {
		const $model = $('#modelName');
		if ($model && name != null) $model.textContent = String(name);
	}

	/* =========================================================================
	   공개: 최소 표시시간 보장
	   -------------------------------------------------------------------------
	   - startLoader에서 기록한 startedAt을 기준으로, MIN_VISIBLE_MS에 미달하면 부족 시간만큼 대기.
	   - “실제 처리 빨리 끝남 → 로더가 번쩍 사라짐” 상황 방지.
	   ========================================================================= */
	async function ensureMinLoaderTime() {
		const elapsed = performance.now() - LOADER.startedAt;
		const waitMs = Math.max(0, LOADER.MIN_VISIBLE_MS - elapsed);
		if (waitMs > 0) await _sleep(waitMs);
	}

	/* =========================================================================
	   공개: 로더 정상 종료(애니메이션 완료 → 약간의 지연 후 닫힘)
	   -------------------------------------------------------------------------
	   - 외부에서 실제 작업이 모두 끝났을 때 호출.
	   - 내부 플래그/타이머 정리 → 바 100% 채움 → CLOSE_DELAY_MS 후 resolve.
	   - 닫기 자체는 이 함수 바깥의 상위 레이어(UI 숨김 처리 등)에서 수행.
	   ========================================================================= */
	function finishLoader() {
		return new Promise((res) => {
			LOADER.done = true;
			if (LOADER.timer) clearInterval(LOADER.timer);
			if (LOADER.stepTimer) clearTimeout(LOADER.stepTimer);

			const $bar = $('#progressBar');
			if ($bar) {
				$bar.style.width = '100%';
				$bar.setAttribute('aria-valuenow', '100');
			}
			$all('.progress-map .step').forEach((el) => el.classList.add('done'));

			setTimeout(res, LOADER.CLOSE_DELAY_MS);
		});
	}

	/* =========================================================================
	   공개: 즉시 닫기(비상/스킵)
	   -------------------------------------------------------------------------
	   - 디버깅/스킵 등에서 강제 종료가 필요할 때 사용.
	   - 진행바/단계는 모두 완료 상태로 표시만 맞춰주고 즉시 반환.
	   ========================================================================= */
	function closeNow() {
		LOADER.done = true;
		if (LOADER.timer) clearInterval(LOADER.timer);
		if (LOADER.stepTimer) clearTimeout(LOADER.stepTimer);

		const $bar = $('#progressBar');
		if ($bar) {
			$bar.style.width = '100%';
			$bar.setAttribute('aria-valuenow', '100');
		}
		$all('.progress-map .step').forEach((el) => el.classList.add('done'));
	}

	/* =========================================================================
	   전역/네임스페이스 노출 (기존 코드와의 호환 유지)
	   -------------------------------------------------------------------------
	   - window.* 직노출: 레거시 코드/콘솔 테스트 용이.
	   - SaveGreen.Forecast.* 동등 노출: 앱 내부 표준 경로.
	   - 주의: 기존 호출부가 기대하는 시그니처/이름을 바꾸지 않습니다(호환성 유지).
	   ========================================================================= */
	window.LOADER = LOADER;
	window.startLoader = startLoader;
	window.ensureMinLoaderTime = ensureMinLoaderTime;
	window.finishLoader = finishLoader;

	// 새 수동 동기화 API도 함께 노출
	window.LOADER.setStep = setStep;
	window.LOADER.setStatus = setStatus;
	window.LOADER.setModelName = setModelName;
	window.LOADER.closeNow = closeNow;

	// SaveGreen 네임스페이스에도 동등 노출 (기존 호출부 그대로 동작)
	window.SaveGreen.Forecast.LOADER = LOADER;
	window.SaveGreen.Forecast.startLoader = startLoader;
	window.SaveGreen.Forecast.ensureMinLoaderTime = ensureMinLoaderTime;
	window.SaveGreen.Forecast.finishLoader = finishLoader;
	window.SaveGreen.Forecast.setLoaderStep = setStep;
	window.SaveGreen.Forecast.setLoaderStatus = setStatus;
	window.SaveGreen.Forecast.setLoaderModelName = setModelName;
	window.SaveGreen.Forecast.closeLoaderNow = closeNow;
})();
