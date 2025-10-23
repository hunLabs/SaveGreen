package com.example.co2.api;

import com.example.co2.service.MlBridgeService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.List;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicReference;
import java.util.Objects;
import java.util.Comparator;

/* ============================================================
 * ForecastMlController
 * ------------------------------------------------------------
 * [역할/설계]
 * - 프론트엔드가 직접 FastAPI에 접근하지 않고 Spring을 통해
 *   예측/학습/상태/로그를 조회할 수 있도록 "프록시 + 로그 서빙" API 제공.
 *
 * [경로 정책]
 * - 클래스 레벨 prefix: /api/forecast/ml  (중복 매핑 금지)
 * - 하위 엔드포인트:
 *   1) POST /predict?variant=C    → 예측
 *   2) POST /train                → 학습 시작(비동기)
 *   3) GET  /train/status?jobId=… → 학습 상태 폴링
 *   4) GET  /logs/latest?lastN=50 → 최근 JSONL 로그 tail
 *
 * [응답 포맷]
 * - 모든 핸들러는 ResponseEntity<Map<String,Object>> 로 통일
 *   (제네릭 추론 에러 회피 및 FE 단순화)
 *
 * [숫자 유효성]
 * - Double.isFinite(double) "정적 메서드"만 사용(인스턴스 호출 금지)
 *
 * [검색 앵커]
 * - [SG-ANCHOR:MLCTRL-CLASS]
 * - [SG-ANCHOR:MLCTRL-PREDICT]
 * - [SG-ANCHOR:MLCTRL-TRAIN]
 * - [SG-ANCHOR:MLCTRL-STATUS]
 * - [SG-ANCHOR:MLCTRL-LOGS]
 * ============================================================ */
@RestController
@RequestMapping("/api/forecast/ml")	// [SG-ANCHOR:MLCTRL-CLASS]
public class ForecastMlController {

    private final MlBridgeService ml;

    // [ADD][SG-MLCTRL] 가장 최근 run_id(jobId) 보관 (프로세스 단위)
    private final AtomicReference<String> lastRunId = new AtomicReference<>(null);

    public ForecastMlController(MlBridgeService ml) {
        this.ml = ml;
    }

