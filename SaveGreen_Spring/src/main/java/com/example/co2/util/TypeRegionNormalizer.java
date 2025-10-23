// [수정] 파일 상단 설계/역할 주석 보강 + 패키지 정렬
package com.example.co2.util;

import com.example.co2.dto.PredictDtos;

/*
	역할(전처리 유틸):
	- 프론트에서 전달된 예측 요청 DTO의 텍스트 필드를 안전하게 정규화.
	- 컨트롤러에서 호출 시 "제자리(in-place)"로 값을 다듬어 BE/ML 간 인터페이스 안정화.

	적용 범위:
	- type/region/buildingName/address/pnu 같이 문자열 필드 중심.
	- 숫자 필드(builtYear, floorAreaM2 등)는 본 메서드에서 수정하지 않음(기존 로직 존중).

	포인트:
	1) NPE 방지: null → "" 처리, trim
	2) 타입 간단 매핑: 공장/병원/학교/사무 → factory/hospital/school/office
	3) 지역 간단 정리: "대전광역시 서구" → "대전 서구" 처럼 광역시/특별시 접미사 제거
	4) 호출부 시그니처 유지: normalizeInPlace(PredictRequest) - 컨트롤러 변경 불필요
*/

// [추가] 전처리 유틸 본체
public final class TypeRegionNormalizer {

	// [추가] 외부 생성 금지
	private TypeRegionNormalizer() {
	}

	// [추가] 컨트롤러에서 호출하는 시그니처 그대로 유지
	// - request 내부 문자열 필드를 "제자리(in-place)"로 정규화합니다.
	// - 숫자 필드는 변경하지 않습니다(기존 서비스 로직을 존중).
	/**
	 * 프론트 요청 DTO의 주요 문자열 필드를 안전하게 정규화(제자리 수정).
	 *
	 * <p>수행 내용(보수적 규칙):
	 * <ul>
	 *   <li>널/공백 방지: 모든 문자열 필드에 대해 null → "" 및 trim</li>
	 *   <li>type 매핑: 공장/제조/병원/의료/학교/교육/사무/업무/오피스 → factory/hospital/school/office</li>
	 *   <li>region 정리: "광역시"/"특별시" 접미사 제거(예: "대전광역시 서구" → "대전 서구")</li>
	 *   <li>주소: 괄호 정보 제거, 다중 공백 단일화</li>
	 *   <li>식별 보조: buildingName, pnu는 trim만 수행(의도된 값 변경 방지)</li>
	 * </ul>
	 *
	 * @param request 예측 요청 DTO (null 허용. null이면 no-op)
	 */
	public static void normalizeInPlace(final PredictDtos.PredictRequest request) {
		// 1) null guard
		if (request == null) {
			return;
		}

		// 2) type: 한글/자유 텍스트 → 코어 타입으로 보수적 매핑
		{
			final String raw = safe(request.getType());
			final String mapped = mapUseToCoreType(raw);
			request.setType(mapped);
		}

		// 3) region: "광역시/특별시" 제거 + 다중 공백 제거
		{
			final String raw = safe(firstNonEmpty(
					request.getRegion(),        // 프런트에서 바로 오는 값
					request.getRegionRaw(),     // 대안 키가 있다면(있을 수도 없을 수도)
					request.getAddress()        // 주소에서 앞 1~2 토큰만 사용하는 케이스가 있을 수 있음
			));
			final String cleaned = cleanRegion(raw);
			request.setRegion(cleaned);
			// regionRaw 필드가 존재하는 DTO라면, 깔끔한 값을 보조로 넣어 후속 로깅/ML에 도움
			if (hasSetter(request, "setRegionRaw")) {
				request.setRegionRaw(cleaned);
			}
		}

		// 4) buildingName: NPE 방지 + trim
		{
			request.setBuildingName(safe(request.getBuildingName()));
		}

		// 5) address: 괄호 설명 제거 + 다중 공백 단일화
		{
			final String addr = normalizeAddress(safe(request.getAddress()));
			request.setAddress(addr);
		}

		// 6) pnu: NPE 방지 + trim (값 변형은 하지 않음)
		{
			request.setPnu(safe(request.getPnu()));
		}
	}

	// [추가] --- 아래는 내부 헬퍼들 ---

	// [추가] null → "" 치환 + trim
	private static String safe(final String s) {
		return (s == null) ? "" : s.trim();
	}

	// [추가] 다수 후보 중 첫 번째 비어있지 않은 문자열 반환
	private static String firstNonEmpty(final String... arr) {
		if (arr == null) return "";
		for (final String s : arr) {
			if (s != null && !s.trim().isEmpty()) {
				return s;
			}
		}
		return "";
	}

	// [추가] 지역 문자열 정리: 광역시/특별시 제거 + 다중 공백 단일화
	private static String cleanRegion(final String raw) {
		String s = safe(raw);
		if (s.isEmpty()) return s;
		s = s.replace("광역시", "").replace("특별시", "");
		s = s.replaceAll("\\s+", " ").trim();
		return s;
	}

	// [추가] 주소 정규화: 괄호 설명 제거 + 다중 공백 단일화
	private static String normalizeAddress(final String raw) {
		String s = safe(raw);
		if (s.isEmpty()) return s;
		s = s.replaceAll("\\s*\\([^)]*\\)\\s*", " "); // 괄호() 내용 제거
		s = s.replaceAll("\\s+", " ").trim();        // 다중 공백 → 1칸
		return s;
	}

	// [추가] 한글 용도 → 코어 타입 보수적 매핑 (미일치 시 office)
	// - 기존 FE 매핑과 일관성 유지: factory/hospital/school/office 4종
	private static String mapUseToCoreType(final String input) {
		final String s = safe(input).toLowerCase();

		if (s.contains("공장") || s.contains("제조")) {
			return "factory";
		}
		if (s.contains("병원") || s.contains("의료")) {
			return "hospital";
		}
		if (s.contains("학교") || s.contains("교육")) {
			return "school";
		}
		if (s.contains("사무") || s.contains("업무") || s.contains("오피스")) {
			return "office";
		}
		// 그 외 → 기본값 유지(보수적)
		return "office";
	}

	// [추가] 리플렉션 없이 “세터 존재 여부”를 가볍게 체크하는 용도.
	// DTO가 regionRaw 세터를 가지지 않는 경우도 있으므로 안전하게 분기.
	private static boolean hasSetter(final PredictDtos.PredictRequest req, final String setterName) {
		try {
			req.getClass().getMethod(setterName, String.class);
			return true;
		} catch (NoSuchMethodException ex) {
			return false;
		}
	}
}
