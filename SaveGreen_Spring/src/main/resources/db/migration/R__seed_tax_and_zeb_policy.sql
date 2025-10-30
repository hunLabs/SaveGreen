/* -------------------------
 * tax_policy (10 rows)
 * - PK(tax_policy_id) 기준으로 멱등 업서트
 * ------------------------- */
INSERT INTO tax_policy
(tax_policy_id, energy_usage_min, energy_usage_max, tax1_discount, tax2_discount, area_bonus, note, energy_grade_label, energy_grade_category)
VALUES
(1,  0.000,  80.000, 10, 10, 14, '최우수 x 효율1',  '1+++',  '최우수'),
(2, 80.000, 140.000,  9,  9, 12, '최우수 x 효율2',  '1++',   '최우수'),
(3,140.000, 200.000,  5,  7,  6, '최우수 x 효율3',  '1+',    '최우수'),
(4,200.000, 260.000,  3,  3,  3, '최우수 x 효율4',  '1',     '우수'),
(5,260.000, 320.000,  0,  0,  0, '최우수 x 효율5',  '2',     '우수'),
(6,320.000, 380.000,  0,  0,  0, '최우수 x 효율6',  '3',     '양호'),
(7,380.000, 450.000,  0,  0,  0, '최우수 x 효율7',  '4',     '양호'),
(8,450.000, 520.000,  0,  0,  0, '최우수 x 효율8',  '5',     '일반'),
(9,520.000, 610.000,  0,  0,  0, '최우수 x 효율9',  '6',     '일반'),
(10,610.000,99999.000,0,  0,  0, '최우수 x 효율10', '7',     '일반')
ON DUPLICATE KEY UPDATE
  energy_usage_min      = VALUES(energy_usage_min),
  energy_usage_max      = VALUES(energy_usage_max),
  tax1_discount         = VALUES(tax1_discount),
  tax2_discount         = VALUES(tax2_discount),
  area_bonus            = VALUES(area_bonus),
  note                  = VALUES(note),
  energy_grade_label    = VALUES(energy_grade_label),
  energy_grade_category = VALUES(energy_grade_category);

/* -------------------------
 * zeb_policy (6 rows)
 * ------------------------- */
INSERT INTO zeb_policy
(zeb_id, area_bonus, certification_discount, max_percent, min_percent, note, renewable_support, tax1_discount, tax2_discount, zeb_name)
VALUES
(1, 11,  30,  40.00,  20.00, NULL, '신재생 에너지 보조금 지원', 15,  5, '5등급'),
(2, 12,  50,  60.00,  40.00, NULL, '신재생 에너지 보조금 지원', 18, 10, '4등급'),
(3, 13, 100,  80.00,  60.00, NULL, '신재생 에너지 보조금 지원', 20, 15, '3등급'),
(4, 14, 100, 100.00,  80.00, NULL, '신재생 에너지 보조금 지원', 20, 15, '2등급'),
(5, 15, 100, 120.00, 100.00, NULL, '신재생 에너지 보조금 지원', 20, 15, '1등급'),
(6, 15, 100,99999.00, 120.00, NULL, '신재생 에너지 보조금 지원', 20, 15, '+등급')
ON DUPLICATE KEY UPDATE
  area_bonus             = VALUES(area_bonus),
  certification_discount = VALUES(certification_discount),
  max_percent            = VALUES(max_percent),
  min_percent            = VALUES(min_percent),
  note                   = VALUES(note),
  renewable_support      = VALUES(renewable_support),
  tax1_discount          = VALUES(tax1_discount),
  tax2_discount          = VALUES(tax2_discount),
  zeb_name               = VALUES(zeb_name);
