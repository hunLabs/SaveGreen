package com.example.co2.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.co2.service.MailService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
public class MailController {

    private final MailService mailService;

    @PostMapping("/sendMail")
    public ResponseEntity<String> sendMail(@RequestParam("email") String email,
                                           @RequestParam("file") MultipartFile file) {
        try {
            mailService.sendSimulatorMail(email, file);
            return ResponseEntity.ok("메일 전송 완료");
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(500).body("메일 전송 실패");
        }
    }
}
