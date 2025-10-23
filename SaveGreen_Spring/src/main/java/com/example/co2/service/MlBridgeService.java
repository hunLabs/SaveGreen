package com.example.co2.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriUtils;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;
import java.util.stream.Stream;

/* ============================================================
 * MlBridgeService
 * ------------------------------------------------------------
 * [역할/설계]
 * - Spring → FastAPI 간 HTTP 호출을 캡슐화(프록시).
 * - FastAPI가 파일(JSONL)로 남긴 런타임 로그를 서버에서 직접 tail하여
 *   프론트로 JSON(Map) 배열을 반환(브라우저 대용량 파일 파싱 부담 제거).
 *
 * [설정 키(application.properties)]
 * - savegreen.ml.baseUrl      : FastAPI 베이스 URL (예: http://127.0.0.1:8000)
 * - savegreen.ml.logs.root    : JSONL 로그 루트(예: logs/app 또는 D:/co2/ml/logs/app)
 * - savegreen.ml.timeout.ms   : 연결/읽기 타임아웃(ms)
 *
 * [공개 메서드]
 * - predict(payload, variant) : POST /predict?variant=...
 * - startTrain()              : POST /train
 * - getTrainStatus(jobId)     : GET  /train/status?jobId=...
 * - tailLatestLogs(lastN)     : 최근 JSONL 파일 tail → { ok, path, count, lastEntry, lastN[] }
 *
 * [검색 앵커]
 * - [SG-ANCHOR:MLBRIDGE-SERVICE]
 * - [SG-ANCHOR:MLBRIDGE-PREDICT]
 * - [SG-ANCHOR:MLBRIDGE-TRAIN]
 * - [SG-ANCHOR:MLBRIDGE-STATUS]
 * - [SG-ANCHOR:MLBRIDGE-LOGS]
 *
 * [주의]
 * - 파일 인코딩은 UTF-8 가정. 깨진 라인은 스킵.
 * - 파일 경합(쓰기 중 읽기) 발생 시 예외를 억제하고 가능한 라인만 반환.
 * ============================================================ */
@Service
public class MlBridgeService { // [SG-ANCHOR:MLBRIDGE-SERVICE]

    private final RestTemplate rest;
    private final String baseUrl;
    private final Path logsRoot;

    // [SG-ANCHOR:MLBRIDGE-SERVICE] — 생성자(타임아웃 최신 방식 적용)
    public MlBridgeService(
            @Value("${savegreen.ml.baseUrl}") String baseUrl,
            @Value("${savegreen.ml.logs.root}") String logsRoot,
            @Value("${savegreen.ml.timeout.ms:5000}") long timeoutMs
    ) {
        // RestTemplateBuilder의 setConnectTimeout/setReadTimeout은 제거 예정 → requestFactory로 대체
        this.rest = new RestTemplateBuilder()
                .requestFactory(() -> {
                    // 간단/표준 방식: JDK 기본 팩토리 사용
                    org.springframework.http.client.SimpleClientHttpRequestFactory f =
                            new org.springframework.http.client.SimpleClientHttpRequestFactory();

                    // Spring 6.x에서는 Duration 지원. (환경에 따라 int ms 오버로드도 있습니다.)
                    f.setConnectTimeout(java.time.Duration.ofMillis(timeoutMs));
                    f.setReadTimeout(java.time.Duration.ofMillis(timeoutMs));
                    return f;
                })
                .build();

        this.baseUrl = java.util.Objects.requireNonNull(baseUrl, "savegreen.ml.baseUrl must not be null");
        this.logsRoot = java.nio.file.Paths.get(
                java.util.Objects.requireNonNull(logsRoot, "savegreen.ml.logs.root must not be null")
        );
    }


