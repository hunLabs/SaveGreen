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
 *   2) POST /train                → 학습 시작(비동기 응답 형식으로 202 반환)
 *   3) GET  /train/status?jobId=… → 학습 상태 폴링
 *   4) GET  /logs/latest?lastN=50 → 최근 JSONL 로그 tail
 *   5) GET  /logs/by-run?runId=…  → 특정 run 로그 집합
 *   6) GET  /run/current          → 서버가 기억하는 최신 run_id
 *
 * [응답 포맷]
 * - 모든 핸들러는 ResponseEntity<Map<String,Object>> (리스트는 List<Map<..>>)로 통일
 *   → 제네릭 추론 에러 회피 및 FE 단순화
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
@RequestMapping("/api/forecast/ml") // [SG-ANCHOR:MLCTRL-CLASS]
public class ForecastMlController {

	private final MlBridgeService ml;

	// [ADD][SG-MLCTRL] 가장 최근 run_id(jobId) 보관 (프로세스 단위 기억)
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
	 * 2) 학습 시작(비동기 응답)
	 *    POST /api/forecast/ml/train
	 *  - 변경점:
	 *    (1) FastAPI /train을 먼저 호출하여 jobId/run_id 확보
	 *    (2) 응답 JSON에 jobId와 run_id를 동일 값(접두어 없음)으로 내려 FE가 즉시 setRunId 가능
	 *    (3) lastRunId 에 고정(pinning)
	 * ------------------------------------------------------------ */
	// [SG-ANCHOR:ML-TRAIN-ASYNC]
	@PostMapping("/train")
	public ResponseEntity<Map<String, Object>> startTrainAsync() {
		// 1) FastAPI → /train 호출 (동기). 예: { "jobId": "20251024-094930-A10C45" }
		Map<String, Object> rsp = ml.startTrain();

		String rid = null;
		if (rsp != null) {
			Object v = rsp.get("run_id"); if (v == null) v = rsp.get("runId");
			if (v == null) v = rsp.get("jobId");
			if (v != null) rid = String.valueOf(v);
		}

		// 2) 보수적으로 tail에서 보강 (응답이 비었을 때)
		if (rid == null || rid.isBlank()) {
			rid = sniffLatestRunIdFromTail(); // 기존 유틸 그대로 사용
		}

		// 3) 마지막 수단: 직접 생성 (접두어 없이) — 매우 드물게만 사용
		if (rid == null || rid.isBlank()) {
			rid = java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Seoul"))
					.format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))
					+ "-" + java.util.UUID.randomUUID().toString().substring(0, 6).toUpperCase();
		}

		// 4) run_id 고정 (로그/상태/FE 모두 같은 값 사용)
		lastRunId.set(rid);

		// 5) FE로 즉시 회신 (★ 접두어 없음, jobId==run_id)
		Map<String, Object> ack = new java.util.LinkedHashMap<>();
		ack.put("ok", true);
		ack.put("accepted", true);
		ack.put("jobId", rid);   // ★ "train-" 같은 접두어 금지
		ack.put("run_id", rid);  // ★ FE가 곧바로 SaveGreen.MLLogs.setRunId(rid)
		return ResponseEntity.accepted().body(ack);
	}

	/* ------------------------------------------------------------
	 * 3) 학습 상태 조회
	 *    GET /api/forecast/ml/train/status?jobId=...
	 *  - 변경점: 과거 링크에서 온 jobId가 'train-...' 형태여도 안전하게 처리
	 *            (접두어 제거 후 FastAPI에 전달, 응답에 run_id 보강)
	 * ------------------------------------------------------------ */
	// [SG-ANCHOR:MLCTRL-STATUS]
	@GetMapping("/train/status")
	public ResponseEntity<Map<String, Object>> trainStatus(@RequestParam("jobId") String jobId) {
		// ★ 접두어 train- 제거 (과거 북마크/링크 대비)
		String baseId = (jobId != null && jobId.startsWith("train-")) ? jobId.substring(6) : jobId;

		Map<String, Object> body = ml.getTrainStatus(baseId);
		if (body == null) body = new java.util.LinkedHashMap<>();
		// FE 복구용 run_id 보강
		body.putIfAbsent("run_id", baseId);
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

	/* ------------------------------------------------------------
	 * 5) 특정 run 로그 제공
	 *    GET /api/forecast/ml/logs/by-run?runId=...
	 *  - 변경점: runId가 'train-...' 이어도 접두어 제거 후 매칭
	 *  - 매칭: tags.run_id → top-level run_id 순으로 검사(둘 다 허용)
	 * ------------------------------------------------------------ */
	// [SG-ANCHOR:MLCTRL-LOGS-BYRUN]
	@GetMapping("/logs/by-run")
	public ResponseEntity<List<Map<String, Object>>> logsByRun(@RequestParam("runId") String runId) {
		if (runId == null || runId.isBlank()) return ResponseEntity.ok(List.of());

		// ★ 접두어 제거
		if (runId.startsWith("train-")) runId = runId.substring(6);

		Map<String, Object> latest = ml.tailLatestLogs(2000); // tail 넉넉히
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

			// (선택) type=="metrics"만 반환하려면 아래 주석 해제
			// if (!"metrics".equals(String.valueOf(m.get("type")))) continue;

			all.add(m);
		}
		return ResponseEntity.ok(all);
	}

	// [추가] 로그 디렉터리 주입(없으면 기본값 logs/app)
	@org.springframework.beans.factory.annotation.Value("${app.ml.logs.dir:logs/app}")
	private String mlLogsDir;

	// [추가] 최신 JSONL 파일에서 최근 N줄 읽기(간단 버전)
	private java.util.List<String> readLastLines(java.nio.file.Path file, int limit) throws java.io.IOException {
		java.util.List<String> all = java.nio.file.Files.readAllLines(file);
		int size = all.size();
		int from = Math.max(0, size - limit);
		return all.subList(from, size);
	}

	// [추가] 디렉터리에서 가장 최근 JSONL 파일 찾기
	private java.nio.file.Path findLatestJsonl(java.nio.file.Path dir) throws java.io.IOException {
		try (java.util.stream.Stream<java.nio.file.Path> s = java.nio.file.Files.list(dir)) {
			return s.filter(p -> java.nio.file.Files.isRegularFile(p) && p.getFileName().toString().endsWith(".jsonl"))
					.max(java.util.Comparator.comparingLong(p -> {
						try { return java.nio.file.Files.getLastModifiedTime(p).toMillis(); }
						catch (Exception e) { return 0L; }
					}))
					.orElse(null);
		}
	}

	// [추가] GET /api/forecast/ml/logs/latest  → predict_variant(건물별) + 학습 메트릭 전달
	@org.springframework.web.bind.annotation.GetMapping("/api/forecast/ml/logs/latest")
	public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> getLatestMlLogs(
			@org.springframework.web.bind.annotation.RequestParam(name = "limit", required = false, defaultValue = "300") int limit,
			@org.springframework.web.bind.annotation.RequestParam(name = "event", required = false, defaultValue = "") String eventFilter
	) {
		java.util.Map<String, Object> body = new java.util.HashMap<>();
		java.util.List<java.util.Map<String, Object>> events = new java.util.ArrayList<>();
		body.put("events", events);

		try {
			java.nio.file.Path dir = java.nio.file.Paths.get(mlLogsDir);
			if (!java.nio.file.Files.isDirectory(dir)) {
				body.put("error", "log dir not found: " + dir.toAbsolutePath());
				return org.springframework.http.ResponseEntity.ok(body);
			}
			java.nio.file.Path latest = findLatestJsonl(dir);
			if (latest == null) {
				body.put("info", "no jsonl files in " + dir.toAbsolutePath());
				return org.springframework.http.ResponseEntity.ok(body);
			}

			com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
			for (String line : readLastLines(latest, limit)) {
				line = line.trim();
				if (line.isEmpty()) continue;
				try {
					com.fasterxml.jackson.databind.JsonNode n = om.readTree(line);

					// 기본 필드 추출
					String ev = n.path("event").asText("");
					if (!eventFilter.isEmpty() && !eventFilter.equals(ev)) continue;

					java.util.Map<String, Object> one = new java.util.HashMap<>();
					one.put("ts", n.path("ts").asText(""));
					one.put("event", ev);

					// tags(chart/run_id)와 payload(variant/savingPct 등)만 골라서 전달
					com.fasterxml.jackson.databind.JsonNode tags = n.path("tags");
					if (!tags.isMissingNode() && tags.isObject()) {
						if (tags.has("chart")) one.put("chart", tags.get("chart").asText(""));
						if (tags.has("run_id")) one.put("runId", tags.get("run_id").asText(""));
					}
					com.fasterxml.jackson.databind.JsonNode payload = n.path("payload");
					if (!payload.isMissingNode() && payload.isObject()) {
						if (payload.has("variant")) one.put("variant", payload.get("variant").asText(""));
						if (payload.has("savingPct")) one.put("savingPct", payload.get("savingPct").asDouble());
						if (payload.has("buildingName")) one.put("buildingName", payload.get("buildingName").asText(""));
						if (payload.has("pnu")) one.put("pnu", payload.get("pnu").asText(""));
						if (payload.has("floorAreaM2")) one.put("floorAreaM2", payload.get("floorAreaM2").asDouble());
						if (payload.has("builtYear")) one.put("builtYear", payload.get("builtYear").asDouble());
					}

					// 학습 메트릭(train/test)도 그대로 통과(필요 시 FE에서 거를 수 있게)
					com.fasterxml.jackson.databind.JsonNode metrics = n.path("metrics");
					if (!metrics.isMissingNode() && metrics.isObject()) {
						java.util.Map<String, Object> m = om.convertValue(metrics, java.util.Map.class);
						one.put("metrics", m);
					}

					events.add(one);
				} catch (Exception ignore) {
					// 파싱 실패 라인 무시
				}
			}

			return org.springframework.http.ResponseEntity.ok(body);
		} catch (Exception e) {
			body.put("error", e.getMessage());
			return org.springframework.http.ResponseEntity.ok(body);
		}
	}


	// 웹 페이지 console log에 뜨는 (GET http://localhost:8080/favicon.ico 404) 에러 제거
	@RestController
	static class RootAuxController {
		@GetMapping("/favicon.ico")
		public ResponseEntity<Void> faviconNoop() {
			return ResponseEntity.noContent().build(); // 204 No Content
		}
	}



}
