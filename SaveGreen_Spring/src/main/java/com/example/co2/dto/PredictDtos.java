// package com.example.forecast.api;
package com.example.co2.dto;
import java.util.List;

/* =========================================================
 * PredictDtos.java
 * ---------------------------------------------------------
 * 역할:
 * 	- /predict 요청/응답 DTO와, /train(시작/상태) DTO를 한 파일에 정리
 * 	- 기존 필드명/형태 유지(호환성), 주석만 상세 보강
 *
 * FastAPI /predict 계약(요약):
 * 	- Request
 * 		· type(string): 'factory'|'school'|'hospital'|'office' 등
 * 		· region(string)/regionRaw(string)
 * 		· builtYear(number), floorAreaM2(number)
 * 		· energy_kwh(number, opt), eui_kwh_m2y(number, opt)
 * 		· yearsFrom/yearsTo(number)
 * 		· yearlyConsumption([{year:int, electricity:number}], opt)
 * 		· monthlyConsumption([{month:int(1..12), electricity:number}], opt)
 * 		· buildingName/pnu/address(opt)
 * 	- Response
 * 		· kpi{ savingKwhYr, savingCostYr, savingPct, paybackYears, label }
 * 		· years[string[]], series{ after[], saving[] }, cost{ saving[] }
 *
 * /train DTO:
 * 	- TrainStartResponse: { jobId, error? }
 * 	- TrainStatusResponse: { jobId, status, progress?, message? }
 *
 * 들여쓰기: 탭(4칸)
 * ========================================================= */
public class PredictDtos {

	/* =========================================================
	 * Predict: Request
	 * ========================================================= */
	public static class PredictRequest {
		// 모델 타입(코어셋): factory|school|hospital|office
		private String type;

		// 지역 표기(전처리/정규화 후 사용), regionRaw는 FE 원문(로그용)
		private String region;
		private String regionRaw;

		// 건물 속성
		private Integer builtYear;	// 사용연도
		private Double floorAreaM2;	// 면적(㎡)

		// 힌트 값(있으면 사용)
		private Double energy_kwh;	// 최근연 연간 사용량(kWh)
		private Double eui_kwh_m2y;	// kWh/㎡·년

		// 예측 기간(포함 범위)
		private Integer yearsFrom;	// 시작 연도
		private Integer yearsTo;	// 종료 연도

		// 식별 보조(로그/분석용)
		private String buildingName;
		private String pnu;
		private String address;

		// 시계열(옵션)
		private List<YearPoint> yearlyConsumption;	// [{year, electricity}]
		private List<MonthPoint> monthlyConsumption;	// [{month(1..12), electricity}]

		public String getType() { return type; }
		public void setType(String type) { this.type = type; }
		public String getRegion() { return region; }
		public void setRegion(String region) { this.region = region; }
		public String getRegionRaw() { return regionRaw; }
		public void setRegionRaw(String regionRaw) { this.regionRaw = regionRaw; }
		public Integer getBuiltYear() { return builtYear; }
		public void setBuiltYear(Integer builtYear) { this.builtYear = builtYear; }
		public Double getFloorAreaM2() { return floorAreaM2; }
		public void setFloorAreaM2(Double floorAreaM2) { this.floorAreaM2 = floorAreaM2; }
		public Double getEnergy_kwh() { return energy_kwh; }
		public void setEnergy_kwh(Double energy_kwh) { this.energy_kwh = energy_kwh; }
		public Double getEui_kwh_m2y() { return eui_kwh_m2y; }
		public void setEui_kwh_m2y(Double eui_kwh_m2y) { this.eui_kwh_m2y = eui_kwh_m2y; }
		public Integer getYearsFrom() { return yearsFrom; }
		public void setYearsFrom(Integer yearsFrom) { this.yearsFrom = yearsFrom; }
		public Integer getYearsTo() { return yearsTo; }
		public void setYearsTo(Integer yearsTo) { this.yearsTo = yearsTo; }
		public String getBuildingName() { return buildingName; }
		public void setBuildingName(String buildingName) { this.buildingName = buildingName; }
		public String getPnu() { return pnu; }
		public void setPnu(String pnu) { this.pnu = pnu; }
		public String getAddress() { return address; }
		public void setAddress(String address) { this.address = address; }
		public List<YearPoint> getYearlyConsumption() { return yearlyConsumption; }
		public void setYearlyConsumption(List<YearPoint> yearlyConsumption) { this.yearlyConsumption = yearlyConsumption; }
		public List<MonthPoint> getMonthlyConsumption() { return monthlyConsumption; }
		public void setMonthlyConsumption(List<MonthPoint> monthlyConsumption) { this.monthlyConsumption = monthlyConsumption; }
	}

	/* =========================================================
	 * Predict: Response
	 * ========================================================= */
	public static class PredictResponse {
		// KPI 블록(연간 절감량/비용/절감률/회수년수/라벨)
		private Kpi kpi;

