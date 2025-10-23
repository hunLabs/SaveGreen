// ============================================================
// HttpConfig.java
// ------------------------------------------------------------
// 역할
// 1) FastAPI(ML) 호출 전용 RestTemplate 빈을 구성한다.
// 2) application.properties 의 ml.* 프로퍼티(접속/읽기 타임아웃)를 적용한다.
// 3) 연결/읽기 타임아웃 기본값은 각각 1500ms / 3000ms 로 안전한 디폴트를 둔다.
//
// 사용 방법
// - application.properties:
//     ml.base-url=http://127.0.0.1:8000
//     ml.timeout-ms.connect=1500
//     ml.timeout-ms.read=3000
// - 서비스 코드(MlBridgeService 등)에서 이 빈을 주입받아 사용:
//     private final RestTemplate mlRestTemplate;
//     public MlBridgeService(RestTemplate mlRestTemplate, @Value("${ml.base-url}") String mlBaseUrl) { ... }
//
// 주의
// - 여기는 "ml.*" 만 읽는다. 기존 "app.ml.*"는 더 이상 사용하지 않는다.
// - RestTemplate 은 baseUrl 개념이 없으므로, 서비스 코드에서 URL을 조합해 호출해야 한다.
// - 타임아웃은 HttpComponentsClientHttpRequestFactory 로 구성한다.
//
// 확장 포인트
// - 필요 시 인터셉터(요청 로깅/공통 헤더), 오류 핸들러(custom ResponseErrorHandler)를 추가해도 된다.
// ============================================================

// package 라인은 기존 파일의 패키지를 그대로 유지하세요.
// package com.yourcompany.yourapp.config;
package com.example.co2.config;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

@Configuration
public class HttpConfig {

	// --------------------------------------------------------
	// 타임아웃 프로퍼티 바인딩
	// - ml.timeout-ms.connect: 백엔드(ML) 소켓 연결을 맺는 데 허용하는 최대 시간
	// - ml.timeout-ms.read   : 연결 이후 응답 바디를 읽는 데 허용하는 최대 시간
	// - 기본값: 1500ms / 3000ms (프로퍼티가 비어 있어도 동작)
	// --------------------------------------------------------
	@Value("${ml.timeout-ms.connect:1500}")
	private int connectTimeoutMs;

	@Value("${ml.timeout-ms.read:3000}")
	private int readTimeoutMs;

	// --------------------------------------------------------
	// ML 전용 RestTemplate 빈
	// - 빈 이름을 "mlRestTemplate"로 고정하여 주입 시 혼동 방지
	// - 프로젝트에 RestTemplate가 여럿이면 @Primary 추가 고려
	// --------------------------------------------------------
	@Bean(name = "mlRestTemplate")
	// @Primary
	public RestTemplate mlRestTemplate() {
		HttpComponentsClientHttpRequestFactory factory = new HttpComponentsClientHttpRequestFactory();
		factory.setConnectTimeout(connectTimeoutMs);
		factory.setReadTimeout(readTimeoutMs);
		return new RestTemplate(factory);
	}
}

