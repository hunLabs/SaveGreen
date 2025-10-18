package com.example.co2.entity;

import java.math.BigDecimal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "zeb_policy")
@Getter @Setter
public class ZebPolicy {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "zeb_id")
    private Long zebPolicyId;

    @Column(nullable = false , name="zeb_name")
    private String zebName;  

    @Column(nullable = false, name="min_percent")
    private BigDecimal minPercent;

    @Column(nullable = false, name="max_percent")
    private BigDecimal maxPercent;

    @Column(nullable = false, name="tax1_discount")
    private int tax1Discount;

    @Column(nullable = false, name="tax2_discount")
    private int tax2Discount;

    @Column(nullable = false, name="certification_discount")
    private int certificationDiscount;

    @Column(nullable = false, name="renewable_support")
    private String renewableSupport;

    @Column(nullable = false, name="area_bonus")
    private int areaBonus;
}
