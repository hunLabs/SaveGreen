package com.example.co2.api;

import com.example.co2.dto.ForecastDtos.ForecastResponse;
import com.example.co2.service.ForecastService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

/**
 * /api/forecast 엔드포인트
 * - /api/forecast            : buildingId 없이 (from/to + (builtYear>0 또는 pnu) 필요)
 * - /api/forecast/{id}       : buildingId 경로변수 사용
 *
 * 공통 규칙
 *  - 기본 구간: 현재년도(now) ~ now+10 (포함)
 *  - from/to가 같으면 now 기준으로 +10년 확장
 *  - to < from 이면 스왑
 *  - builtYear <= 0 이면 무시(null)
 *  - (no-id 엔드포인트만) 컨텍스트 없으면 400
 */
@RestController
@RequiredArgsConstructor
public class ForecastApiController {

    private static final int HORIZON_YEARS = 10;

    private final ForecastService forecastService;

    /** id 없음: /api/forecast?from=YYYY&to=YYYY&scenario=default&builtYear=2011&use=...&floorArea=...&pnu=... */
    @GetMapping("/api/forecast")
    public ResponseEntity<ForecastResponse> getForecastNoId(
            @RequestParam(required = false) Integer from,
            @RequestParam(required = false) Integer to,
            @RequestParam(required = false, defaultValue = "default") String scenario,
            @RequestParam(required = false) Integer builtYear,
            @RequestParam(required = false) String use,
            @RequestParam(required = false) Double floorArea,
            @RequestParam(required = false) String pnu
    ) {
        int now = LocalDate.now().getYear();

        int yyFrom = (from != null) ? from : now;
        int yyTo   = (to   != null) ? to   : (yyFrom + HORIZON_YEARS);

        // 범위 보정
        if (yyTo < yyFrom) { int t = yyFrom; yyFrom = yyTo; yyTo = t; }
        if (yyTo == yyFrom) yyTo = yyFrom + HORIZON_YEARS;

        // builtYear 정규화(0/음수 무시)
        Integer by = (builtYear != null && builtYear > 0) ? builtYear : null;

        // ✅ 컨텍스트 가드: builtYear(양수) 또는 pnu 둘 중 하나라도 있어야 함
        boolean hasKey = (by != null) || nonEmpty(pnu);
        if (!hasKey) {
            return ResponseEntity.badRequest().build();
        }

        ForecastResponse res = forecastService.forecast(
                null,          // buildingId 없음
                yyFrom, yyTo,
                scenario,
                by,
                use,
                floorArea,
                pnu
        );
        return ResponseEntity.ok(res);
    }

    /** id 버전: /api/forecast/{id}?from=YYYY&to=YYYY&scenario=...&builtYear=...&use=...&floorArea=...&pnu=... */
    @GetMapping("/api/forecast/{id}")
    public ResponseEntity<ForecastResponse> getForecastById(
            @PathVariable("id") Long buildingId,
            @RequestParam(required = false) Integer from,
            @RequestParam(required = false) Integer to,
            @RequestParam(required = false, defaultValue = "default") String scenario,
            @RequestParam(required = false) Integer builtYear,
            @RequestParam(required = false) String use,
            @RequestParam(required = false) Double floorArea,
            @RequestParam(required = false) String pnu
    ) {
        int now = LocalDate.now().getYear();

        int yyFrom = (from != null) ? from : now;
        int yyTo   = (to   != null) ? to   : (yyFrom + HORIZON_YEARS);

        // 범위 보정
        if (yyTo < yyFrom) { int t = yyFrom; yyFrom = yyTo; yyTo = t; }
        if (yyTo == yyFrom) yyTo = yyFrom + HORIZON_YEARS;

        Integer by = (builtYear != null && builtYear > 0) ? builtYear : null;

        ForecastResponse res = forecastService.forecast(
                buildingId,
                yyFrom, yyTo,
                scenario,
                by,
                use,
                floorArea,
                pnu
        );
        return ResponseEntity.ok(res);
    }

    /* ---------- helpers ---------- */
    private static boolean nonEmpty(String s) {
        return s != null && !s.trim().isEmpty();
    }
}
