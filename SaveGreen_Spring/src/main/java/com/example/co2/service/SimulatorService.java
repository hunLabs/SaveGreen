
package com.example.co2.service;

import com.example.co2.dto.SimulatorDto;
import com.example.co2.dto.SimulatorResultDto;
import com.example.co2.entity.TaxPolicy;
import com.example.co2.entity.ZebPolicy;
import com.example.co2.repository.TaxPolicyRepository;
import com.example.co2.repository.ZebPolicyRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class SimulatorService {

    private final TaxPolicyRepository taxPolicyRepository;
    private final ZebPolicyRepository zebPolicyRepository;

    public SimulatorResultDto calculate1(SimulatorDto dto) throws Exception {
        SimulatorResultDto res = new SimulatorResultDto();
        

        BigDecimal annualUsage = dto.getEnergy();
        BigDecimal solarRadiation = getSolarRadiation(dto.getLat(),dto.getLon());
        System.out.println(dto.getLat()+","+dto.getLon());
        BigDecimal efficiency = BigDecimal.valueOf(0.8); 
        Integer panelPowerInt = dto.getPanelPower();
        Integer panelCountInt = dto.getPanelCount();
        BigDecimal panelPower = panelPowerInt == null ? BigDecimal.ZERO : BigDecimal.valueOf(panelPowerInt);
        BigDecimal panelCount = panelCountInt == null ? BigDecimal.ZERO : BigDecimal.valueOf(panelCountInt);
        BigDecimal generation = solarRadiation.multiply(efficiency).multiply(panelPower).multiply(panelCount).divide(BigDecimal.valueOf(1000));
        BigDecimal energySelf = generation.divide(annualUsage,3,RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100));
        System.out.println("generation = " + generation);
        System.out.println("energySelf = " + energySelf);
        BigDecimal usage = (dto.getEnergy().subtract(generation)).divide(dto.getArea(),3,RoundingMode.HALF_UP); // 소수점 3자리 반올림
        System.out.println("usage = " + usage);

       






        ZebPolicy z = zebPolicyRepository
        .findFirstByMinPercentLessThanEqualAndMaxPercentGreaterThanEqual(energySelf, energySelf)
        .orElse(null);
       
        TaxPolicy p = taxPolicyRepository
                .findFirstByEnergyUsageMinLessThanEqualAndEnergyUsageMaxGreaterThanEqual(usage, usage)
                .orElse(null); // 스프링데이터 jpa의 파생쿼리
                                    // 구현을 쓰지않아도 메서드 이름으로 쿼리를 유추해서 알아서 구현해줌
        System.out.println("p = " + p);
        if (p == null) {
            res.setPropertyTax(0);
            res.setAcquireTax(0);
            res.setAreaBonus(0);
           
        } else {
            res.setPropertyTax(p.getTax1Discount());
            res.setAcquireTax(p.getTax2Discount());
            res.setAreaBonus(p.getAreaBonus());
            res.setGrade(p.getEnergyGradeLabel());
            res.setCategory(p.getEnergyGradeCategory());
            res.setEnergySelf(energySelf);
        }
        if (z != null) {
            res.setZebGrade(z.getZebName());         
            if (z.getTax1Discount()>res.getPropertyTax()) {
                res.setPropertyTax(z.getTax1Discount());
            }
            if (z.getTax2Discount()>res.getAcquireTax()) {
                res.setAcquireTax(z.getTax2Discount());
            }    
            if (z.getAreaBonus()>res.getAreaBonus()) {
                res.setAreaBonus(z.getAreaBonus());
            }
            res.setRenewableSupport(z.getRenewableSupport()); 
            res.setCertificationDiscount(z.getCertificationDiscount());
            
         
        } else {
            res.setZebGrade("등급없음");
        }


        return res;
    }

    public SimulatorResultDto calculate2 (SimulatorDto dto) throws Exception {
        SimulatorResultDto res = new SimulatorResultDto();

        BigDecimal solarRadiation = getSolarRadiation(dto.getLat(),dto.getLon());
        BigDecimal efficiency = BigDecimal.valueOf(0.8); 
        Integer panelPowerInt = dto.getPanelPower();
        BigDecimal panelPower = panelPowerInt == null ? BigDecimal.ZERO : BigDecimal.valueOf(panelPowerInt);

         Map<Integer,int[]> gradeRange = new HashMap<>();
        gradeRange.put(1, new int[]{0, 80});
        gradeRange.put(2, new int[]{80, 140});
        gradeRange.put(3, new int[]{140, 200});
        gradeRange.put(4, new int[]{200, 260});
        gradeRange.put(5, new int[]{260, 320});
        gradeRange.put(6, new int[]{320, 380});
        gradeRange.put(7, new int[]{380, 450});
        gradeRange.put(8, new int[]{450, 520});
        gradeRange.put(9, new int[]{520, 610});
        gradeRange.put(10, new int[]{610, 700});

        int currentGrade = dto. getCurrentGrade();
        int targetGrade = dto.getTargetGrade();
        BigDecimal currentMid = BigDecimal.ZERO;
        BigDecimal targetMid = BigDecimal.ZERO;

        
        if (gradeRange.containsKey(currentGrade)) {
            int[] range = gradeRange.get(currentGrade);
            currentMid = BigDecimal.valueOf((range[0] + range[1]) / 2.0);
        }
        if (gradeRange.containsKey(targetGrade)) {
            int[] range = gradeRange.get(targetGrade);
            targetMid = BigDecimal.valueOf((range[0] + range[1]) / 2.0);
        }

        BigDecimal energyDiff = currentMid.subtract(targetMid);
        BigDecimal totalEnergyDiff = energyDiff.multiply(dto.getArea());
        
        BigDecimal onePanelGeneration = panelPower.divide(BigDecimal.valueOf(1000), 3, RoundingMode.HALF_UP)
                .multiply(solarRadiation)
                .multiply(efficiency);

        BigDecimal requiredPanels = BigDecimal.ZERO;
        if (onePanelGeneration.compareTo(BigDecimal.ZERO) > 0) {
            requiredPanels = totalEnergyDiff.divide(onePanelGeneration, 0, RoundingMode.CEILING);
        }
        BigDecimal total = requiredPanels.multiply(onePanelGeneration).setScale(1,RoundingMode.HALF_UP);
       
        BigDecimal annualSaveElectric = total.multiply(BigDecimal
                                            .valueOf(185.5))
                                            .divide(BigDecimal.valueOf(10000),1,RoundingMode.HALF_UP); // kWh
        BigDecimal annualSaveCO2 = total.multiply(BigDecimal.valueOf(0.415))
                                        .divide(BigDecimal.valueOf(1000),1,RoundingMode.HALF_UP); // TonCO2


        System.out.println("annualSaveElectric = " + annualSaveElectric);
        System.out.println("annualSaveCO2 = " + annualSaveCO2);
        System.out.println("requiredPanels = " + requiredPanels);
        System.out.println("total = " + total);

        res.setAnnualSaveElectric(annualSaveElectric);
        res.setAnnualSaveCO2(annualSaveCO2);
        res.setTotal(total);
        res.setRequiredPanels(requiredPanels);


        return res;
    }


    public BigDecimal getSolarRadiation(double lat, double lon)throws Exception{
        String url = "https://power.larc.nasa.gov/api/temporal/monthly/point"
                  +  "?parameters=ALLSKY_SFC_SW_DWN"
                  +  "&community=RE"
                  +  "&latitude="+lat
                  +  "&longitude="+lon
                  +  "&start=2024"
                  +  "&end=2024"
                  +  "&format=JSON";
        RestTemplate nasaRestTemplate = new RestTemplate();
        String response = nasaRestTemplate.getForObject(url, String.class);
        System.out.println("response = " + response);
        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(response);
        JsonNode values= root.path("properties").path("parameter").path("ALLSKY_SFC_SW_DWN");
        JsonNode annual = values.path("202413");
        System.out.println("annual = " + annual);
        if (annual.isMissingNode()||annual.isNull()) {
            throw new Exception("No data for the specified year");
        }

        BigDecimal annualmean = BigDecimal.valueOf(annual.asDouble()).setScale(3, RoundingMode.HALF_UP);
        BigDecimal result = annualmean.multiply(BigDecimal.valueOf(366));

        return result;
    }   
   // 도로명 주소 검색
    public List<SimulatorDto> searchAddress(String keyword) throws Exception {
        String url="https://www.juso.go.kr/addrlink/addrLinkApi.do?currentPage=1" +
                "&countPerPage=5" +
                "&keyword=" + keyword +
                "&confmKey=devU01TX0FVVEgyMDI1MTAwMTEwMjQyMTExNjI5NjQ=" +
                "&resultType=json";
        RestTemplate rt = new RestTemplate();
        String response = rt.getForObject(url, String.class);

        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(response);
        JsonNode addressArray = root.path("results").path("juso");

      

        List<SimulatorDto> list = new ArrayList<>();
        for (int i = 0; i < addressArray.size(); i++) {
            JsonNode node = addressArray.get(i);

            SimulatorDto dto = new SimulatorDto();
            dto.setSiNm(node.path("siNm").asText());
            dto.setSggNm(node.path("sggNm").asText());
            dto.setRoadAddr(node.path("roadAddr").asText());
            dto.setJibunAddr(node.path("jibunAddr").asText());
            dto.setZipNo(node.path("zipNo").asText());
            list.add(dto);
        }
        return list;
    }

        
    
}


    