package com.example.co2.repository;



import org.springframework.data.jpa.repository.JpaRepository;

import com.example.co2.entity.TaxPolicy;

import java.math.BigDecimal;
import java.util.Optional;

public interface TaxPolicyRepository extends JpaRepository<TaxPolicy, Long> {
    
    Optional<TaxPolicy> findFirstByEnergyUsageMinLessThanEqualAndEnergyUsageMaxGreaterThanEqual(
            BigDecimal usage1, BigDecimal usage2
    );
}
