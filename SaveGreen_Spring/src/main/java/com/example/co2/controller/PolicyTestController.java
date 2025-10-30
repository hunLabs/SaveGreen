package com.example.co2.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/policy/test")
public class PolicyTestController {
     @GetMapping("/auto-upload")
    public String autoUploadPage() {
        return "html/auto-upload";
    }
}
