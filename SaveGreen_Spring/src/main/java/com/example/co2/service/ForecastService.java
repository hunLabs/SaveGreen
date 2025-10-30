package com.example.co2.service;

import com.example.co2.dto.ForecastDtos.Cost;
import com.example.co2.dto.ForecastDtos.ForecastResponse;
import com.example.co2.dto.ForecastDtos.Kpi;
import com.example.co2.dto.ForecastDtos.Series;
import com.example.co2.entity.ApiCache;
import com.example.co2.repository.ApiCacheRepository;
import com.example.co2.util.HashUtils;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.time.Year;

// [ADD] 로깅 (save→upsert 변경 로그 위해 추가)
import lombok.extern.slf4j.Slf4j;

/*
 * ────────────────────────────────────────────────────────────────────────────
 * SaveGreen · ForecastService 설계 메모 (BE 기준)
 * ────────────────────────────────────────────────────────────────────────────
 * 목표
 *  - FE/ML/BE 일치화 유지. FE는 서버가 내려주는 값을 "표시"만 하며 재계산 금지.
 *  - 차트는 항상 우하향(형태 고정): after 매년 6%↓, saving 매년 8%↓.
 *  - "절대값"은 건물별로 달라지도록 BE에서 스케일링(면적·EUI·단가·CAPEX 반영).
 *
 * 핵심 아이디어
 *  1) "형태"와 "스케일"을 분리:
 *     - 형태: 6%/8% 감소 규칙(연차마다 지수감소)을 고정 → 모든 건물 동일한 트렌드를 보장.
 *     - 스케일: baseline_kWh(면적×EUI)와 요금·투자비를 건물별로 적용 → 막대/금액/KPI는 건물마다 크게 달라짐.
 *
 *  2) KPI 대표값(마지막 연도 기준):
 *     - savingKwhYr  : 마지막 해 절감 전력량 (kWh/년)
 *     - savingCostYr : 마지막 해 절감 비용   (원/년)   = savingKwhYr × unitPrice
 *     - savingPct    : 정수 % (정책상 표시용·FE와 동일 포맷)
 *     - paybackYears : 소수 2자리(투자비 / 마지막 해 절감 비용)
 *
 *  3) 라벨/점수(프론트와 동일 기준):
 *     - 가드: savingPct < 5 또는 paybackYears > 12 → NOT_RECOMMEND
 *     - 절감률 점수: ≥18%:2, ≥10%:1
 *     - 회수기간 점수: ≤8y:2, ≤12y:1
 *     - 연식 점수: 미상=1, age≥25:2, age≥10:1, else 0
 *     - 합산: ≥4: RECOMMEND, ≥2: CONDITIONAL, else NOT_RECOMMEND
 *
 * 캐시 키
 *  - 요청 파라미터(builtYear/use/floorArea/pnu 포함) 해시 → upsert(HIT/MISS 정상 동작 확인).
 *
 * 주의
 *  - BASE_KWH/START_SAVING 등 "고정 상수만"으로 시계열을 만들면 건물 간 값이 같아짐.
 *    아래 computeStub(...)는 면적×EUI를 이용해 baseline을 건물별로 스케일하여 이 문제를 해결.
 * ────────────────────────────────────────────────────────────────────────────
 */

@Slf4j // [ADD]
@Service
public class ForecastService {

	@Value("${app.cache.ttl-minutes:10}")
	private int ttlMinutes;

	// FE와 동일 파라미터(더미 생성 기준)
	//  - BASE_KWH, START_SAVING 은 과거 "고정 더미" 시절의 잔재 상수로 남겨두되,
	//    아래 computeStub(...)에서는 건물 컨텍스트(면적×EUI) 기반으로 스케일링하므로 사용하지 않는다.
	private static final long   BASE_KWH      = 2_150_000L; // 첫 해 after (과거 고정 더미 용. 현재 미사용)
	private static final double AFTER_RATE    = 0.06;       // 매년 6% 감소 (형태)
	private static final long   START_SAVING  = 360_000L;   // 첫 해 saving(kWh) (과거 고정 더미 용. 현재 미사용)
	private static final double SAVING_RATE   = 0.08;       // 매년 8% 감소 (형태)
	private static final long   UNIT_PRICE    = 150L;       // 원/kWh (cost.saving 산출)

	// payback 계산용 기본 투자비(면적 미반영, 과거 상수). 아래 CAPEX 모델로 대체.
	private static final long   DEFAULT_RETROFIT_COST_WON = 90_000_000L;

