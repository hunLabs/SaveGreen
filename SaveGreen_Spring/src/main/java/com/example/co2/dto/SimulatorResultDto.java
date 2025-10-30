package com.example.co2.dto;

import java.math.BigDecimal;
import lombok.Getter;
import lombok.Setter;

@Getter @Setter
public class SimulatorResultDto {
   
    private String grade;      
    private BigDecimal energySelf;  
    private String zebGrade;     
    private Integer propertyTax; 
    private Integer acquireTax; 
    private Integer areaBonus;  
    private String renewableSupport; 
    private Integer certificationDiscount; 
    private String message;      
    private String zebName;    
    private String category;    

    
    private BigDecimal requiredPanels;
    private BigDecimal annualSaveElectric;
    private BigDecimal annualSaveCO2;
    private BigDecimal total;
    private BigDecimal solarRadiation;
    private BigDecimal onePanelGeneration;
    private BigDecimal onePanelCO2;
    private BigDecimal onePanelSaveElectric;
    private BigDecimal daySolar;
    private BigDecimal onePanelGeneForChart;
    private String roadAddr;

    private int currentGrade;
    private int targetGrade;

}
