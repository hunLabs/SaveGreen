package com.example.co2.service;

import com.example.co2.dto.SearchBuilding;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
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
    public Double percentileByCategory(String category, double value){
        if(category == null ) return null;

        List<SearchBuilding>list = readAll();
        List<Double> intensities = new ArrayList<>();
        for (SearchBuilding b : list) {
            if (b == null) continue;
            if (b.getBuildingType2() == null) continue;
            if (!b.getBuildingType2().trim().equals(category.trim())) continue;
            if (b.getEnergyIntensityKwhPerM2() == null) continue;
            intensities.add(b.getEnergyIntensityKwhPerM2());
        }
        if (intensities.isEmpty()) return null;

        Collections.sort(intensities);

        int rank = 0;
        for (Double v : intensities) {
            if (v <= value) rank++;
        }

        double percentile = (double) rank / intensities.size() * 100.0;
        percentile = Math.round(percentile * 10) / 10.0;

        if (percentile==100){
            percentile=percentile-1;
        }
        if (percentile==0){
            percentile=percentile+1;
        }

        return percentile;
    }
    public List<Double> getMonthlyPercentByCategory(String category) {
        List<SearchBuilding> list = readAll();
        List<SearchBuilding> filtered = new ArrayList<>();

        for (SearchBuilding b : list) {
            if (b == null || b.getBuildingType2() == null) continue;
            if (b.getMonthlyConsumption() == null) continue;
            if (!b.getBuildingType2().trim().equals(category.trim())) continue;
            filtered.add(b);
        }

        double[] monthSums = new double[12];
        int[] monthCounts = new int[12];

        for (SearchBuilding b : filtered) {
            for (int i = 0; i < b.getMonthlyConsumption().size(); i++) {
                double elec = b.getMonthlyConsumption().get(i).getElectricity();
                int month = b.getMonthlyConsumption().get(i).getMonth();
                monthSums[month - 1] += elec;
                monthCounts[month - 1]++;
            }
        }

        double total = 0;
        for (int i = 0; i < 12; i++) {
            monthSums[i] = monthCounts[i] > 0 ? monthSums[i] / monthCounts[i] : 0;
            total += monthSums[i];
        }

        List<Double> percents = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            percents.add((monthSums[i] / total) * 100.0);
        }

        return percents;
    }

}