	// 아래 3개는 "건물별 스케일"을 위해 실제로 사용.
	//  - DEFAULT_EUI_KWH_PER_M2Y : 면적당 연간 전력 사용량(EUI), kWh/㎡·년
	//  - CAPEX_PER_M2            : ㎡당 투자비(원)
	//  - CAPEX_FIXED             : 고정 초기비(원)
	private static final double DEFAULT_EUI_KWH_PER_M2Y = 380.0;	// kWh/㎡·년
	private static final long   CAPEX_PER_M2            = 200_000L;	// 원/㎡
	private static final long   CAPEX_FIXED             = 30_000_000L;	// 원

	private final ApiCacheRepository apiCacheRepository;
	private final ObjectMapper objectMapper;

	public ForecastService(ApiCacheRepository apiCacheRepository, ObjectMapper objectMapper) {
		this.apiCacheRepository = apiCacheRepository;
		this.objectMapper = objectMapper;
	}

	/** 컨트롤러에서 호출되는 공개 메서드 (기존 시그니처) */
	public ForecastResponse forecast(Long buildingId, int fromYear, int toYear, String scenario, Integer builtYear) {
		return forecast(buildingId, fromYear, toYear, scenario, builtYear, null, null, null);
	}

	// [ADD] 확장 오버로드: use, floorArea, pnu 포함 → 캐시 키와 계산에 모두 반영
	public ForecastResponse forecast(
			Long buildingId,
			int fromYear,
			int toYear,
			String scenario,
			Integer builtYear,
			String use,
			Double floorArea,
			String pnu
	) {
		// 1) from==to → 7년 확장, from>to → 스왑
		int[] range = normalizeRange(fromYear, toYear);
		int from = range[0], to = range[1];

		// 2) 캐시 키 구성 (기존 + builtYear/use/floorArea/pnu 추가)
		String keyRaw = buildCacheKeyRaw(buildingId, from, to, scenario)
				+ ";builtYear=" + ((builtYear == null || builtYear <= 0) ? "na" : String.valueOf(builtYear))
				+ ";use=" + ((use == null || use.isBlank()) ? "na" : use.trim())
				+ ";floorArea=" + ((floorArea == null) ? "na" : String.valueOf(floorArea))
				+ ";pnu=" + ((pnu == null || pnu.isBlank()) ? "na" : pnu.trim());
		String keyHash = HashUtils.sha256Hex(keyRaw);

		// 3) 캐시 조회(미만료)
		Optional<ApiCache> cached = apiCacheRepository.findTopByCacheKeyHashAndExpiresAtAfter(
				keyHash, LocalDateTime.now()
		);
		if (cached.isPresent()) {
			log.info("[forecast] cache HIT hash = {}", keyHash);
			try {
				ForecastResponse r = objectMapper.readValue(
						cached.get().getPayloadJson(), ForecastResponse.class
				);
				// 확인용 로그 (기존과 동일)
				double pct = r.kpi().savingPct();
				double payback = r.kpi().paybackYears();

				// builtYear는 kpi에 없으므로, 메서드 파라미터 'builtYear'를 사용
				Integer by = builtYear;

				// label도 kpi에 없으므로, 현재 응답 값(pct, payback, builtYear)로 재판정
				String label = decideLabelByScore(pct, payback, by);

				int score = computeStatusScore(pct, payback, by);
				log.info("[forecast] score = {}, label = {}, builtYear = {}, savingPct = {}%, payback = {}y",
						score, label, by == null ? "na" : by, String.format("%.1f", pct), String.format("%.2f", payback));
				return r;
			} catch (Exception e) {
				log.warn("[forecast] cache parse failed; recomputing", e);
			}
		}

		log.info("[forecast] cache MISS hash = {}, computing...", keyHash);

		// 4) 계산 — 건물 컨텍스트(용도/면적/pnu)를 반영하여 "절대값"이 건물마다 달라지도록 한다.
		ForecastResponse resp = computeStub(
				buildingId, from, to, builtYear, use, floorArea, pnu
		);

		// 5) 캐시 저장 (UPSERT)
		try {
			final String payload = objectMapper.writeValueAsString(resp);
			final LocalDateTime expiresAt = LocalDateTime.now().plusMinutes(ttlMinutes);

			apiCacheRepository.upsert(
					keyHash,
					keyRaw,
					payload,
					expiresAt,
					buildingId,
					null // guestIp 있으면 전달, 없으면 null
			);
		} catch (Exception e) {
			log.warn("api_cache upsert failed hash = {}", keyHash, e);
		}

		return resp;
	}



