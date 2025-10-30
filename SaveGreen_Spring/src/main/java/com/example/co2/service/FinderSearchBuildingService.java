package com.example.co2.service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import com.example.co2.dto.SearchBuilding;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;

    @Service
    @RequiredArgsConstructor
    public class FinderSearchBuildingService {
        private final ObjectMapper objectMapper = new ObjectMapper();
        private static final String SEARCH_JSON_PATH = "static/dummy/searchbuildingdata.json";

        public List<SearchBuilding> readAll() {
        try (InputStream is = new ClassPathResource(SEARCH_JSON_PATH).getInputStream()) {
            System.out.println("JSON 파일 로드 시도: " + SEARCH_JSON_PATH);
            List<SearchBuilding> data = objectMapper.readValue(is, new TypeReference<List<SearchBuilding>>() {});
            System.out.println("JSON 데이터 개수: " + data.size());
            return data;
        } catch (Exception e) {
            e.printStackTrace();
            throw new IllegalStateException("searchbuildingdata 로드 실패 : " + SEARCH_JSON_PATH, e);
        }
        
    }

    public SearchBuilding findByPnu(String pnu){

        if (pnu == null) return null;
        try {
            List<SearchBuilding> list = readAll();
            System.out.println("JSON 로드 성공, 데이터 수: " + list.size());
            String target = pnu.trim();

            for (SearchBuilding b : list) {
                if (b == null || b.getPnu() == null) continue;
                if (b.getPnu().trim().equals(target)) {
                    System.out.println("매칭된 PNU: " + target);
                    return b;
                }
            }
            System.out.println("매칭 실패: " + target);
            return null;
        } catch (Exception e) {
            e.printStackTrace(); 
            throw e;
        }
            
    }

    public List<Double> getMonthlyPercentByBuilding(String pnu) {
        List<SearchBuilding> list = readAll();

        for (SearchBuilding b : list) {
            if (b == null) continue;
            if (b.getPnu() == null) continue;
            if (!b.getPnu().equals(pnu)) continue;
            if (b.getMonthlyConsumption() == null) continue;

            double total = b.getMonthlyConsumption().stream()
                    .mapToDouble(m -> m.getElectricity())
                    .sum();

            List<Double> percents = new ArrayList<>();
            for (var m : b.getMonthlyConsumption()) {
                double pct = (m.getElectricity() / total) * 100.0;
                percents.add(pct);
            }

            return percents; 
        }

        return Collections.emptyList(); 
    }   
}
