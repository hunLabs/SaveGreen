package com.example.co2.entity;


import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
@Entity
@Table(name = "tax_policy")
public class TaxPolicy {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)        
    @Column(name = "tax_policy_id")
    private Long taxPolicyId;

    @Column(name = "energy_usage_min", nullable = false, precision = 10, scale = 3)
    private BigDecimal energyUsageMin;

    @Column(name = "energy_usage_max", nullable = false, precision = 10, scale = 3)
    private BigDecimal energyUsageMax;

    @Column(name = "tax1_discount", nullable = false)   
    private Integer tax1Discount;

    @Column(name = "tax2_discount", nullable = false)
    private Integer tax2Discount;

    @Column(name = "area_bonus", nullable = false)
    private Integer areaBonus;

    @Column(name = "note", length = 255)
    private String note;
    
    @Column(name = "energy_grade_label", nullable = false)
    private String energyGradeLabel;

    @Column(name = "energy_grade_category", nullable = false)
    private String energyGradeCategory;

}