	/* ===== 내부 구현 ===== */

	private String buildCacheKeyRaw(Long buildingId, int from, int to, String scenario) {
		String b = (buildingId == null) ? "none" : String.valueOf(buildingId);
		String scen = (scenario == null || scenario.isBlank()) ? "default" : scenario;
		return "buildingId=" + b + ";from=" + from + ";to=" + to + ";scenario=" + scen;
	}

	/** from==to면 +6 확장(총 7년), from>to면 스왑 */
	private int[] normalizeRange(int from, int to) {
		if (to < from) { int t = from; from = to; to = t; }
		if (to == from) to = from + 6; // 총 7개 연도
		return new int[]{from, to};
	}

	/**
	 * 건물 컨텍스트(면적×EUI)로 baseline_kWh를 스케일링하여
	 * "형태(6%/8% 감소)"는 유지하되 "절대값"은 건물마다 달라지도록 더미 시계열과 KPI를 생성한다.
	 *
	 * from/to는 이미 normalizeRange(...)에서 정규화되었음을 전제로 한다.
	 */
	private ForecastResponse computeStub(
			Long buildingId,
			int from,
			int to,
			Integer builtYear,
			String use,
			Double floorArea,
			String pnu
	) {
		// 0) 범위/길이
		final int len = (to - from) + 1;

		// 1) years
		final List<String> years = new ArrayList<>(len);
		for (int y = from; y <= to; y++) years.add(String.valueOf(y));

		// 2) baseline_kWh 산정
		//    - 1순위: 면적 × EUI (면적이 유효한 경우)
		//    - 2순위: 과거 상수 BASE_KWH (면적 불명 시 폴백)
		final double area = (floorArea != null && floorArea > 0) ? floorArea : 0.0;
		final long baseKwhFallback = BASE_KWH; // 2,150,000
		final long baselineKwh = (area > 0)
				? Math.round(area * DEFAULT_EUI_KWH_PER_M2Y)
				: baseKwhFallback;

		// 3) 시계열 형태 파라미터(정책 고정)
		//    - AFTER_RATE: after(예측 사용량) 6% 지수감소
		//    - SAVING_RATE: saving(절감량) 8% 지수감소
		final double afterRate  = AFTER_RATE;
		final double savingRate = SAVING_RATE;

		// 4) 첫해 기준값
		//    - after(0)   ≈ baselineKwh × (1 - 6%)
		//    - saving(0)  ≈ baselineKwh × 8%
		final long startAfterKwh   = Math.round(baselineKwh * (1.0 - afterRate));
		final long startSavingKwh  = Math.round(baselineKwh * (savingRate));

		// 5) 시계열 생성(형태: 지수감소 / 스케일: baselineKwh)
		final List<Long> after  = new ArrayList<>(len);
		final List<Long> saving = new ArrayList<>(len);
		for (int i = 0; i < len; i++) {
			// after: baseline × (1 - 6%)^i  (항상 우하향)
			long afterVal  = Math.max(0L, Math.round(baselineKwh * Math.pow(1.0 - afterRate, i)));
			// saving: (baseline × 8%) × (1 - 8%)^i (항상 우하향)
			long savingVal = Math.max(0L, Math.round(startSavingKwh * Math.pow(1.0 - savingRate, i)));

			after.add(afterVal);
			saving.add(savingVal);
		}

		// 6) 절감 비용(원/년) 시계열: saving × 전력단가
		final List<Long> costSaving = new ArrayList<>(len);
		for (int i = 0; i < len; i++) {
			costSaving.add(saving.get(i) * UNIT_PRICE);
		}

		// 7) KPI(마지막 연도 기준)
		final int last = len - 1;
		final long repSavingKwh  = saving.get(last);
		final long repSavingCost = costSaving.get(last);

		// 표시용 절감률(%): 정책상 정수. (원한다면 baseline 대비 동적 계산으로 바꿀 수 있음)
		final int savingPctInt = (int) Math.round(savingRate * 100.0); // 8

		// 투자비(CAPEX): 고정 + 면적 비례 (면적 0이면 고정비만)
		final long capex = Math.max(0L, CAPEX_FIXED + Math.round(CAPEX_PER_M2 * Math.max(0.0, area)));

		// 회수기간(년) = CAPEX / (마지막 해 절감비용). 0으로 나누기 방지.
		double paybackYears = (repSavingCost > 0)
				? (double) capex / (double) repSavingCost
				: Double.POSITIVE_INFINITY;
		paybackYears = Math.round(paybackYears * 100.0) / 100.0; // 소수 2자리

		// 라벨/점수(프론트와 동일 규칙)
		final int score = computeStatusScore(savingPctInt, paybackYears, builtYear);
		final String label = decideLabelByScore(savingPctInt, paybackYears, builtYear);

		// 진단 로그(건물마다 baseline/area/capex가 달라지는지 즉시 확인 가능)
		log.info(
				"[forecast] ctx pnu={}, use={}, area(m2)={}, baselineKwh={}, unitPrice={}, capex={}, savingPct={}%, payback={}y",
				(pnu == null ? "na" : pnu),
				(use == null ? "na" : use),
				area, baselineKwh, UNIT_PRICE, capex,
				savingPctInt, String.format("%.2f", paybackYears)
		);

		// 8) DTO 구성
		final Series series = new Series(after, saving);
		final Cost cost = new Cost(costSaving);
		final Kpi kpi = new Kpi(repSavingKwh, repSavingCost, savingPctInt, paybackYears);

		return new ForecastResponse(years, series, cost, kpi);
	}

