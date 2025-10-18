package com.example.co2.dto;

import java.util.List;

public class ForecastDtos {

    /** 최종 응답 스키마 (FE가 사용하는 핵심만) */
    public record ForecastResponse(
            List<String> years,
            Series series,
            Cost cost,
            Kpi kpi
    ) {}

    /** 에너지(kWh/년) 시리즈 */
    public record Series(
            List<Long> after,
            List<Long> saving
    ) {}

    /** 비용(원/년) 시리즈 - 절감액만 사용 */
    public record Cost(
            List<Long> saving
    ) {}

    /** KPI 지표 */
    public record Kpi(
            long    savingKwhYr,   // 대표 절감 kWh/년 (마지막 연도)
            long    savingCostYr,  // 대표 절감 원/년 (마지막 연도)
            Integer savingPct,     // 절감률 % (정수, 없으면 FE 계산 가능)
            double  paybackYears   // 회수기간(년)
    ) {}
}
