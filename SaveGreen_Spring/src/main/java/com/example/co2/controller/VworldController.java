package com.example.co2.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.example.co2.dto.SimulatorDto;
import com.example.co2.service.VworldService;

@RestController
@RequestMapping("/vworld")
public class VworldController { 
    private final VworldService vworldService;

    public VworldController(VworldService vworldService) {
        this.vworldService = vworldService;
    }

    // 주소 검색 (juso API)
    @GetMapping("/search")
    public List<SimulatorDto> search(@RequestParam String keyword) throws Exception {
        return vworldService.getCoordinates(keyword);
    }

    // 좌표 변환 (vWorld API)
    @GetMapping("/coord")
    public ResponseEntity<Map<String, Object>> getCoord(@RequestParam String address) {
        Map<String, Object> result = vworldService.getCoordFromVworld(address);
        return ResponseEntity.ok(result);
    }
}