		// 예측 기간(연도 라벨)
		private List<String> years;

		// 에너지 시계열
		private Series series;	// after/saving (kWh)

		// 비용 시계열
		private Cost cost;		// saving (원)

		// 오류 메시지(오류 시에만 세팅)
		private String error;

		public Kpi getKpi() { return kpi; }
		public void setKpi(Kpi kpi) { this.kpi = kpi; }
		public List<String> getYears() { return years; }
		public void setYears(List<String> years) { this.years = years; }
		public Series getSeries() { return series; }
		public void setSeries(Series series) { this.series = series; }
		public Cost getCost() { return cost; }
		public void setCost(Cost cost) { this.cost = cost; }
		public String getError() { return error; }
		public void setError(String error) { this.error = error; }

		// [추가] 오류 응답 생성기(간편)
		public static PredictResponse error(String message) {
			PredictResponse r = new PredictResponse();
			r.setError(message);
			return r;
		}
	}

	// KPI 구조체
	public static class Kpi {
		private Double savingKwhYr;		// 연간 절감량(kWh/년)
		private Double savingCostYr;	// 연간 절감액(원/년)
		private Integer savingPct;		// 절감률(%)
		private Double paybackYears;	// 투자 회수년수(년)
		private String label;			// 등급/권장 라벨

		public Double getSavingKwhYr() { return savingKwhYr; }
		public void setSavingKwhYr(Double savingKwhYr) { this.savingKwhYr = savingKwhYr; }
		public Double getSavingCostYr() { return savingCostYr; }
		public void setSavingCostYr(Double savingCostYr) { this.savingCostYr = savingCostYr; }
		public Integer getSavingPct() { return savingPct; }
		public void setSavingPct(Integer savingPct) { this.savingPct = savingPct; }
		public Double getPaybackYears() { return paybackYears; }
		public void setPaybackYears(Double paybackYears) { this.paybackYears = paybackYears; }
		public String getLabel() { return label; }
		public void setLabel(String label) { this.label = label; }
	}

	// 에너지 시계열(after/saving)
	public static class Series {
		private List<Double> after;		// 개선 후 예상 사용량(kWh)
		private List<Double> saving;	// 절감량(kWh)

		public List<Double> getAfter() { return after; }
		public void setAfter(List<Double> after) { this.after = after; }
		public List<Double> getSaving() { return saving; }
		public void setSaving(List<Double> saving) { this.saving = saving; }
	}

	// 비용 시계열(saving)
	public static class Cost {
		private List<Double> saving;	// 절감액(원)

		public List<Double> getSaving() { return saving; }
		public void setSaving(List<Double> saving) { this.saving = saving; }
	}

	/* =========================================================
	 * 시계열 포인트 구조
	 * ========================================================= */
	public static class YearPoint {
		private Integer year;			// 연(예: 2025)
		private Double electricity;		// kWh

		public Integer getYear() { return year; }
		public void setYear(Integer year) { this.year = year; }
		public Double getElectricity() { return electricity; }
		public void setElectricity(Double electricity) { this.electricity = electricity; }
	}

	public static class MonthPoint {
		private Integer month;			// 월(1..12)
		private Double electricity;		// kWh

		public Integer getMonth() { return month; }
		public void setMonth(Integer month) { this.month = month; }
		public Double getElectricity() { return electricity; }
		public void setElectricity(Double electricity) { this.electricity = electricity; }
	}

	/* =========================================================
	 * Train: Start/Status
	 * ========================================================= */

	// 학습 시작 응답
	public static class TrainStartResponse {
		private String jobId;	// 신규 생성된 학습 식별자
		private String error;	// 오류 메시지(오류 시)

		public String getJobId() { return jobId; }
		public void setJobId(String jobId) { this.jobId = jobId; }
		public String getError() { return error; }
		public void setError(String error) { this.error = error; }

		// [추가] 오류 응답 생성기
		public static TrainStartResponse error(String message) {
			TrainStartResponse r = new TrainStartResponse();
			r.setError(message);
			return r;
		}
	}

	// 학습 상태 응답
	public static class TrainStatusResponse {
		private String jobId;		// 조회한 학습 식별자
		private String status;		// RUNNING | DONE | ERROR | NOT_FOUND
		private Integer progress;	// 0~100(선택)
		private String message;		// 상태/오류 메시지(선택)

		public String getJobId() { return jobId; }
		public void setJobId(String jobId) { this.jobId = jobId; }
		public String getStatus() { return status; }
		public void setStatus(String status) { this.status = status; }
		public Integer getProgress() { return progress; }
		public void setProgress(Integer progress) { this.progress = progress; }
		public String getMessage() { return message; }
		public void setMessage(String message) { this.message = message; }
	}
}
