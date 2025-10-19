// src/main/java/com/example/co2/dto/PredictDtos.java
// ============================================================================
// SaveGreen / 예측 DTO 묶음  (데모 스코프: 4종 type, region=daejeon 고정)
// ----------------------------------------------------------------------------
// [클래스]
// - MonthPoint: 월별 전력(kWh)
// - YearPoint : 연별 전력(kWh)
// - ForecastRawRequest: FE 원시 입력(raw) — 컨트롤러에서 표준화.
// - PredictRequest:     FastAPI로 넘기는 표준화 후 입력.
// - PredictResponse:    FastAPI 결과(차트/KPI 바인딩용).
//
// [스코프 합의]
// - type: factory | hospital | school | office (4개 고정)
// - region: daejeon (고정; normalizer에서 강제 설정)
// ============================================================================

package com.example.co2.dto;

import lombok.*;
import java.util.List;

public class PredictDtos {

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor
    public static class MonthPoint {
        private int month;            // 1~12
        private double electricity;   // kWh
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor
    public static class YearPoint {
        private int year;             // 예: 2018
        private double electricity;   // kWh
    }

    // FE → 서버: 원시(raw)
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class ForecastRawRequest {
        private String typeRaw;                       // "공장/병원/학교/사무…" 등 자유 텍스트
        private String regionRaw;                     // 어떤 값이 와도 demo에선 무시됨
        private Integer builtYear;
        private Double floorAreaM2;
        private List<MonthPoint> monthlyConsumption;
        private List<YearPoint>  yearlyConsumption;
    }

    // 서버 → FastAPI: 표준화 후(4종 type + region=daejeon)
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class PredictRequest {
        private String type;                          // factory | hospital | school | office
        private String region;                        // "daejeon" 고정
        private Integer builtYear;
        private Double floorAreaM2;
        private List<MonthPoint> monthlyConsumption;
        private List<YearPoint>  yearlyConsumption;
    }

    // FastAPI → 서버/FE: 결과
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class PredictResponse {
        private double savingKwhYr;
        private double savingCostYr;
        private double savingPct;
        private double paybackYears;
        private String label;          // RECOMMEND | CONDITIONAL | NOT_RECOMMEND
    }
}
