package com.example.co2.repository;


import org.springframework.data.jpa.repository.JpaRepository;
import com.example.co2.entity.ZebPolicy;
import java.math.BigDecimal;
import java.util.Optional;

public interface ZebPolicyRepository extends JpaRepository<ZebPolicy, Long> {
    Optional<ZebPolicy> findFirstByMinPercentLessThanEqualAndMaxPercentGreaterThanEqual(
            BigDecimal min, BigDecimal max
    );
}
