// forecast.kpi.js — KPI 계산·상태 판정 모듈(IIFE, 전역/네임스페이스 동시 노출)
(function () {
	// 네임스페이스 보장
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

    // 맨 위 근처에 전역 스위치 추가
    const USE_API_KPI = true; // true면 API KPI를 그대로 사용, false면 FE에서 재계산

    /* ---------- KPI / 상태 / 출력 ---------- */
    // kpi 계산 (API가 준 kpi가 없을때 FE에서 계산)
    // - 입력에 base(dae.json: {tariff, capexPerM2, savingPct})와 floorArea가 오면 이를 우선 사용
    // - series.saving/series.after가 있으면 그것을 우선 사용(데이터 일관성)
    function computeKpis({ years, series, cost, kpiFromApi, base, floorArea }) {
        // 0) API KPI 사용 여부 스위치 (조건 완화: 세 항목 중 하나라도 오면 신뢰)
        if (USE_API_KPI && kpiFromApi && (
              kpiFromApi.savingPct != null ||
              kpiFromApi.paybackYears != null ||
              kpiFromApi.savingCostYr != null
        )) {
            return {
                savingPct:    Number(kpiFromApi.savingPct ?? 0),
                savingKwhYr:  Number(kpiFromApi.savingKwhYr ?? 0),
                savingCostYr: Number(kpiFromApi.savingCostYr ?? 0),
                paybackYears: Number(kpiFromApi.paybackYears ?? Infinity)
            };
        }

        // 가장 마지막 연도의 지표로 계산
        const i = 0;

        const afterKwhRaw  = Number(series?.after?.[i]  ?? 0);
        const savingKwhRaw = Number(series?.saving?.[i] ?? 0);

        // 실측 기반으로 before 복원: before = after + saving
        let afterKwh  = Math.max(0, afterKwhRaw);
        let savingKwh = Math.max(0, savingKwhRaw);
        let beforeKwh = afterKwh + savingKwh;

        // base.savingPct 보정은 '실측이 전혀 없을 때만' 제한적으로 사용
        if ((!Number.isFinite(savingKwh) || savingKwh <= 0) &&
            beforeKwh <= 0 &&
            base && Number.isFinite(base.savingPct) && base.savingPct > 0 && base.savingPct < 1) {
            // after만 있고 saving/before가 없을 때 역산
            if (Number.isFinite(afterKwh) && afterKwh > 0) {
                beforeKwh = Math.round(afterKwh / (1 - base.savingPct));
                savingKwh = Math.max(0, beforeKwh - afterKwh);
            }
        }

        // 절감률(%) 1자리 반올림: savingPct = saving / before
        let savingPctPct = 0;	// 퍼센트(%) 표기값
        if (Number.isFinite(beforeKwh) && beforeKwh > 0) {
        	const ratio = savingKwh / beforeKwh;     // 0~1
        	savingPctPct = Math.round(ratio * 1000) / 10; // 소수 1자리(%) 반올림
        }

        // 3) 비용절감(연): 우선 API cost.saving[i], 없으면 base.tariff × savingKwh
        //    - base.tariff 가 숫자거나, { unit: 숫자 } 형태 모두 지원
        let savingCost = Number(cost?.saving?.[i]);
        if (!Number.isFinite(savingCost) || savingCost <= 0) {
            const tariff =
                Number(base?.tariff?.unit) ||   // dae.json: { tariff: { unit: 145, escalationPct: ... } }
                Number(base?.tariff)       ||   // 혹시 숫자 하나로 내려오는 경우
                NaN;

            if (Number.isFinite(tariff) && tariff > 0 && savingKwh > 0) {
                savingCost = Math.round(savingKwh * tariff);
            } else {
                // 최후 폴백(기존 하드코딩 유지)
                savingCost = Math.round(savingKwh * 120);
            }
        }

        // 4) 회수기간(년) = CAPEX / 연간 비용절감
        //    CAPEX = capexFixed + capexPerM2 × max(0, floorArea - capexFreeArea)
        //    - base.capexFixed / base.capexPerM2 / base.capexFreeArea / floorArea / savingCost가 모두 유효하면 적용
        //    - 아니면 기존 폴백 후 3~8년 clamp
        let paybackYears;
        {
        	const capexFixed     = Number(base?.capexFixed);
        	const capexPerM2     = Number(base?.capexPerM2);
        	const capexFreeArea  = Number(base?.capexFreeArea);
        	const area           = Number(floorArea);

        	if (Number.isFinite(capexFixed)    && capexFixed    >= 0 &&
        		Number.isFinite(capexPerM2)    && capexPerM2    >  0 &&
        		Number.isFinite(capexFreeArea) && capexFreeArea >= 0 &&
        		Number.isFinite(area)          && area          >  0 &&
        		Number.isFinite(savingCost)    && savingCost    >  0) {

        		const effArea = Math.max(0, area - capexFreeArea);
        		const capex   = capexFixed + capexPerM2 * effArea;
        		paybackYears  = capex / savingCost;
        	} else {
        		// 폴백(기존 로직 유지)
        		const denom = Math.max(1, savingKwh);
        		paybackYears = (afterKwh / denom) * 0.8;
        	}
        }

        // 5) 절감률(%) = savingKwh / beforeKwh
        const savingPct = (beforeKwh > 0)
            ? Math.round((savingKwh / beforeKwh) * 100)
            : 0;

        return {
            savingCostYr: savingCost,   // 연간 비용 절감(원)
            savingKwhYr:  savingKwh,    // 연간 사용량 절감(kWh)
            savingPct,                   // 절감률(%)
            paybackYears                 // 회수기간(년)
        };
    }

    // 상태 판정(점수 + 라벨)
    function decideStatusByScore(kpi, opts = {}) {
        const now = new Date().getFullYear();
        const savingPct = Number(kpi?.savingPct ?? 0);
        const payback = Number(kpi?.paybackYears ?? Infinity);
        const builtYear = Number(opts?.builtYear);

        let score = 0;

        // 1. 절감률
        if (savingPct >= 18) score += 2;
        else if (savingPct >= 10) score += 1;

        // 2. 회수기간
        if (payback <= 15) score += 2;
        else if (payback <= 20) score += 1;

        // 3. 연식(없으면 중립 1점)
        let agePt = 1;
        if (Number.isFinite(builtYear) && builtYear > 0 && builtYear <= now) {
            const age = now - builtYear;
            if (age >= 25) agePt = 2;
            else if (age >= 10) agePt = 1;
            else agePt = 0;
        }
        score += agePt;

        // 가드
		if (savingPct < 5 || payback > 20) {
			const status = 'not-recommend';
			return { status, label: status, score };
		}

		const status = (score >= 4) ? 'recommend'
		             : (score >= 2) ? 'conditional'
		             : 'not-recommend';
		return { status, label: status, score };
	}

	// ─────────────────────────────────────────────────────────────
	// KPI 도메인 보조 함수 3종 (IIFE 안쪽, decideStatusByScore 바로 아래에 배치)
	// - main.js에 남아 있던 '순수 계산로직'을 본 KPI 모듈로 이관
	// - DOM 접근/렌더링 없음(순수 함수) → 단위 테스트/재사용 용이
	// 사용처:
	//   1) main.js → SaveGreen.Forecast.KPI.computeCurrentEui(...)
	//   2) main.js → SaveGreen.Forecast.KPI.pickGradeByRules(...)
	//   3) main.js → SaveGreen.Forecast.KPI.getBoundaryForGrade(...)
	// 주의:
	//   - 여기(IIFE) '안쪽'이 맞습니다. 아래 export 묶음에 포함시켜 외부에서 접근하도록 합니다.

	/**
	 * 현재 EUI 계산(마지막 after ÷ 면적)
	 * @param {{series:{after:number[]}}} data
	 * @param {number} floorArea
	 * @returns {number|null}
	 */
	function computeCurrentEui(data, floorArea) {
		if (!Array.isArray(data?.series?.after) || !Number.isFinite(floorArea) || floorArea <= 0) return null;
		const afterArr = data.series.after;
		const last = Number(afterArr[afterArr.length - 1]);
		if (!Number.isFinite(last) || last <= 0) return null;
		return Math.round(last / floorArea);
	}

	/**
	 * EUI 룰 기반 등급 산정
	 * - mode === 'electricity' : thresholds {1,2,3} 기준
	 * - mode === 'primary'    : PEF 적용 후 bands[min,max,grade]
	 * @param {number} euiSite  현장(site) EUI
	 * @param {{mode?:string, electricityGradeThresholds?:object, pef?:{electricity:number}, primaryGradeBands?:Array}} rules
	 * @returns {number|string|null} 숫자 등급(1~4) 또는 문자열 등급(예: "1+"), 없으면 null
	 */
	function pickGradeByRules(euiSite, rules) {
		if (!rules || !Number.isFinite(euiSite)) return null;
		const mode = (rules.mode || 'electricity').toLowerCase();

		if (mode === 'electricity') {
			const th = rules.electricityGradeThresholds || {};
			const g1 = Number(th['1']), g2 = Number(th['2']), g3 = Number(th['3']);
			if (Number.isFinite(g1) && euiSite <= g1) return 1;
			if (Number.isFinite(g2) && euiSite <= g2) return 2;
			if (Number.isFinite(g3) && euiSite <= g3) return 3;
			return 4;
		}

		// primary 모드: PEF 적용 뒤 bands 구간 매칭
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

	/**
	 * 목표 등급 경계(EUI 또는 1차EUI) 조회
	 * - 다음 등급으로 '올라가기' 위한 경계값을 rules에서 찾아 반환
	 * @param {number|string} targetGrade 목표 등급(숫자 또는 문자열)
	 * @param {*} rules KPI rules(json from dae.json)
	 * @returns {{value:number, unit:string, kind:'site'|'primary'}|null}
	 */
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
	// ───────────────────────────────────────────────────────────


	// 전역/네임스페이스에 노출(기존 + KPI 네임스페이스 동시 제공)
	window.computeKpis = computeKpis;
	window.decideStatusByScore = decideStatusByScore;

	window.SaveGreen.Forecast.computeKpis = computeKpis;
	window.SaveGreen.Forecast.decideStatusByScore = decideStatusByScore;

	// KPI 서브 네임스페이스로 순수 도메인 로직을 묶어서 노출
	window.SaveGreen.Forecast.KPI = Object.assign(
		window.SaveGreen.Forecast.KPI || {},
		{
			computeKpis,
			decideStatusByScore,
			computeCurrentEui,
			pickGradeByRules,
			getBoundaryForGrade
		}
	);
})();