    /* ------------------------------------------------------------
     * 1) 예측 호출
     *    POST /api/forecast/ml/predict?variant=C
     *  - 프론트 JSON을 그대로 FastAPI로 전달(패스스루).
     *  - 숫자 유효성은 최소한으로 점검(예: builtYear 등).
     *  - 반환: FastAPI 응답 Map 그대로.
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLCTRL-PREDICT]
    @PostMapping("/predict")
    public ResponseEntity<Map<String, Object>> predict(
            @RequestParam(name = "variant", defaultValue = "C") String variant,
            @RequestBody Map<String, Object> payload
    ) {
        // (선택) 예시 숫자 유효성 — Double.isFinite "정적 호출"만 사용
        Object built = payload.get("builtYear");
        if (built instanceof Number) {
            double v = ((Number) built).doubleValue();
            if (!Double.isFinite(v)) {
                return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "invalid builtYear"));
            }
        }
        Map<String, Object> body = ml.predict(payload, variant);
        return ResponseEntity.ok(body);
    }

    /* ------------------------------------------------------------
     * 2) 학습 시작(비동기)
     *    POST /api/forecast/ml/train
     *    - 바로 202 Accepted 응답 반환
     *    - 학습 호출은 백그라운드 스레드에서 실행(응답 대기 X)
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:ML-TRAIN-ASYNC]
    // ★ 변경 전에는 lastRunId.set(jobId)만 하고 끝났음

    @PostMapping("/train")
    public ResponseEntity<Map<String, Object>> startTrainAsync() {
        final String jobId = "train-" + java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Seoul"))
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + "-"
                + java.util.UUID.randomUUID().toString().substring(0, 8);

        // (선택) 임시값으로 넣어두되, 나중에 반드시 ML run_id로 덮어씌웁니다.
        lastRunId.set(jobId);

        final Map<String, Object> ack = new java.util.LinkedHashMap<>();
        ack.put("ok", true);
        ack.put("accepted", true);
        ack.put("jobId", jobId);
        // FE 호환 키
        ack.put("run_id", jobId);
        ack.put("runId", jobId);

        // ← 백그라운드 스레드에서 ML 트리거 후, 응답으로 받은 run_id 저장
        new Thread(() -> {
            try {
                Map<String, Object> rsp = ml.startTrain();   // FastAPI /train 호출
                // ① ML이 돌려준 run_id/runId 우선 저장
                String rid = null;
                if (rsp != null) {
                    Object v = rsp.get("run_id"); if (v == null) v = rsp.get("runId");
                    if (v != null) rid = String.valueOf(v);
                }
                // ② 못 받았으면 로그 tail에서 추정
                if (rid == null || rid.isBlank()) {
                    rid = sniffLatestRunIdFromTail();
                }
                if (rid != null && !rid.isBlank()) {
                    lastRunId.set(rid); // ★★★ 여기서 진짜 run_id로 덮어쓰기 ★★★
                    org.slf4j.LoggerFactory.getLogger(getClass())
                            .info("ML-TRAIN run_id pinned: {}", rid);
                } else {
                    org.slf4j.LoggerFactory.getLogger(getClass())
                            .warn("ML-TRAIN run_id not found; stay with jobId={}", jobId);
                }
            } catch (Exception ex) {
                org.slf4j.LoggerFactory.getLogger(getClass()).warn("ML-TRAIN bg failed: {}", ex.toString());
            }
        }, "ml-train-bg-" + jobId).start();

        return ResponseEntity.accepted().body(ack);
    }




    /* ------------------------------------------------------------
     * 3) 학습 상태 조회
     *    GET /api/forecast/ml/train/status?jobId=...
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLCTRL-STATUS]
    @GetMapping("/train/status")
    public ResponseEntity<Map<String, Object>> trainStatus(@RequestParam("jobId") String jobId) {
        Map<String, Object> body = ml.getTrainStatus(jobId);
        return ResponseEntity.ok(body);
    }

    // ==== [HELPER] 최근 로그에서 가장 최신 run_id 추정(sniff) ====
    @SuppressWarnings("unchecked")
    private String sniffLatestRunIdFromTail() {
        try {
            Map<String, Object> latest = ml.tailLatestLogs(1000); // tail 크게
            if (latest == null) return null;

            // lastN / items / lines 중 있는 걸 사용
            Object any = latest.get("lastN");
            if (!(any instanceof java.util.List<?>)) {
                any = (latest.get("items") instanceof java.util.List<?>)
                        ? latest.get("items") : latest.get("lines");
            }
            if (!(any instanceof java.util.List<?> list)) return null;

            // ts 내림차순으로 훑으며 run_id 찾기 (train_start 우선)
            return list.stream()
                    .filter(Map.class::isInstance)
                    .map(o -> (Map<String, Object>) o)
                    .sorted(Comparator.comparing(
                            (Map<String, Object> m) -> {
                                Object ts = m.get("ts");
                                return (ts != null) ? String.valueOf(ts) : "";
                            }
                    ).reversed())

                    .map(m -> {
                        String rid = null;
                        Object tags = m.get("tags");
                        if (tags instanceof Map<?, ?> t) {
                            Object v = ((Map<?, ?>) t).get("run_id");
                            if (v == null) v = ((Map<?, ?>) t).get("runId");
                            if (v != null) rid = String.valueOf(v);
                        }
                        if (rid == null) { // 혹시 top-level에 있는 경우
                            Object v = m.get("run_id");
                            if (v == null) v = m.get("runId");
                            if (v != null) rid = String.valueOf(v);
                        }
                        String kind = String.valueOf(m.get("kind"));
                        String type = String.valueOf(m.get("type"));
                        // 우선순위: train_start(event) > metrics(score_* / cv)
                        boolean meaningful = "event".equals(type) && "train_start".equals(kind)
                                || ("metrics".equals(type) && (
                                "score_train".equals(kind) || "score_test".equals(kind) || "cv".equals(kind)
                        ));
                        return (rid != null && meaningful) ? rid : null;
                    })
                    .filter(Objects::nonNull)
                    .findFirst()
                    .orElse(null);
        } catch (Exception ignore) {
            return null;
        }
    }


    // [SG-ANCHOR:MLCTRL-RUN-CURRENT]
    // 프론트: GET /api/forecast/ml/run/current
    @GetMapping("/run/current")
    public ResponseEntity<Map<String, Object>> getCurrentRun() {
        String id = lastRunId.get();
        if (id == null || id.isBlank()) {
            // ★ 서버가 기억 못했으면 최근 로그에서 추정
            id = sniffLatestRunIdFromTail();
            if (id != null) lastRunId.set(id);
        }
        Map<String, Object> out = new HashMap<>();
        if (id == null || id.isBlank()) {
            out.put("ok", false);
            out.put("run_id", null);
            out.put("runId", null);
            return ResponseEntity.status(404).body(out);
        }
        out.put("ok", true);
        out.put("run_id", id);
        out.put("runId", id);
        return ResponseEntity.ok(out);
    }



    /* ------------------------------------------------------------
     * 4) 최근 로그 제공(JSONL tail)
     *    GET /api/forecast/ml/logs/latest?lastN=50
     *  - KST 기준 오늘 파일 우선, 없으면 디렉토리 최신 파일.
     *  - { ok, path, count, lastEntry, lastN[] } 형태로 반환.
     * ------------------------------------------------------------ */
    // [SG-ANCHOR:MLCTRL-LOGS]
    @GetMapping("/logs/latest")
    public ResponseEntity<Map<String, Object>> latestLogs(
            @RequestParam(name = "lastN", defaultValue = "50") int lastN
    ) {
        Map<String, Object> body = ml.tailLatestLogs(lastN);
        return ResponseEntity.ok(body);
    }

    // [SG-ANCHOR:MLCTRL-LOGS-BYRUN]
// GET /api/forecast/ml/logs/by-run?runId=...
    @GetMapping("/logs/by-run")
    public ResponseEntity<List<Map<String, Object>>> logsByRun(@RequestParam("runId") String runId) {
        if (runId == null || runId.isBlank()) return ResponseEntity.ok(List.of());

        Map<String, Object> latest = ml.tailLatestLogs(2000);
        List<Map<String, Object>> all = new ArrayList<>();

        Object any = (latest != null) ? latest.get("lastN") : null;
        if (!(any instanceof List<?>)) {
            any = (latest != null && latest.get("items") instanceof List<?>)
                    ? latest.get("items")
                    : (latest != null ? latest.get("lines") : null);
        }
        if (!(any instanceof List<?> list)) return ResponseEntity.ok(all);

        for (Object o : list) {
            if (!(o instanceof Map)) continue;
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) o;

            String rid = null;
            Object tags = m.get("tags");
            if (tags instanceof Map<?, ?> t) {
                Object v = t.get("run_id"); if (v == null) v = t.get("runId");
                if (v != null) rid = String.valueOf(v);
            }
            if (rid == null) { // 혹시 top-level
                Object v = m.get("run_id"); if (v == null) v = m.get("runId");
                if (v != null) rid = String.valueOf(v);
            }
            if (!runId.equals(rid)) continue;

            all.add(m);
        }
        return ResponseEntity.ok(all);
    }




}
