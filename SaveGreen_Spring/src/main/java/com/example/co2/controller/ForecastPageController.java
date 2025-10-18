package com.example.co2.controller; // [수정] 기존: com.example.co2.page

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import lombok.extern.slf4j.Slf4j;
// 동적 기본 연도 계산(현재년 ~ 현재년+10)을 위한 import
import java.time.Year;			// [추가]
import java.time.ZoneId;			// [추가]

/**
 * Forecast 페이지 라우트 컨트롤러
 * - /forecast           : id 없이 열기(더미/시나리오 모드 허용)
 * - /forecast/{id}      : 특정 id로 열기
 *
 * 기본 연도(from/to): 파라미터 없을 시 "현재년도 ~ 현재년도+10"
 * 타임존: Asia/Seoul
 */
@Slf4j
@Controller
@RequestMapping("/forecast") // 페이지 prefix 고정
public class ForecastPageController {

    // /forecast : id 없이 열기 = 더미/시나리오 모드
    @GetMapping({"", "/"})
    public String viewNoId(
            @RequestParam(required = false) Integer from,			// [수정] defaultValue 제거(동적 기본값 계산)
            @RequestParam(required = false) Integer to,				// [수정] defaultValue 제거(동적 기본값 계산)
            @RequestParam(required = false) Integer builtYear,
            @RequestParam(required = false) String pnu,
            @RequestParam(required = false) String useName,
            @RequestParam(required = false) Double area,
            @RequestParam(required = false) Double plotArea,
            @RequestParam(required = false) Integer floorsAbove,
            @RequestParam(required = false) Integer floorsBelow,
            @RequestParam(required = false) Double height,
            @RequestParam(required = false) String approvalDate,
            @RequestParam(required = false) String buildingName,
            @RequestParam(required = false) String dongName,
            @RequestParam(required = false) String buildingIdent,
            @RequestParam(required = false) String lotSerial,
            Model model
    ) {
        // 동적 기본값 계산: 현재년도 ~ 현재년도+10
        final int fromYr = (from != null) ? from : Year.now(ZoneId.of("Asia/Seoul")).getValue();	// [추가]
        final int toYr   = (to   != null) ? to   : fromYr + 10;									// [추가]

        // id 없음 → 빈 문자열로 내려서 data-bid=""
        model.addAttribute("buildingId", "");
        model.addAttribute("fromYear", fromYr);		// [수정]
        model.addAttribute("toYear", toYr);			// [수정]
        model.addAttribute("builtYear", builtYear); // null이면 그대로 둠

        // 항상 내려서 템플릿의 data-bname 안정화 (없으면 빈 문자열)
        model.addAttribute("buildingName", (buildingName == null || buildingName.isBlank()) ? "" : buildingName); // [수정]

        if (pnu != null && !pnu.isBlank())                      model.addAttribute("pnu", pnu);
        if (useName != null && !useName.isBlank())              model.addAttribute("useName", useName);
        if (area != null && area > 0)                           model.addAttribute("area", area);
        if (plotArea != null && plotArea > 0)                   model.addAttribute("plotArea", plotArea);
        if (floorsAbove != null && floorsAbove >= 0)            model.addAttribute("floorsAbove", floorsAbove);
        if (floorsBelow != null && floorsBelow >= 0)            model.addAttribute("floorsBelow", floorsBelow);
        if (height != null && height > 0)                       model.addAttribute("height", height);
        if (approvalDate != null && !approvalDate.isBlank())    model.addAttribute("approvalDate", approvalDate);
        if (dongName != null && !dongName.isBlank())            model.addAttribute("dongName", dongName);
        if (buildingIdent != null && !buildingIdent.isBlank())  model.addAttribute("buildingIdent", buildingIdent);
        if (lotSerial != null && !lotSerial.isBlank())          model.addAttribute("lotSerial", lotSerial);

        return "html/forecast"; // templates/html/forecast.html
    }

    // /forecast/{id} : id로 열기
    @GetMapping("/{id}")
    public String viewWithId(
            @PathVariable Long id,
            @RequestParam(required = false) Integer from,			// [수정] defaultValue 제거(동적 기본값 계산)
            @RequestParam(required = false) Integer to,				// [수정] defaultValue 제거(동적 기본값 계산)
            @RequestParam(required = false) Integer builtYear,
            @RequestParam(required = false) String pnu,
            @RequestParam(required = false) String useName,
            @RequestParam(required = false) Double area,
            @RequestParam(required = false) Double plotArea,
            @RequestParam(required = false) Integer floorsAbove,
            @RequestParam(required = false) Integer floorsBelow,
            @RequestParam(required = false) Double height,
            @RequestParam(required = false) String approvalDate,
            @RequestParam(required = false) String buildingName,
            @RequestParam(required = false) String dongName,
            @RequestParam(required = false) String buildingIdent,
            @RequestParam(required = false) String lotSerial,
            Model model
    ) {
        // 동적 기본값 계산: 현재년도 ~ 현재년도+10
        final int fromYr = (from != null) ? from : Year.now(ZoneId.of("Asia/Seoul")).getValue();	// [추가]
        final int toYr   = (to   != null) ? to   : fromYr + 10;									// [추가]

        log.info("PAGE /forecast id = {}, builtYear = {}, pnu = {}", id, builtYear, pnu);
        model.addAttribute("buildingId", id); // 숫자 그대로
        model.addAttribute("fromYear", fromYr);	// [수정]
        model.addAttribute("toYear", toYr);		// [수정]
        model.addAttribute("builtYear", builtYear);

        // 항상 내려서 템플릿의 data-bname 안정화 (없으면 빈 문자열)
        model.addAttribute("buildingName", (buildingName == null || buildingName.isBlank()) ? "" : buildingName); // [수정]

        if (pnu != null && !pnu.isBlank())                      model.addAttribute("pnu", pnu);
        if (useName != null && !useName.isBlank())              model.addAttribute("useName", useName);
        if (area != null && area > 0)                           model.addAttribute("area", area);
        if (plotArea != null && plotArea > 0)                   model.addAttribute("plotArea", plotArea);
        if (floorsAbove != null && floorsAbove >= 0)            model.addAttribute("floorsAbove", floorsAbove);
        if (floorsBelow != null && floorsBelow >= 0)            model.addAttribute("floorsBelow", floorsBelow);
        if (height != null && height > 0)                       model.addAttribute("height", height);
        if (approvalDate != null && !approvalDate.isBlank())    model.addAttribute("approvalDate", approvalDate);
        if (dongName != null && !dongName.isBlank())            model.addAttribute("dongName", dongName);
        if (buildingIdent != null && !buildingIdent.isBlank())  model.addAttribute("buildingIdent", buildingIdent);
        if (lotSerial != null && !lotSerial.isBlank())          model.addAttribute("lotSerial", lotSerial);
        return "html/forecast";
    }
}
