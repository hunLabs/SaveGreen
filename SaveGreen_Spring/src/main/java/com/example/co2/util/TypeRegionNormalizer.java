// src/main/java/com/example/co2/util/TypeRegionNormalizer.java
// ============================================================================
// SaveGreen / TypeRegionNormalizer  (v1.1 - 데모 스코프 고정판)
// ----------------------------------------------------------------------------
// [역할]
// - FE/외부에서 들어오는 자유 텍스트를 "프로젝트 합의된 4종 유형"으로 표준화.
// - 지역은 데모 범위에서 대전만 사용하므로, 항상 'daejeon'으로 고정.
//
// [스코프]
// - type: factory | hospital | school | office  (4개만 허용, 'other' 없음)
// - region: daejeon (고정)
//
// [정책]
// - 문자열 전처리 후 **결정적 매핑**(키워드 포함 여부).
// - 매칭 실패 시 가장 무난한 기본값은 **office** 로 폴백(시연 안정성 우선).
//   (원하면 예외 throw 하도록 바꿔줄 수 있음)
//
// [버전]
// - "type-region:v1.1-demo"  : 데모 고정 규칙을 사용 중임을 명시.
// ============================================================================

package com.example.co2.util;

import java.util.Locale;

public class TypeRegionNormalizer {

    public String version() { return "type-region:v1.1-demo"; }

    /**
     * 유형 표준화 (4종만 허용)
     * 입력: 자유 텍스트 (예: "공장", "병원", "학교", "사무동", "오피스" 등)
     * 출력: factory | hospital | school | office (정확히 이 네 값 중 하나)
     */
    public String normalizeType(String raw) {
        if (raw == null || raw.isEmpty()) return "office"; // 안전 폴백

        String s = raw.toLowerCase(Locale.ROOT).trim();

        // 공장/산업/창고/물류 등 → factory
        if (s.contains("공장") || s.contains("제조") || s.contains("산단")
                || s.contains("플랜트") || s.contains("창고") || s.contains("물류")
                || s.contains("factory")) {
            return "factory";
        }

        // 병원/의료/클리닉/요양 등 → hospital
        if (s.contains("병원") || s.contains("의료") || s.contains("의원")
                || s.contains("메디컬") || s.contains("요양") || s.contains("clinic")
                || s.contains("hospital")) {
            return "hospital";
        }

        // 학교/교육/대학/캠퍼스 등 → school
        if (s.contains("학교") || s.contains("교육") || s.contains("초등")
                || s.contains("중학교") || s.contains("고등학교") || s.contains("대학교")
                || s.contains("캠퍼스") || s.contains("school") || s.contains("univ")) {
            return "school";
        }

        // 사무/업무/오피스/행정/본사 등 → office
        if (s.contains("사무") || s.contains("업무") || s.contains("오피스")
                || s.contains("행정") || s.contains("본사") || s.contains("office")) {
            return "office";
        }

        // 디폴트: office (데모 안정성)
        return "office";
    }

    /**
     * 지역 표준화 (데모 범위 고정)
     * - 어떤 입력이 오더라도 'daejeon'으로 귀결.
     * - null 허용하지 않고 강제 셋.
     */
    public String normalizeRegion(String raw) {
        return "daejeon";
    }
}
