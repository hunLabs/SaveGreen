// src/main/java/com/example/co2/config/HttpConfig.java
// ============================================================================
// SaveGreen / HTTP Client Config
// ----------------------------------------------------------------------------
// [역할]
// - 스프링에서 사용할 표준 HTTP 클라이언트(= RestTemplate) 빈을 생성한다.
// - 추가 외부 의존성 없이 JDK 기본 HttpURLConnection을 사용하는
//   SimpleClientHttpRequestFactory 기반으로 구성하여, 환경 의존성을 낮춘다.
//
// [왜 RestTemplate를 여기서 만들까?]
// - 서비스(MlBridgeService) 내부에서 @Bean을 만들면 순환 의존/테스트 분리가 어려움.
// - 설정은 설정대로 @Configuration 클래스로 분리하는 것이 유지보수/테스트에 유리.
//
// [타임아웃 관리]
// - application.properties(.yml)에서 주입:
//     ml.timeout-ms.connect=1500
//     ml.timeout-ms.read=3000
// - connectTimeout: 서버에 "연결"될 때까지 기다리는 최대 시간(ms)
// - readTimeout   : 요청 전송 후 "응답 바디"를 읽을 때까지 기다리는 최대 시간(ms)
//
// [운영 팁]
// - 프록시가 필요한 환경이라면 SimpleClientHttpRequestFactory#setProxy(...) 사용.
// - 공통 헤더(예: User-Agent)나 로깅이 필요하면 ClientHttpRequestInterceptor를
//   RestTemplate에 추가해도 된다.
// - 더 고급 옵션(커넥션 풀, HTTP/2 등)이 필요하면 Apache HttpClient5 의존성을
//   추가한 뒤 HttpComponentsClientHttpRequestFactory로 교체하면 된다.
// ============================================================================

package com.example.co2.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;

@Configuration
public class HttpConfig {

    @Bean
    public RestTemplate restTemplate(
            @Value("${ml.timeout-ms.connect:1500}") int connectTimeoutMs,
            @Value("${ml.timeout-ms.read:3000}") int readTimeoutMs
    ) {
        // 1) 팩토리 구성: JDK 기본 HttpURLConnection 기반
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(connectTimeoutMs);
        f.setReadTimeout(readTimeoutMs);

        // 2) RestTemplate 생성
        RestTemplate rt = new RestTemplate(f);

        // (선택) 3) 에러 핸들러 설정
        // - DefaultResponseErrorHandler는 4xx/5xx에서 예외를 던진다.
        // - 우리는 서비스 레벨에서 try/catch로 폴백 처리하므로 기본값 유지.
        rt.setErrorHandler(new DefaultResponseErrorHandler());

        // (선택) 4) 인터셉터 추가 예시 — 공통 헤더/로깅이 필요할 때 사용
        // rt.getInterceptors().add((request, body, execution) -> {
        // 	request.getHeaders().add("User-Agent", "SaveGreen-Bridge/1.0");
        // 	return execution.execute(request, body);
        // });

        return rt;
    }

    // (참고) 팩토리를 커스터마이즈할 일이 더 많아지면 분리해도 좋다.
    @SuppressWarnings("unused")
    private ClientHttpRequestFactory makeFactory(int connectTimeoutMs, int readTimeoutMs) {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(connectTimeoutMs);
        f.setReadTimeout(readTimeoutMs);
        return f;
    }
}
