// src/main/java/com/example/co2/config/WebCorsConfig.java
// ============================================================================
// 전역 CORS 설정
// - /api/forecast/ml/** 하위 모든 엔드포인트에 대해
//   FE 도메인에서의 GET/POST/OPTIONS 요청을 허용한다.
// - 프리플라이트(OPTIONS)까지 허용해야 브라우저가 405/403을 내지 않는다.
// ============================================================================
package com.example.co2.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebCorsConfig implements WebMvcConfigurer {

	@Override
	public void addCorsMappings(CorsRegistry registry) {
		registry.addMapping("/api/forecast/ml/**")
				.allowedOrigins(
						"http://localhost:3000",
						"http://127.0.0.1:3000"
				)
				.allowedMethods("GET", "POST", "OPTIONS")
				.allowedHeaders("*")
				.allowCredentials(true)
				.maxAge(3600);
	}
}
