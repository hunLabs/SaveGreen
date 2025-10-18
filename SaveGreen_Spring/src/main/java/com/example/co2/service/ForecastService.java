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

@Slf4j // [ADD]
@Service
public class ForecastService {

    @Value("${app.cache.ttl-minutes:10}")
    private int ttlMinutes;

    // FE와 동일 파라미터(더미 생성 기준)
    private static final long   BASE_KWH      = 2_150_000L; // 첫 해 after
    private static final double AFTER_RATE    = 0.06;       // 매년 6% 감소
    private static final long   START_SAVING  = 360_000L;   // 첫 해 saving(kWh)
    private static final double SAVING_RATE   = 0.08;       // 매년 8% 감소
    private static final long   UNIT_PRICE    = 150L;       // 원/kWh (cost.saving 산출)
    private static final long   DEFAULT_RETROFIT_COST_WON = 90_000_000L; // payback 계산용

    private final ApiCacheRepository apiCacheRepository;
    private final ObjectMapper objectMapper;

    public ForecastService(ApiCacheRepository apiCacheRepository, ObjectMapper objectMapper) {
        this.apiCacheRepository = apiCacheRepository;
        this.objectMapper = objectMapper;
    }

    /** 컨트롤러에서 호출되는 공개 메서드 */
    public ForecastResponse forecast(Long buildingId, int fromYear, int toYear, String scenario, Integer builtYear) {
        return forecast(buildingId, fromYear, toYear, scenario, builtYear, null, null, null);
    }

    // [ADD] 확장 오버로드: use, floorArea, pnu 포함
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

        // 4) 계산 (지금은 기존 더미/스텁 유지)
        ForecastResponse resp = computeStub(buildingId, from, to, builtYear);

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

    /** 더미 생성 + KPI 계산 (FE 파라미터와 동일) */
    private ForecastResponse computeStub(Long buildingId, int from, int to, Integer builtYear) {
        int len = (to - from) + 1;

        // years
        List<String> years = new ArrayList<>(len);
        for (int y = from; y <= to; y++) years.add(String.valueOf(y));

        // series.after / series.saving
        List<Long> after = new ArrayList<>(len);
        List<Long> saving = new ArrayList<>(len);
        for (int i = 0; i < len; i++) {
            long afterVal  = Math.max(0, Math.round(BASE_KWH * Math.pow(1 - AFTER_RATE, i)));
            long savingVal = Math.max(0, Math.round(START_SAVING * Math.pow(1 - SAVING_RATE, i)));
            after.add(afterVal);
            saving.add(savingVal);
        }

        // cost.saving (원/년)
        List<Long> costSaving = new ArrayList<>(len);
        for (int i = 0; i < len; i++) {
            costSaving.add(saving.get(i) * UNIT_PRICE);
        }

        // KPI: 마지막 연도 기준
        int last = len - 1;
        long repSavingKwh  = saving.get(last);
        long repSavingCost = costSaving.get(last);

        double pct = 0.0;
        long lastAfter = after.get(last);
        if (repSavingKwh + lastAfter > 0) {
            pct = (repSavingKwh * 100.0) / (repSavingKwh + lastAfter);
        }
        int savingPctInt = (int) Math.round(pct); // 정수 % (FE와 호환)

        double paybackYears = repSavingCost > 0
                ? (double) DEFAULT_RETROFIT_COST_WON / (double) repSavingCost
                : Double.POSITIVE_INFINITY;
        paybackYears = Math.round(paybackYears * 100.0) / 100.0; // 소수 2자리

        // === FE와 동일한 점수 / 라벨 계산(연식 미상 -> 중립 1점) ===
        int score = computeStatusScore(pct, paybackYears, builtYear);
        String label = decideLabelByScore(pct, paybackYears, builtYear);
        // 확인용 로그
        log.info(
                "[forecast] score = {}, label = {}, builtYear = {}, age = {}, savingPct = {}%, payback = {}y",
                score,
                label,
                (builtYear == null ? "na" : String.valueOf(builtYear)),
                (builtYear == null ? "na" : String.valueOf(Year.now().getValue() - builtYear)),
                String.format("%.1f", pct),
                String.format("%.2f", paybackYears)
        );

        Series series = new Series(after, saving); // Series(after, saving)
        Cost cost = new Cost(costSaving);          // Cost(saving)
        Kpi kpi = new Kpi(repSavingKwh, repSavingCost, savingPctInt, paybackYears);

        return new ForecastResponse(years, series, cost, kpi);
    }

    public ForecastResponse forecast(Long buildingId, int fromYear, int toYear, String scenario) {
        return forecast(buildingId, fromYear, toYear, scenario, null);
    }

    /* FE와 동일한 점수 계산(가드 포함)*/
    private int computeStatusScore(double savingPct, double paybackYears, Integer builtYear) {
        // 가드 : 원치 않는 과대 판정 금지
        if (savingPct < 5.0 || paybackYears > 12.0) return 0;

        int score = 0;

        // 1. 절감률
        if (savingPct >= 15.0) score += 2;
        else if (savingPct >= 10.0) score += 1;

        // 2. 회수기간
        if (paybackYears <= 5.0) score += 2;
        else if (paybackYears <= 8.0) score += 1;

        // 3. 연식(없으면 중립 1점)
        int agePt = 1;
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

    /* FE와 동일한 판정 라벨(점수 기반) */
    private String decideLabelByScore(double savingPct, double paybackYears, Integer builtYear) {
        // 가드 우선
        if (savingPct < 5.0 || paybackYears > 12.0) return "NOT_RECOMMEND";

        int score = computeStatusScore(savingPct, paybackYears, builtYear);
        if (score >= 4) return "RECOMMEND";
        if (score >= 2) return "CONDITIONAL";
        return "NOT_RECOMMEND";
    }
}
