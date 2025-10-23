package com.example.co2.service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;


import com.example.co2.dto.AddressDto;

import java.util.List;
import java.util.Map;

@Service
public class GreenFinderService {
  
    private static final String CONFIRM_KEY = "devU01TX0FVVEgyMDI1MTAwMTEwMjQyMTExNjI5NjQ="; // 발급받은 키
    private final RestTemplate restTemplate = new RestTemplate();

    public List<AddressDto> searchAddress(String keyword) {

        List<AddressDto> results = new ArrayList<>();
        try {
            //String encodedKeyword = URLEncoder.encode(keyword, StandardCharsets.UTF_8);
            String url="https://www.juso.go.kr/addrlink/addrLinkApi.do?currentPage=1" +
                "&countPerPage=5" +
                "&keyword=" + keyword +
                "&confmKey=devU01TX0FVVEgyMDI1MTAwMTEwMjQyMTExNjI5NjQ=" +
                "&resultType=json";

            Map<String, Object> response = restTemplate.getForObject(url, Map.class);
            if (response == null) return results;

            Map<String, Object> resultsMap = (Map<String, Object>) response.get("results");
            if (resultsMap == null) return results;

            List<Map<String, String>> jusoList = (List<Map<String, String>>) resultsMap.get("juso");
            if (jusoList == null) return results;

            
            for (Map<String, String> juso : jusoList) {
                AddressDto dto = new AddressDto();
                dto.setRoadAddr(juso.get("roadAddr"));
                dto.setJibunAddr(juso.get("jibunAddr"));
                dto.setZipNo(juso.get("zipNo"));
                results.add(dto);
            }

            System.out.println("Juso API Response: " + response);

        } catch (Exception e) {
            e.printStackTrace();
        }
        return results;
    }
}
