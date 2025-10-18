// [신규] VWorld 프록시 컨트롤러 (Forecast 전용)
// - 목적: 브라우저 키 노출/CORS 회피. FE는 /api/ext/vworld/* 만 호출.
// - 설계: 원본 JSON pass-through (키 매핑은 FE에서 방어적으로 처리; 안정화 후 서버 정규화 고려)

package com.example.co2.api;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

@Slf4j
@RestController
// [추가] 혼선 방지를 위해 클래스명은 Forecast*, 하지만 엔드포인트는 팀 합의 경로 유지
//       필요 시 마이그레이션용 별칭 경로도 함께 매핑
@RequestMapping({"/api/ext/vworld", "/api/forecast/ext/vworld"})
public class ForecastVWorldProxyController {

	// [설정] application.properties / yaml 에서 주입
	@Value("${app.vworld.key}")
	private String vworldKey;

	// [간단] RestTemplate 내부 생성(프로젝트에서 Bean을 쓰면 교체 가능)
	private final RestTemplate rest = new RestTemplate();

	// ---------------------------------------------------------------------
	// [엔드포인트 1] 좌표 → 도로명/지번 (Reverse Geocoding)
	// 사용 예) GET /api/ext/vworld/revgeo?lat=36.35&lon=127.38
	// ---------------------------------------------------------------------
	@GetMapping(value = "/revgeo", produces = MediaType.APPLICATION_JSON_VALUE)
	public Object reverseGeocode(
			@RequestParam("lat") double lat,
			@RequestParam("lon") double lon
	) {
		// [중요] VWorld 주소 API: req/address (type=both → 도로명+지번 동시)
		String url = "https://api.vworld.kr/req/address";

		// [구성] 쿼리스트링 파라미터
		MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
		params.add("service", "address");
		params.add("request", "getAddress");
		// VWorld는 "lon,lat" 순서의 point 문자열 요구
		params.add("point", lon + "," + lat);
		params.add("type", "both"); // 도로명+지번
		params.add("format", "json");
		params.add("key", vworldKey);

		String fullUrl = UriComponentsBuilder.fromHttpUrl(url)
				.queryParams(params)
				.build(true) // 인코딩 보존
				.toUriString();

		log.debug("[forecast-ext] revgeo GET {}", fullUrl);
		return rest.getForObject(fullUrl, Object.class);
	}

	// ---------------------------------------------------------------------
	// [엔드포인트 2] PNU → 건물 정보 (건물명/사용승인일자 등)
	// 사용 예) GET /api/ext/vworld/parcel?pnu=3017011200112680000
	// ---------------------------------------------------------------------
	@GetMapping(value = "/parcel", produces = MediaType.APPLICATION_JSON_VALUE)
	public Object getParcel(@RequestParam("pnu") String pnu) {
		// [주의] VWorld 'req/data'는 데이터셋 명이 환경에 따라 다름.
		//       우선 pass-through로 원본을 내려보내고, FE 콘솔로 키를 확인 후 매핑.
		//       아래 data 파라미터는 예시이며, 실제 운영에 맞춰 조정 필요.
		String url = "https://api.vworld.kr/req/data";

		MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
		params.add("service", "data");
		params.add("request", "getFeature");
		// [예시 데이터셋] 건축물 정보. 환경에 따라 'lt_c_buld_buldinfo' 등으로 조정
		params.add("data", "lt_c_buld_buldinfo");
		params.add("size", "1");
		params.add("format", "json");
		params.add("geometry", "false");
		params.add("key", vworldKey);
		// [검색식] 데이터셋의 PNU 컬럼 명에 맞춰 attrFilter 구성(일치 또는 like)
		//          초기에는 like로 관대하게 조회 후, 응답 확인하고 '='로 바꾸는 것을 권장
		params.add("attrFilter", "pnu:like:" + pnu);

		String fullUrl = UriComponentsBuilder.fromHttpUrl(url)
				.queryParams(params)
				.build(true)
				.toUriString();

		log.debug("[forecast-ext] parcel GET {}", fullUrl);
		return rest.getForObject(fullUrl, Object.class);
	}
}
