package com.example.co2.controller;

import com.example.co2.service.BuildingEnergyJsonService;
import lombok.RequiredArgsConstructor;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;


@RestController
@RequiredArgsConstructor
@RequestMapping("/energy")
public class BuildingEnergyController {

    private final BuildingEnergyJsonService buildingEnergyJsonService;

    
    @GetMapping("/avg-intensity")
    public ResponseEntity<?> avgIntensity(@RequestParam String category) {
        Double avg = buildingEnergyJsonService.avgIntensityByCategory(category);
        if (avg == null) {
            return ResponseEntity.status(404).body("[에너지데이터없음]");
        }
        return ResponseEntity.ok(avg);
    }
    @GetMapping("/percentile")
    public ResponseEntity<Double> getPercentile(
        @RequestParam String category,
        @RequestParam double value) {

    Double percentile = buildingEnergyJsonService.percentileByCategory(category, value);
    if (percentile == null) return ResponseEntity.noContent().build();

    return ResponseEntity.ok(percentile);
    }
    @GetMapping("/monthly-percent/category")
    public ResponseEntity<List<Double>> getMonthlyPercent(@RequestParam String category) {
        List<Double> percents = buildingEnergyJsonService.getMonthlyPercentByCategory(category);
        return ResponseEntity.ok(percents);
    }

    
}
