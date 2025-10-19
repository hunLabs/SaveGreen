// src/main/java/com/example/co2/api/ForecastMlController.java
// ============================================================================
// SaveGreen / ForecastMlController
// ----------------------------------------------------------------------------
// [역할 요약]
// - FE에서 오는 "원시 입력(raw)"을 받는다 → 서버 단일 규칙으로 표준화한다.
// - 표준화된 입력을 MlBridgeService로 넘겨 FastAPI(/predict) 호출.
// - 결과(PredictResponse)를 FE로 그대로 반환한다.
//
// [설계 포인트]
// - 컨트롤러는 "표준화 + 브릿지 호출"까지만 담당하고, 비즈니스 로직/룰은 서비스/유틸로 분리.
// - 요약 로그를 남겨 운영/디버깅 시 현황 파악을 쉽게 한다.
// - 입력 유효성 검사는 단계적으로 강화(초기엔 느슨하게, 운영 고도화 시 @Valid 검토).
// ============================================================================

package com.example.co2.api;

import com.example.co2.dto.PredictDtos.*;
import com.example.co2.service.MlBridgeService;
import com.example.co2.util.TypeRegionNormalizer;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/forecast")
@RequiredArgsConstructor
public class ForecastMlController {

    private final MlBridgeService mlBridgeService;
    // 규칙은 유틸 클래스로 분리(테스트/버전 관리 편의)
    private final TypeRegionNormalizer normalizer = new TypeRegionNormalizer();

    /**
     * FE → POST /api/forecast/ml
     * - 입력(raw)을 표준화(type/region)한 뒤, FastAPI에 전달한다.
     * - 응답을 그대로 FE에 반환한다.
     */
    @PostMapping(
            value = "/ml",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public PredictResponse forecast(@RequestBody ForecastRawRequest raw) {

        // 1) 서버 단일 규칙으로 표준화(오탈자/다국어/동의어를 내부 taxonomy로 치환)
        String typeNorm = normalizer.normalizeType(raw.getTypeRaw());
        String regionNorm = normalizer.normalizeRegion(raw.getRegionRaw());

        // 2) FastAPI 계약에 맞는 DTO(PredictRequest)로 변환
        PredictRequest req = PredictRequest.builder()
                .type(typeNorm)
                .region(regionNorm)
                .builtYear(raw.getBuiltYear())
                .floorAreaM2(raw.getFloorAreaM2())
                .monthlyConsumption(raw.getMonthlyConsumption())
                .yearlyConsumption(raw.getYearlyConsumption())
                .build();

        // 3) /predict 호출(타임아웃/에러 시 폴백 내부 처리)
        PredictResponse resp = mlBridgeService.predict(req);

        // 4) 운영/디버깅용 요약 로그
        System.out.printf(
                "[ML] norm=%s/%s floor=%.1f built=%s -> label=%s pct=%.2f payback=%.2f%n",
                typeNorm,
                regionNorm,
                req.getFloorAreaM2() == null ? 0.0 : req.getFloorAreaM2(),
                req.getBuiltYear(),
                resp.getLabel(),
                resp.getSavingPct(),
                resp.getPaybackYears()
        );

        // 5) FE로 그대로 반환(KPI/차트 렌더에 사용)
        return resp;
    }
}
