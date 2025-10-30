ALTER TABLE Api_Cache
  ADD COLUMN cache_key_raw  VARCHAR(512) NULL AFTER cache_key_hash,
  ADD COLUMN created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER payload_json,
  ADD KEY idx_api_cache_exp (expires_at);
