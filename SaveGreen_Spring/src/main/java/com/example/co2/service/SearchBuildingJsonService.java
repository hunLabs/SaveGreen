package com.example.co2.service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import com.example.co2.dto.SearchBuilding;
import com.fasterxml.jackson.databind.ObjectMapper;

import com.fasterxml.jackson.core.type.TypeReference;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class SearchBuildingJsonService {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final String SEARCH_JSON_PATH = "static/dummy/searchbuildingdata.json";

    public List<SearchBuilding> readAll(){
        try (InputStream is = new ClassPathResource(SEARCH_JSON_PATH).getInputStream()){
            return objectMapper.readValue(is,new TypeReference<List<SearchBuilding>>() {});
        }catch(Exception e){
            throw new IllegalStateException("searchbuildingdata 로드 실패 : "+ SEARCH_JSON_PATH,e);
        }
    }
    public SearchBuilding findByPnu(String pnu){
       
        if(pnu ==null) return null;

        List<SearchBuilding> list = readAll();
        String target = pnu.trim();

        for (SearchBuilding b : list ){
            String recordPnu = b.getPnu();
            if (recordPnu ==null){ continue;}
            if (recordPnu.trim().equals(target)){
                return b;
            }
        }
        return null;
        
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
