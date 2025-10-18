package com.example.co2.controller;

import com.example.co2.service.BuildingEnergyJsonService;
import lombok.RequiredArgsConstructor;
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
}
