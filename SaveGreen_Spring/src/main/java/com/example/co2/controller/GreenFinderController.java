package com.example.co2.controller;

import org.springframework.stereotype.Controller;

import com.example.co2.dto.AddressDto;
import com.example.co2.dto.SearchBuilding;
import com.example.co2.service.FinderSearchBuildingService;
import com.example.co2.service.GreenFinderService;
import com.example.co2.service.SearchBuildingJsonService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.List;

@CrossOrigin
@Controller
public class GreenFinderController {
    /** dddddgit */
    private final GreenFinderService greenFinderService;

    private final FinderSearchBuildingService finderSearchBuildingService; // dummy data service

    public GreenFinderController(GreenFinderService greenFinderService,
            FinderSearchBuildingService finderSearchBuildingService) {
        this.greenFinderService = greenFinderService;
        this.finderSearchBuildingService = finderSearchBuildingService;
    }

    @GetMapping("/GreenFinder")
    public String getServicePage() {
        return "html/GreenFinderMap";
    }

    @GetMapping("/GreenFinder/text")
    public String getTextPage() {
        return "html/serviceText";
    }

    @GetMapping("/GreenFinder/search")
    @ResponseBody
    public ResponseEntity<List<AddressDto>> search(@RequestParam("keyword") String keyword) {
        List<AddressDto> result = greenFinderService.searchAddress(keyword);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/GreenFinder/energyCheck")
    public String getGreenCheck() {
        return "html/energyUseCheck";
    }

    @GetMapping("/GreenFinder/energyCheck/{pnu}")
    @ResponseBody
    public ResponseEntity<?> getByPnu(@PathVariable("pnu") String pnu) {
        System.out.println("pnu = " + pnu);
        try {
            SearchBuilding found = finderSearchBuildingService.findByPnu(pnu);
            if (found == null) {
                return ResponseEntity.status(404).body("[에너지데이터없음]");
            }
            return ResponseEntity.ok(found);
        } catch (Exception e) {
            e.printStackTrace(); // 콘솔에 정확한 에러 로그 출력
            return ResponseEntity.status(500).body("서버 내부 오류: " + e.getMessage());
        }
    }

}