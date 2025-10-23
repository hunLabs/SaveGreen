package com.example.co2.controller;

import com.example.co2.dto.AiRequestDto;
import com.example.co2.dto.AiResponseDto;
import com.example.co2.service.OpenAiService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/ai")
public class OpenAiController {

    private final OpenAiService openAiService;

    public OpenAiController(OpenAiService openAiService) {
        this.openAiService = openAiService;
    }

    @PostMapping("/ask")
    public AiResponseDto ask(@RequestBody AiRequestDto dto) {
        String answer = openAiService.callAi(dto.getPrompt());

        AiResponseDto response = new AiResponseDto();
        response.setReply(answer);
        return response;
    }
}

