package com.example.co2.service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import com.example.co2.dto.SimulatorDto;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
public class VworldService {
    private static final String VWORLD_KEY = "AED66EDE-3B3C-3034-AE11-9DBA47236C69";

    // juso API 주소 검색
    public List<SimulatorDto> getCoordinates(String keyword) throws Exception {
        String url = "https://www.juso.go.kr/addrlink/addrLinkApi.do?currentPage=1"
                + "&countPerPage=5"
                + "&keyword=" + keyword
                + "&confmKey=devU01TX0FVVEgyMDI1MTAwMTEwMjQyMTExNjI5NjQ="
                + "&resultType=json";

        RestTemplate rt = new RestTemplate();
        String response = rt.getForObject(url, String.class);

        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(response);
        JsonNode addressArray = root.path("results").path("juso");

        List<SimulatorDto> list = new ArrayList<>();
        for (JsonNode node : addressArray) {
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
    // vWorld API 좌표 변환
    public Map<String, Object> getCoordFromVworld(String address) {
        try {
            String encoded = URLEncoder.encode(address, StandardCharsets.UTF_8);
            String url = "https://api.vworld.kr/req/address"
                    + "?service=address"
                    + "&request=getCoord"
                    + "&version=2.0"
                    + "&crs=epsg:4326"
                    + "&key=" + VWORLD_KEY
                    + "&address=" + encoded
                    + "&type=road";

            RestTemplate restTemplate = new RestTemplate();
            String response = restTemplate.getForObject(url, String.class);

            ObjectMapper mapper = new ObjectMapper();
            return mapper.readValue(response, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new RuntimeException("Vworld API 호출 실패", e);
        }
    }

    
}
