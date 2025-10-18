package com.example.co2.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter @Setter
public class SearchBuilding {
    private String buildingName;
    private String pnu;
    private String address;
    private String buildingType1;
    private String buildingType2;
    private Double floorAreaM2;
    private Integer usageYear;
    private List<YearlyConsumption> yearlyConsumption;   
    private Double electricityUsageKwh;                 
    private Double energyIntensityKwhPerM2;
    private List<MonthlyConsumption> monthlyConsumption; 

    @Getter @Setter
    public static class YearlyConsumption {
        private Integer year;
        private Double electricity;
    }

    @Getter @Setter
    public static class MonthlyConsumption {
        private Integer month;
        private Double electricity;
    }
}
