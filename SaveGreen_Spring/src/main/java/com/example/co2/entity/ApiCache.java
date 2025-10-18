package com.example.co2.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "api_cache") // 윈도우/리눅스 호환 위해 소문자 고정
@Getter @Setter
public class ApiCache {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "cache_id")
    private Long cacheId;

    @Column(name = "guest_ip", length = 45)
    private String guestIp;

    @Column(name = "building_id")
    private Long buildingId;

    @Column(name = "cache_key_hash", length = 64, nullable = false, unique = true)
    private String cacheKeyHash;

    @Column(name = "cache_key_raw", length = 512)
    private String cacheKeyRaw;

    // MySQL 8 JSON 컬럼 - 문자열로 매핑 (유효한 JSON 문자열만 넣으세요)
    @Column(name = "payload_json", columnDefinition = "json", nullable = false)
    private String payloadJson;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    @PrePersist
    public void prePersist() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