    /* ------------------------------------------------------------
     * 예측 호출 (POST /predict?variant=...)
     * - 입력 payload(Map)를 FastAPI로 그대로 전달
     * - 예외 발생 시 { ok:false, error } 반환
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLBRIDGE-PREDICT]
    public Map<String, Object> predict(Map<String, Object> payload, String variant) {
        final String v = (variant == null || variant.isBlank()) ? "C" : variant;
        final String url = String.format("%s/predict?variant=%s", baseUrl,
                org.springframework.web.util.UriUtils.encodeQueryParam(v, java.nio.charset.StandardCharsets.UTF_8));

        try {
            org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.set(org.springframework.http.HttpHeaders.CONTENT_TYPE, org.springframework.http.MediaType.APPLICATION_JSON_VALUE);
            org.springframework.http.HttpEntity<Map<String, Object>> entity = new org.springframework.http.HttpEntity<>(payload, headers);

            org.springframework.http.ResponseEntity<Map<String, Object>> rsp =
                    rest.exchange(
                            url,
                            org.springframework.http.HttpMethod.POST,
                            entity,
                            new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {}
                    );

            Map<String, Object> body = rsp.getBody();
            return (body != null) ? body : java.util.Map.of("ok", false, "error", "empty body");

        } catch (org.springframework.web.client.RestClientException ex) {
            return java.util.Map.of("ok", false, "error", ex.getMessage());
        }
    }

    /* ------------------------------------------------------------
     * 학습 시작 (POST /train)
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLBRIDGE-TRAIN]
    // FastAPI /train 트리거. 서버가 background/async 파라미터를 모르면 무시됨(문제 없음).
    public Map<String, Object> startTrain() {
        final String url = baseUrl + "/train?background=1&mode=async";
        try {
            org.springframework.http.ResponseEntity<Map<String, Object>> rsp =
                    rest.exchange(
                            url,
                            org.springframework.http.HttpMethod.POST,
                            new org.springframework.http.HttpEntity<>(null),
                            new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {}
                    );
            Map<String, Object> body = rsp.getBody();
            return (body != null) ? body : java.util.Map.of("ok", true, "note", "empty body from train");
        } catch (org.springframework.web.client.RestClientException ex) {
            return java.util.Map.of("ok", false, "error", ex.getMessage());
        }
    }



    /* ------------------------------------------------------------
     * 학습 상태 (GET /train/status?jobId=...)
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLBRIDGE-STATUS]
    // [SG-ANCHOR:MLBRIDGE-STATUS]
    public Map<String, Object> getTrainStatus(String jobId) {
        final String url = String.format("%s/train/status?jobId=%s", baseUrl,
                org.springframework.web.util.UriUtils.encodeQueryParam(jobId, java.nio.charset.StandardCharsets.UTF_8));

        try {
            org.springframework.http.ResponseEntity<Map<String, Object>> rsp =
                    rest.exchange(
                            url,
                            org.springframework.http.HttpMethod.GET,
                            org.springframework.http.HttpEntity.EMPTY,
                            new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {}
                    );

            Map<String, Object> body = rsp.getBody();
            return (body != null) ? body : java.util.Map.of("ok", false, "error", "empty body");

        } catch (org.springframework.web.client.RestClientException ex) {
            return java.util.Map.of("ok", false, "error", ex.getMessage());
        }
    }


    /* ------------------------------------------------------------
     * 최근 JSONL 로그 tail(lastN)
     * - 오늘(KST) 파일(YYYY-MM-DD.jsonl) 우선, 없으면 디렉토리 최신 *.jsonl
     * - 깨진 라인은 스킵(내구성 우선)
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLBRIDGE-LOGS]
    public Map<String, Object> tailLatestLogs(int lastN) {
        try {
            Path target = pickLatestJsonlKstAware();
            if (target == null || !Files.exists(target)) {
                return Map.of("ok", false,
                        "error", "No JSONL logs found under " + logsRoot.toAbsolutePath());
            }
            List<Map<String, Object>> rows = tailJsonl(target, Math.max(1, Math.min(lastN, 500)));
            Map<String, Object> last = rows.isEmpty() ? Map.of() : rows.get(rows.size() - 1);
            return Map.of(
                    "ok", true,
                    "path", target.toAbsolutePath().toString(),
                    "count", rows.size(),
                    "lastEntry", last,
                    "lastN", rows
            );
        } catch (Exception ex) {
            return Map.of("ok", false, "error", ex.getMessage());
        }
    }

    /* ============================================================
     * 내부 유틸: 로그 파일 선택/읽기
     * ============================================================ */

    // 오늘(KST) 파일(YYYY-MM-DD.jsonl) 우선 → 없으면 최신 *.jsonl
    private Path pickLatestJsonlKstAware() throws IOException {
        ZoneId KST = ZoneId.of("Asia/Seoul");
        String today = ZonedDateTime.now(KST).toLocalDate().toString(); // YYYY-MM-DD
        Path todayPath = logsRoot.resolve(today + ".jsonl");
        if (Files.exists(todayPath)) return todayPath;

        if (!Files.exists(logsRoot) || !Files.isDirectory(logsRoot)) return null;
        try (Stream<Path> s = Files.list(logsRoot)) {
            return s.filter(p -> p.getFileName().toString().toLowerCase().endsWith(".jsonl"))
                    .max(Comparator.comparingLong(p -> p.toFile().lastModified()))
                    .orElse(null);
        }
    }

