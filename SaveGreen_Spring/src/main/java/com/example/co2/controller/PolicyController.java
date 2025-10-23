package com.example.co2.controller;

import com.example.co2.entity.TaxPolicy;
import com.example.co2.entity.ZebPolicy;
import com.example.co2.repository.TaxPolicyRepository;
import com.example.co2.repository.ZebPolicyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;

@Slf4j
@RequiredArgsConstructor
@RestController
@RequestMapping("/policy")
public class PolicyController {

    private final TaxPolicyRepository taxPolicyRepository;
    private final ZebPolicyRepository zebPolicyRepository;

    //csv다운로드
    @GetMapping("/download-all")
    public ResponseEntity<byte[]> downloadAllPolicies() {
        StringBuilder csv = new StringBuilder();
        csv.append("policyType,id,energy_usage_min,energy_usage_max,tax1_discount,tax2_discount,area_bonus,note,energy_grade_label,energy_grade_category,")
           .append("zeb_name,min_percent,max_percent,tax1_discount,tax2_discount,certification_discount,renewable_support,area_bonus\n");

      
        List<TaxPolicy> taxList = taxPolicyRepository.findAll();
        for (TaxPolicy t : taxList) {
            csv.append("TAX,")
               .append(t.getTaxPolicyId()).append(",")
               .append(t.getEnergyUsageMin()).append(",")
               .append(t.getEnergyUsageMax()).append(",")
               .append(t.getTax1Discount()).append(",")
               .append(t.getTax2Discount()).append(",")
               .append(t.getAreaBonus()).append(",")
               .append(safe(t.getNote())).append(",")
               .append(safe(t.getEnergyGradeLabel())).append(",")
               .append(safe(t.getEnergyGradeCategory())).append(",,,,,,,,\n");
        }

      
        List<ZebPolicy> zebList = zebPolicyRepository.findAll();
        for (ZebPolicy z : zebList) {
            csv.append("ZEB,")
               .append(z.getZebPolicyId()).append(",,,,,,,,,")
               .append(safe(z.getZebName())).append(",")
               .append(z.getMinPercent()).append(",")
               .append(z.getMaxPercent()).append(",")
               .append(z.getTax1Discount()).append(",")
               .append(z.getTax2Discount()).append(",")
               .append(z.getCertificationDiscount()).append(",")
               .append(safe(z.getRenewableSupport())).append(",")
               .append(z.getAreaBonus()).append("\n");
        }


        //엑셀 깨짐방지
        byte[] bom = {(byte)0xEF, (byte)0xBB, (byte)0xBF};
        byte[] body = csv.toString().getBytes(StandardCharsets.UTF_8);
  
        byte[] bytes = new byte[bom.length + body.length];
        System.arraycopy(bom, 0, bytes, 0, bom.length);
        System.arraycopy(body, 0, bytes, bom.length, body.length);

        // byte[] bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
        HttpHeaders headers = new HttpHeaders();
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=policy_all.csv");
        headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));

        return ResponseEntity.ok().headers(headers).body(bytes);
    }

 
    //csv 업로드
   @PostMapping("/upload-all")
public ResponseEntity<String> uploadAllPolicies(@RequestParam("file") MultipartFile file) {
    int taxCount = 0;
    int zebCount = 0;

    try {
         // 엑셀파일 예외처리
        BufferedReader reader;
        try {
            reader = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8));
            reader.mark(1);
            reader.read();
            reader.reset();
        } catch (Exception e) {
            reader = new BufferedReader(new InputStreamReader(file.getInputStream(), "CP949"));
        }

        String line;
        boolean isHeader = true;

        while ((line = reader.readLine()) != null) {
            if (isHeader) { isHeader = false; continue; }

            String[] cols = line.split(",", -1);
            if (cols.length < 2) continue;

            String type = cols[0].trim();
            Long id = parseLong(cols[1]);

            try {
                if ("TAX".equalsIgnoreCase(type)) {
                    taxCount += updateTaxPolicy(id, cols);
                } else if ("ZEB".equalsIgnoreCase(type)) {
                    zebCount += updateZebPolicy(id, cols);
                } else {
                    log.warn("Unknown policyType: {}", type);
                }
            } catch (Exception e) {
                log.warn("Row 처리 중 오류: {}", line, e);
            }
        }

        reader.close();

    } catch (IOException e) {
        log.error("CSV 파일 읽기 실패", e);
        return ResponseEntity.internalServerError().body("CSV 파일 읽기 실패");
    }

    String msg = "TAX " + taxCount + "건, ZEB " + zebCount + "건 업데이트 완료";
    return ResponseEntity.ok(msg);
}



    // 정책 적용
    private int updateTaxPolicy(Long id, String[] cols) {
        return taxPolicyRepository.findById(id).map(entity -> {
            if (cols.length > 2) entity.setEnergyUsageMin(toBigDecimal(cols[2]));
            if (cols.length > 3) entity.setEnergyUsageMax(toBigDecimal(cols[3]));
            if (cols.length > 4) entity.setTax1Discount(toInt(cols[4]));
            if (cols.length > 5) entity.setTax2Discount(toInt(cols[5]));
            if (cols.length > 6) entity.setAreaBonus(toInt(cols[6]));
            if (cols.length > 7) entity.setNote(cols[7]);
            if (cols.length > 8) entity.setEnergyGradeLabel(cols[8]);
            if (cols.length > 9) entity.setEnergyGradeCategory(cols[9]);
            taxPolicyRepository.save(entity);
            return 1;
        }).orElse(0);
    }

    private int updateZebPolicy(Long id, String[] cols) {
        return zebPolicyRepository.findById(id).map(entity -> {
            if (cols.length > 10) entity.setZebName(cols[10]);
            if (cols.length > 11) entity.setMinPercent(toBigDecimal(cols[11]));
            if (cols.length > 12) entity.setMaxPercent(toBigDecimal(cols[12]));
            if (cols.length > 13) entity.setTax1Discount(toInt(cols[13]));
            if (cols.length > 14) entity.setTax2Discount(toInt(cols[14]));
            if (cols.length > 15) entity.setCertificationDiscount(toInt(cols[15]));
            if (cols.length > 16) entity.setRenewableSupport(cols[16]);
            if (cols.length > 17) entity.setAreaBonus(toInt(cols[17]));
            zebPolicyRepository.save(entity);
            return 1;
        }).orElse(0);
    }


    //변환
    private String safe(String val) {
        return val == null ? "" : val;
    }

    private Long parseLong(String val) {
        try { return (val == null || val.isEmpty()) ? null : Long.parseLong(val); }
        catch (Exception e) { return null; }
    }

    private BigDecimal toBigDecimal(String val) {
        try { return (val == null || val.isEmpty()) ? null : new BigDecimal(val); }
        catch (Exception e) { return null; }
    }

    private Integer toInt(String val) {
        try { return (val == null || val.isEmpty()) ? null : Integer.parseInt(val); }
        catch (Exception e) { return null; }
    }
}

