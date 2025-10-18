package com.example.co2.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class MainController {

    @GetMapping("/main")
    public String main() {
        return "layouts/index"; // templates/index.html 렌더링
    }
    
}
