-- 최종 방향(2025-10-02): Api_Cache → Building FK 제거
ALTER TABLE Api_Cache DROP FOREIGN KEY fk_cache_building;
