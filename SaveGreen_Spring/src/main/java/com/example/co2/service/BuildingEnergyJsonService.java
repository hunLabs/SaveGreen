package com.example.co2.service;

import com.example.co2.dto.SearchBuilding;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.List;

@Service
@RequiredArgsConstructor
public class BuildingEnergyJsonService {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private static final String ENERGY_JSON_PATH = "static/dummy/buildingenergydata.json";

   
    public List<SearchBuilding> readAll() {
        try (InputStream is = new ClassPathResource(ENERGY_JSON_PATH).getInputStream()) {
            return objectMapper.readValue(is, new TypeReference<List<SearchBuilding>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("buildingenergydata 로드 실패: " + ENERGY_JSON_PATH, e);
        }
    }

   
    public Double avgIntensityByCategory(String category) {
        if (category == null) return null;

        List<SearchBuilding> list = readAll();
        double sum = 0.0;
        int count = 0;

        for (SearchBuilding b : list) {
            if (b == null) continue;
            String cat = b.getBuildingType2();
            if (cat == null) continue;
            if (!cat.trim().equals(category.trim())) continue;

            Double inten = b.getEnergyIntensityKwhPerM2();
            if (inten == null) continue;

            sum += inten;
            count++;
        }
        if (count == 0) return null;
        return sum / count;
    }
}
