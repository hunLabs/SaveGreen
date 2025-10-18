// forecast.kpi.js — KPI 계산·상태 판정 모듈(IIFE, 전역/네임스페이스 동시 노출)
(function () {
	// 네임스페이스 보장
	window.SaveGreen = window.SaveGreen || {};
	window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

    // 맨 위 근처에 전역 스위치 추가
    const USE_API_KPI = false; // true면 API KPI를 그대로 사용, false면 FE에서 재계산

    /* ---------- KPI / 상태 / 출력 ---------- */
    // kpi 계산 (API가 준 kpi가 없을때 FE에서 계산)
    // - 입력에 base(dae.json: {tariff, capexPerM2, savingPct})와 floorArea가 오면 이를 우선 사용
    // - series.saving/series.after가 있으면 그것을 우선 사용(데이터 일관성)
    function computeKpis({ years, series, cost, kpiFromApi, base, floorArea }) {
        // 0) API KPI 사용 여부 스위치
        if (USE_API_KPI && kpiFromApi && Number.isFinite(kpiFromApi.savingCostYr)) {
            return kpiFromApi;
        }

        // 가장 마지막 연도의 지표로 계산
        const i = Math.max(0, (Array.isArray(years) ? years.length : 0) - 1);

        const afterKwhRaw  = Number(series?.after?.[i]  ?? 0);
        const savingKwhRaw = Number(series?.saving?.[i] ?? 0);

        // 1) 데이터 기반으로 after/saving/before 정리
        let afterKwh  = Math.max(0, afterKwhRaw);
        let savingKwh = Math.max(0, savingKwhRaw);
        let beforeKwh = afterKwh + savingKwh;

        // 2) base.savingPct가 있고 series.saving이 비었으면 base로 보정
        //    - savingPct는 0~1(=13%면 0.13)로 가정
        if ((!Number.isFinite(savingKwh) || savingKwh === 0) &&
            base && Number.isFinite(base.savingPct) && base.savingPct > 0 && base.savingPct < 1) {

            // beforeKwh가 0이면 after에서 역산: after = before * (1 - s) → before = after / (1 - s)
            if (beforeKwh <= 0 && Number.isFinite(afterKwh)) {
                beforeKwh = Math.round(afterKwh / (1 - base.savingPct));
            }
            if (beforeKwh > 0) {
                savingKwh = Math.round(beforeKwh * base.savingPct);
            }
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

        // 4) 회수기간(년) = (capexPerM2 × 면적) / 연간 비용절감
        //    - base.capexPerM2, floorArea 모두 유효하면 사용
        //    - 아니면 기존 폴백 후 3~8년 clamp
        let paybackYears;
        {
            const capexPerM2 = Number(base?.capexPerM2);
            const area       = Number(floorArea);
            if (Number.isFinite(capexPerM2) && capexPerM2 > 0 &&
                Number.isFinite(area)       && area       > 0 &&
                Number.isFinite(savingCost) && savingCost > 0) {

                const capex = capexPerM2 * area;
                paybackYears = capex / savingCost;
            } else {
                // 폴백(기존 로직 유지)
                const denom = Math.max(1, savingKwh);
                paybackYears = (afterKwh / denom) * 0.8;
            }

            // 보수적 표시 범위 고정
            paybackYears = clamp(paybackYears, 3, 8);
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
        if (savingPct >= 15) score += 2;
        else if (savingPct >= 10) score += 1;

        // 2. 회수기간
        if (payback <= 5) score += 2;
        else if (payback <= 8) score += 1;

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
		if (savingPct < 5 || payback > 12) {
			const status = 'not-recommend';
			return { status, label: status, score };
		}

		const status = (score >= 4) ? 'recommend'
		             : (score >= 2) ? 'conditional'
		             : 'not-recommend';
		return { status, label: status, score };
	}

	// 전역/네임스페이스에 노출(기존 호출부 그대로 동작)
	window.computeKpis = computeKpis;
	window.decideStatusByScore = decideStatusByScore;
	window.SaveGreen.Forecast.computeKpis = computeKpis;
	window.SaveGreen.Forecast.decideStatusByScore = decideStatusByScore;
})();