	public ForecastResponse forecast(Long buildingId, int fromYear, int toYear, String scenario) {
		return forecast(buildingId, fromYear, toYear, scenario, null);
	}

	/* ============================================================================
	 * 점수 규칙 — ML / FE와 완전 일치
	 *  - 가드: savingPct < 5% 또는 paybackYears > 12년 → 즉시 비추천(0점)
	 *  - 절감률 점수:  ≥18% ⇒ +2점,  ≥10% ⇒ +1점
	 *  - 회수기간 점수: ≤8년 ⇒ +2점,  ≤12년 ⇒ +1점
	 *  - 연식 점수:    미상=+1점(기본),  ≥25년=+2점, 10~24년=+1점, <10년=+0점
	 *  - 최종 라벨:   총점 ≥4 ⇒ RECOMMEND / 2~3 ⇒ CONDITIONAL / 그 외 ⇒ NOT_RECOMMEND
	 *
	 * 주의:
	 *  - ML/FE 합의에 따라 **가드의 회수기간 임계값은 12년**입니다(20년 아님).
	 *  - savingPct 비교는 **정수 %** 기준, paybackYears는 현재 이 함수 인자로 넘어온 값(서버 계산값)을 그대로 사용.
	 * ========================================================================== */
	private int computeStatusScore(double savingPct, double paybackYears, Integer builtYear) {
		// [가드] 절감률<5% 또는 회수기간>20년 → 0점 처리(즉시 비추천)
		if (savingPct < 5.0 || paybackYears > 20.0) return 0;

		int score = 0;

		// [절감률 점수] ≥18%:2점, ≥10%:1점
		if (savingPct >= 18.0) score += 2;
		else if (savingPct >= 10.0) score += 1;

		// [회수기간 점수] ≤10년:2점, ≤20년:1점
		if (paybackYears <= 15.0) score += 2;
		else if (paybackYears <= 20.0) score += 1;

		// [연식 점수] (미상 기본 1점; ≥25년=2점, 10~24년=1점, <10년=0점)
		int agePt = 1; // 기본 1점
		int now = Year.now().getValue();
		if (builtYear != null && builtYear > 0 && builtYear <= now) {
			int age = now - builtYear;
			if (age >= 25)      agePt = 2;
			else if (age >= 10) agePt = 1;
			else                agePt = 0;
		}
		score += agePt;

		return score;
	}

	/* ============================================================================
	 * 최종 라벨 — ML / FE와 완전 일치 (점수 규칙만 사용, 가드=12년)
	 *  - 가드 위반 시 즉시 NOT_RECOMMEND
	 *  - 그 외엔 점수 합산으로만 판정:
	 *      ≥4점: RECOMMEND / 2~3점: CONDITIONAL / 그 외: NOT_RECOMMEND
	 * ========================================================================== */
	private String decideLabelByScore(double savingPct, double paybackYears, Integer builtYear) {
		// [가드] ML/FE 합의: 회수기간 12년 초과는 비추천
		if (savingPct < 5.0 || paybackYears > 12.0) return "NOT_RECOMMEND";

		int score = computeStatusScore(savingPct, paybackYears, builtYear);
		if (score >= 4) return "RECOMMEND";
		if (score >= 2) return "CONDITIONAL";
		return "NOT_RECOMMEND";
	}


}
