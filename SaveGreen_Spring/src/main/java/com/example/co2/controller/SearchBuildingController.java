package com.example.co2.controller;

import com.example.co2.dto.SearchBuilding;
import com.example.co2.service.SearchBuildingJsonService;
import lombok.RequiredArgsConstructor;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;



@RestController
@RequiredArgsConstructor
@RequestMapping
public class SearchBuildingController {

    private final SearchBuildingJsonService searchBuildingJsonService;

    @GetMapping("/simulator/{pnu}")
    public ResponseEntity<?> getByPnu(@PathVariable String pnu) {
        SearchBuilding found = searchBuildingJsonService.findByPnu(pnu);
        if (found==null) {
            return ResponseEntity.status(404).body("[에너지데이터없음]"); 
        }
        return ResponseEntity.ok(found);
    }
    @GetMapping("/energy/monthly-percent/pnu")
    public ResponseEntity<List<Double>> getMonthlyPercentByBuilding(@RequestParam String pnu) {
        List<Double> percents = searchBuildingJsonService.getMonthlyPercentByBuilding(pnu);
        return ResponseEntity.ok(percents);
}
}
