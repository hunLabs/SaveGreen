ALTER TABLE Api_Cache
  ADD COLUMN cache_key_hash VARCHAR(64)  NOT NULL AFTER building_id,
  ADD COLUMN payload_json   JSON         NOT NULL AFTER cache_key_hash,
  ADD COLUMN expires_at     TIMESTAMP    NOT NULL AFTER payload_json,
  ADD UNIQUE KEY uk_api_cache_hash (cache_key_hash);
