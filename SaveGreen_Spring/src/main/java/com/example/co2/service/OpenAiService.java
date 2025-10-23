package com.example.co2.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.core5.http.io.entity.StringEntity;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

@Service
public class OpenAiService {

    @Value("${openai.api.key}")
    private String apiKey;
    
    public String callAi(String prompt) {
    String url = "https://api.openai.com/v1/chat/completions";

    try (CloseableHttpClient client = HttpClients.createDefault()) {
        HttpPost post = new HttpPost(url);
        post.setHeader("Content-Type", "application/json");
        post.setHeader("Authorization", "Bearer " + apiKey);

       
        ObjectMapper mapper = new ObjectMapper();

        ObjectNode rootNode = mapper.createObjectNode();
        rootNode.put("model", "gpt-4o-mini");

        ArrayNode messages = mapper.createArrayNode();
        ObjectNode userMsg = mapper.createObjectNode();
        userMsg.put("role", "user");
        userMsg.put("content", prompt);
        messages.add(userMsg);

        rootNode.set("messages", messages);

        
        String jsonBody = mapper.writeValueAsString(rootNode);

        post.setEntity(new StringEntity(jsonBody, StandardCharsets.UTF_8));
        var response = client.execute(post);

        BufferedReader reader = new BufferedReader(
                new InputStreamReader(response.getEntity().getContent(), "UTF-8")
        );

        StringBuilder result = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            result.append(line);
        }

        System.out.println("Response:\n" + result.toString());

        JsonNode root = mapper.readTree(result.toString());

     
        if (root.has("error")) {
            String errorMsg = root.path("error").path("message").asText();
            return "오류 발생: " + errorMsg;
        }

        JsonNode choices = root.path("choices");
        if (choices.isArray() && choices.size() > 0) {
            return choices.get(0).path("message").path("content").asText();
        } else {
            return "GPT 응답 형식 오류: " + result;
        }

    } catch (Exception e) {
        e.printStackTrace();
        return "오류 발생: " + e.getMessage();
    }
}

    }