    // [SG-ANCHOR:MLBRIDGE-JSONL-PARSE]
    // 파일 끝에서부터 lastN 라인을 효율적으로 읽고(JSONL) Map으로 파싱
    // - 제네릭 타입 명시(TypeReference)로 unchecked 경고 제거
    // - BOM/주석 라인 무시, 깨진 라인은 스킵(내구성)
    // - 파싱 직후 숫자 스칼라 타입을 Double로 정규화(타입 매핑 미스 방지)
    private List<Map<String, Object>> tailJsonl(Path path, int lastN) throws IOException {
        // 오래된→최신 순으로 tail 라인 확보
        List<String> lines = readLastLines(path, lastN);

        final com.fasterxml.jackson.databind.ObjectMapper om =
                new com.fasterxml.jackson.databind.ObjectMapper();
        final com.fasterxml.jackson.core.type.TypeReference<java.util.Map<String, Object>> T =
                new com.fasterxml.jackson.core.type.TypeReference<java.util.Map<String, Object>>() {};

        List<Map<String, Object>> out = new ArrayList<>(lines.size());

        for (String raw : lines) {
            if (raw == null) continue;
            String s = raw.trim();
            if (s.isEmpty()) continue;

            // BOM 방어
            if (!s.isEmpty() && s.charAt(0) == '\uFEFF') {
                s = s.substring(1);
                if (s.isEmpty()) continue;
            }
            // 주석 라인 방어
            if (s.startsWith("#") || s.startsWith("//")) continue;

            try {
                Map<String, Object> obj = om.readValue(s, T);	// 안전 파싱
                if (obj != null && !obj.isEmpty()) {
                    // [핵심] 숫자 타입 정규화: Integer/Long/BigDecimal → Double
                    //       (DTO/FE 쪽이 List<Double> 가정할 때 타입 미스 방지)
                    @SuppressWarnings("unchecked")
                    Map<String, Object> normalized = (Map<String, Object>) normalizeNumberTypes(obj);
                    out.add(normalized);
                }
            } catch (Exception ignore) {
                // 부분 기록 등 깨진 라인은 스킵
            }
        }
        return out;
    }



    // RandomAccessFile로 tail 구현(오래된→최신 순서로 반환)
    private List<String> readLastLines(Path path, int lastN) throws IOException {
        List<String> lines = new ArrayList<>(lastN);
        try (RandomAccessFile raf = new RandomAccessFile(path.toFile(), "r")) {
            long pos = raf.length() - 1;
            int count = 0;
            StringBuilder sb = new StringBuilder();

            while (pos >= 0 && count < lastN) {
                raf.seek(pos);
                int c = raf.read();
                if (c == '\n') {
                    if (sb.length() > 0) {
                        lines.add(sb.reverse().toString());
                        sb.setLength(0);
                        count++;
                    }
                } else if (c != '\r') {
                    sb.append((char) c);
                }
                pos--;
            }
            if (sb.length() > 0 && count < lastN) {
                lines.add(sb.reverse().toString());
            }
        }
        Collections.reverse(lines);
        return lines;
    }

    // [SG-ANCHOR:MLBRIDGE-NUM-NORMALIZE]
// JSON(Map/List) 트리를 순회하면서 숫자 스칼라를 Double로 정규화한다.
// - 이유: JSON 파서가 상황에 따라 Integer/Long/BigDecimal/Double을 섞어 줄 수 있음
//         → DTO(List<Double>) 또는 FE(차트 데이터)에서 타입 미스(ClassCastException/NaN) 유발
// - 동작: Number면 doubleValue()로 박싱(Double), Map/List는 재귀 처리, 그 외는 그대로 반환
    private Object normalizeNumberTypes(Object v) {
        if (v == null) return null;

        if (v instanceof Number num) {
            return Double.valueOf(num.doubleValue());
        }
        if (v instanceof Map<?, ?> map) {
            Map<String, Object> m2 = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : map.entrySet()) {
                String key = String.valueOf(e.getKey());
                m2.put(key, normalizeNumberTypes(e.getValue()));
            }
            return m2;
        }
        if (v instanceof List<?> list) {
            List<Object> l2 = new ArrayList<>(list.size());
            for (Object o : list) {
                l2.add(normalizeNumberTypes(o));
            }
            return l2;
        }
        // String/Boolean 등은 그대로
        return v;
    }

}
