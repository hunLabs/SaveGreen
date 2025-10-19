// src/main/java/com/example/co2/service/MlBridgeService.java
// ============================================================================
// SaveGreen / MlBridgeService
// ----------------------------------------------------------------------------
// [역할]
// - 표준화된 PredictRequest를 FastAPI(/predict)에 POST로 전달하고,
//   PredictResponse를 받아 FE로 반환한다.
// - 네트워크 오류/타임아웃/비정상 응답(Non-2xx)에 대해 일관된 폴백을 제공한다.
//
// [설계 메모]
// - RestTemplate은 HttpConfig에서 주입받는다(추가 의존성 無).
// - 추후 성능/기능 필요 시 WebClient(Reactor) 또는 Apache HttpClient5 팩토리로 교체 가능.
// ============================================================================

package com.example.co2.service;

import com.example.co2.dto.PredictDtos.PredictRequest;
import com.example.co2.dto.PredictDtos.PredictResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
@RequiredArgsConstructor
public class MlBridgeService {

    private final RestTemplate restTemplate;

    @Value("${ml.base-url}")
    private String mlBaseUrl;

    /**
     * FastAPI /predict 호출
     * @param req 표준화된 입력
     * @return 예측 결과(실패 시 폴백)
     */
    public PredictResponse predict(PredictRequest req) {
        try {
            String url = mlBaseUrl + "/predict";

            // 1) 요청 헤더 설정(JSON)
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            // 2) HTTP 엔터티 구성
            HttpEntity<PredictRequest> entity = new HttpEntity<>(req, headers);

            // 3) 호출
            ResponseEntity<PredictResponse> resp =
                    restTemplate.exchange(url, HttpMethod.POST, entity, PredictResponse.class);

            // 4) 응답 검증
            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                return resp.getBody();
            }
            return fallback("non-2xx");
        } catch (Exception e) {
            // 연결/타임아웃/직렬화 등 모든 예외를 안전 폴백으로 감싼다.
            return fallback(e.getClass().getSimpleName());
        }
    }

    /** 차트/화면이 깨지지 않도록 하는 안전 폴백 */
    private PredictResponse fallback(String reason) {
        // TODO: 운영 시에는 로깅/알림(Slack/Sentry) 등과 연동하는 것을 권장
        return PredictResponse.builder()
                .savingKwhYr(0)
                .savingCostYr(0)
                .savingPct(0)
                .paybackYears(99)
                .label("NOT_RECOMMEND")
                .build();
    }
}
