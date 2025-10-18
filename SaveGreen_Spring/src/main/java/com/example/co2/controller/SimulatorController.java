package com.example.co2.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import com.example.co2.dto.SimulatorDto;
import com.example.co2.dto.SimulatorResultDto;
import com.example.co2.service.SimulatorService;

@Controller
public class SimulatorController {
    @GetMapping("/simulator")
    public String simulator() {
        return "html/simulator"; // templates/simulator.html 렌더링
    }
    @Autowired  
    private SimulatorService simulatorService;

    @PostMapping("/simulate1")
    @ResponseBody
    public SimulatorResultDto simulate1(@ModelAttribute SimulatorDto dto) throws Exception { 
        
        return simulatorService.calculate1(dto);
    }

    @PostMapping("/simulate2")
    @ResponseBody
    public SimulatorResultDto simulate2(@ModelAttribute SimulatorDto dto) throws Exception { 
        
        return simulatorService.calculate2(dto);
    }
    

    @ResponseBody
    @GetMapping("/search")
    public List<SimulatorDto> search(@RequestParam String keyword) throws Exception {
        try {
        return simulatorService.searchAddress(keyword);
    } catch (Exception e) {
        System.err.println("주소 검색 중 오류 발생: " + e.getMessage());
        return java.util.Collections.emptyList();  
    }
    }
}



    
