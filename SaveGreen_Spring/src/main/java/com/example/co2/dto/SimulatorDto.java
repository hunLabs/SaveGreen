package com.example.co2.dto;

import java.math.BigDecimal;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SimulatorDto {
    private String address;
    private BigDecimal area;
    private BigDecimal energy;
    private Integer panelCount;   //Integer -> (null 허용)
    private Integer panelPower;
    private Double lat;
    private Double lon;
    
    private String siNm;
    private String sggNm;
    private String roadAddr;
    private String jibunAddr;
    private String zipNo;
   
    private int currentGrade;
    private int targetGrade;
}
