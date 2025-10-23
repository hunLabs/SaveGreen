package com.example.co2.controller;

import org.springframework.stereotype.Controller;

import com.example.co2.dto.AddressDto;
import com.example.co2.service.GreenFinderService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.List;

@CrossOrigin
@Controller
public class GreenFinderController {
/**dddddgit */
    private final GreenFinderService greenFinderService;

    public GreenFinderController(GreenFinderService greenFinderService) {
        this.greenFinderService = greenFinderService;
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



}