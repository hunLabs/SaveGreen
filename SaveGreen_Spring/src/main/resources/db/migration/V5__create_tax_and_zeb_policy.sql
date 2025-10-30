-- tax_policy
CREATE TABLE IF NOT EXISTS tax_policy (
  tax_policy_id        BIGINT NOT NULL AUTO_INCREMENT,
  energy_usage_min     DECIMAL(10,3) DEFAULT NULL,
  energy_usage_max     DECIMAL(10,3) DEFAULT NULL,
  tax1_discount        INT DEFAULT NULL,
  tax2_discount        INT DEFAULT NULL,
  area_bonus           INT DEFAULT NULL,
  note                 VARCHAR(255) DEFAULT NULL,
  energy_grade_label   VARCHAR(255) NOT NULL,
  energy_grade_category VARCHAR(255) NOT NULL,
  PRIMARY KEY (tax_policy_id)
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- zeb_policy
CREATE TABLE IF NOT EXISTS zeb_policy (
  zeb_id                  BIGINT NOT NULL AUTO_INCREMENT,
  area_bonus              INT DEFAULT NULL,
  certification_discount  INT DEFAULT NULL,
  max_percent             DECIMAL(38,2) NOT NULL,
  min_percent             DECIMAL(38,2) NOT NULL,
  note                    VARCHAR(255) DEFAULT NULL,
  renewable_support       VARCHAR(255) DEFAULT NULL,
  tax1_discount           INT DEFAULT NULL,
  tax2_discount           INT DEFAULT NULL,
  zeb_name                VARCHAR(255) NOT NULL,
  PRIMARY KEY (zeb_id)
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
