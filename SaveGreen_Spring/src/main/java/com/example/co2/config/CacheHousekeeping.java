package com.example.co2.config;

import com.example.co2.repository.ApiCacheRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

@Slf4j
@Component
@RequiredArgsConstructor
public class CacheHousekeeping {

    private final ApiCacheRepository repo;

    @Value("${app.cache.ttl-minutes:30}")
    private int ttlMinutes;

    @Scheduled(cron = "${app.cache.evict-cron:0 */10 * * * *}") // 필요시 0 */30 * * * *
    public void evictExpired() {
        var cutoff = LocalDateTime.now().minusMinutes(ttlMinutes);
        int n = repo.deleteExpired(cutoff); // createdAt <= :cutoff 또는 expiresAt <= :cutoff
        if (n > 0) log.info("api_cache evicted {} rows (cutoff={})", n, cutoff);
    }
}
