package com.example.co2.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;



@Controller
public class GreenFinderController {

    @GetMapping("/GreenFinder")
    public String getServicePage() {
        return "html/GreenFinderMap";
        
    }

    @GetMapping("/GreenFinder/text")
    public String getTextPage() {
        return "html/serviceText";
        
    }
    
    
}
