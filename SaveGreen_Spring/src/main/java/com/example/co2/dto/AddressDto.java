package com.example.co2.dto;

import lombok.Data;

@Data
public class AddressDto {
    private String roadAddr;   // 도로명 주소
    private String jibunAddr;  // 지번 주소
    private String zipNo;      // 우편번호
}