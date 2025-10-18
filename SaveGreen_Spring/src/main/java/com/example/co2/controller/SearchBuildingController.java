package com.example.co2.controller;

import com.example.co2.dto.SearchBuilding;
import com.example.co2.service.SearchBuildingJsonService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;



@RestController
@RequiredArgsConstructor
@RequestMapping("/simulator")
public class SearchBuildingController {

    private final SearchBuildingJsonService searchBuildingJsonService;

    @GetMapping("/{pnu}")
    public ResponseEntity<?> getByPnu(@PathVariable String pnu) {
        SearchBuilding found = searchBuildingJsonService.findByPnu(pnu);
        if (found==null) {
            return ResponseEntity.status(404).body("[에너지데이터없음]"); // 이번 단계 정책에 맞춘 문구
        }
        return ResponseEntity.ok(found);
    }
}
