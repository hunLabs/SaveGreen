package com.example.co2.service;

import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class MailService {

    private final JavaMailSender mailSender;

    
    @SuppressWarnings("null")
    public void sendSimulatorMail(String toEmail, MultipartFile file) throws Exception {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

        helper.setTo(toEmail);
        helper.setSubject("SaveGreen 시뮬레이터 결과 PDF");
        helper.setText("시뮬레이터 결과 파일을 첨부드립니다.");

        helper.addAttachment(file.getOriginalFilename(), file);
        mailSender.send(message);
    }
}
