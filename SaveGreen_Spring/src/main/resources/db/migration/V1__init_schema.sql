-- Guest
CREATE TABLE IF NOT EXISTS Guest (
  guest_ip   VARCHAR(45) NOT NULL,
  guest_date DATE NOT NULL,
  PRIMARY KEY (guest_ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Building
CREATE TABLE IF NOT EXISTS Building (
  building_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_addr      VARCHAR(200) NOT NULL,
  building_jibun     VARCHAR(100) NULL,
  building_energyuse DECIMAL(12,3) NULL,
  building_usage     VARCHAR(30)  NULL,
  building_age       SMALLINT UNSIGNED NULL,
  building_area      DECIMAL(14,2) NULL,
  PRIMARY KEY (building_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- GreenRemodelingSimulation (FK → Building)
CREATE TABLE IF NOT EXISTS GreenRemodelingSimulation (
  green_remodeling_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_id         BIGINT UNSIGNED NOT NULL,
  current_grade       TINYINT UNSIGNED NOT NULL,
  target_grade        TINYINT UNSIGNED NOT NULL,
  saving_cost         DECIMAL(16,2) NULL,
  payback_years       DECIMAL(6,2)  NULL,
  is_recommend        TINYINT NOT NULL DEFAULT 0,
  is_dummy            TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (green_remodeling_id),
  CONSTRAINT fk_sim_building
    FOREIGN KEY (building_id) REFERENCES Building(building_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Simulation_Log (FK → Guest/Building)
CREATE TABLE IF NOT EXISTS Simulation_Log (
  simulation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  input_log     JSON NULL,
  output_log    JSON NULL,
  guest_ip      VARCHAR(45) NULL,
  building_id   BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (simulation_id),
  CONSTRAINT fk_log_guest
    FOREIGN KEY (guest_ip)    REFERENCES Guest(guest_ip)
    ON DELETE SET NULL,
  CONSTRAINT fk_log_building
    FOREIGN KEY (building_id) REFERENCES Building(building_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Api_Cache (초기 최소 컬럼 + FK → Building)
CREATE TABLE IF NOT EXISTS Api_Cache (
  cache_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  guest_ip    VARCHAR(45) NULL,
  building_id BIGINT  UNSIGNED NULL,
  PRIMARY KEY (cache_id),
  CONSTRAINT fk_cache_guest
    FOREIGN KEY (guest_ip)    REFERENCES Guest(guest_ip)
    ON DELETE SET NULL,
  CONSTRAINT fk_cache_building
    FOREIGN KEY (building_id) REFERENCES Building(building_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grade_Policy
CREATE TABLE IF NOT EXISTS Grade_Policy (
  policy_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  zeb_policy   JSON NULL,
  gseed_policy JSON NULL,
  PRIMARY KEY (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
