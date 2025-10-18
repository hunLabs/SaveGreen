package com.example.co2.repository;

import com.example.co2.entity.ApiCache;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

public interface ApiCacheRepository extends JpaRepository<ApiCache, Long> {

    /* 캐시 조회 (유효기간 내) — 서비스에서 사용하는 시그니처 */
    Optional<ApiCache> findTopByCacheKeyHashAndExpiresAtAfter(String cacheKeyHash, LocalDateTime now);

    /* MySQL 8 JSON UPSERT — 테이블/컬럼명 소문자 + 백틱 통일 */
    @Modifying
    @Transactional
    @Query(value = """
        INSERT INTO `api_cache`
          (`cache_key_hash`, `cache_key_raw`, `payload_json`, `expires_at`, `building_id`, `guest_ip`, `created_at`)
        VALUES
          (:hash, :raw, CAST(:payload AS JSON), :expiresAt, :buildingId, :guestIp, NOW(3))
        ON DUPLICATE KEY UPDATE
          `cache_key_raw` = VALUES(`cache_key_raw`),
          `payload_json`  = VALUES(`payload_json`),
          `expires_at`    = VALUES(`expires_at`),
          `building_id`   = VALUES(`building_id`),
          `guest_ip`      = VALUES(`guest_ip`)
        """, nativeQuery = true)
    int upsert(@Param("hash") String hash,
               @Param("raw") String raw,
               @Param("payload") String payload,
               @Param("expiresAt") LocalDateTime expiresAt,
               @Param("buildingId") Long buildingId,
               @Param("guestIp") String guestIp);

    /* ⬇⬇⬇ 여기 추가: 만료/오래된 레코드 삭제 (하우스키핑) */
    @Modifying
    @Transactional
    @Query(value = """
        DELETE FROM `api_cache`
        WHERE `expires_at` <= :cutoff
           OR `created_at` <= :cutoff
        """, nativeQuery = true)
    int deleteExpired(@Param("cutoff") LocalDateTime cutoff);
}
