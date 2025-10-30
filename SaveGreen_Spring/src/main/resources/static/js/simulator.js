// 시뮬레이터 사용법 안내
document.addEventListener("DOMContentLoaded", () => {
Swal.fire({
    title: '시뮬레이터 사용법',
    html: '<h4>에너지 등급 시뮬레이터</h4>'
         +'<b>1.</b>앞서 GREEN FINDER (건물정보검색) 페이지에서 선택한 건물정보(주소,건물면적, 전기사용량)이 자동기입됩니다.<br>- 선택하지 않으시면 직접 검색 및 입력 가능합니다.<br>'
         +'<b>2.</b>태양광 패널을 설치 되어 있으시면 패널 개수 및 모델명 및 출력 적용해주세요.<br>- 미기입시에도 결과 보기 가능합니다.<br>'
         +'<b>3.</b>결과보기를 클릭 후 내용을 확인하세요.<br>'
         +'<h4>태양광 에너지 효율 경제성 시뮬레이터</h4>'
         +'<b>1.</b>앞서 GREEN FINDER (건물정보검색) 페이지에서 선택한 건물정보(주소,건물면적)이 자동기입됩니다.<br>- 선택하지 않으시면 직접 검색 및 입력 가능합니다.<br>'
         +'<b>2.</b>에너지 시뮬레이터에서 확인하신 등급과 목표 등급을 선택해주세요.<br>'
         +'<b>3.</b>태양광 패널의 모델명과 출력에너지를 적용해주세요.<br>'
         +'<b>4.</b>결과보기를 클릭 후 내용을 확인하세요.<br>',
    icon: 'info',
    customClass: {
      htmlContainer: 'swal-text',
          
    },
    confirmButtonText: '확인'
  });
  // 시뮬레이터 결과 가이드
  const guideBtn1 = document.getElementById("guideBtn1");
  
  if (guideBtn1) {
    guideBtn1.addEventListener("click", () => {
      Swal.fire({
        title: '에너지 등급 시뮬레이터 참고사항',
        html: `
          <b>1.</b> 해당 결과는 주소, 건물면적, 위도 경도 기준 일사량, 태양광 패널 정격 출력, 에너지 효율 등급 기준을 바탕으로 작성 되었습니다.<br>
          <b>2.</b> 태양광 패널의 발전 효율 상수는 0.8로 책정되었습니다.<br>   일반적인 태양광 패널 발전 효율은 0.75~0.85 사이입니다.<br>
          <b>3.</b> 에너지 효율 등급은 국토교통부 고시 제2021-1405호(2021.12.31) 기준을 따릅니다.<br>위도 경도 기준 일사량은 나사 위성 자료를 기반으로 산출되었습니다.<br>
          <b>4.</b> ZEB등급,녹색건축물등급에 따른 감면율은 공공기관 정보를 바탕으로 작성되었습니다.<br>
          <b>5.</b> 절세율은 중복되지 않으며, 결과의 감면율은 두 인증 등급의 감면율 중 높은 것으로 나타납니다.<br>
          <b>6.</b> 재산세 감면액은 지자체 조례에 따라 달라질 수 있습니다.
        `,
        icon: 'info',
        confirmButtonText: '닫기',
        customClass: {
          htmlContainer: 'swal-text'     
        },
        focusConfirm: false,
        scrollbarPadding: false,
        heightAuto: false,  
      });
    });
  }


  const guideBtn2 = document.getElementById("guideBtn2");
  if (guideBtn2) {
    guideBtn2.addEventListener("click", () => {
      Swal.fire({
        title: '태양광 에너지 효율 경제성 시뮬레이터 참고사항',
        html: `
          <b>1.</b> 해당 결과는 주소, 건물면적, 위도 경도 기준 일사량, 태양광 패널 정격 출력, 에너지 효율 등급 기준을 바탕으로 작성 되었습니다.<br>
          <b>2.</b> 태양광 패널의 발전 효율 상수는 0.8로 책정되었습니다.<br> 일반적인 태양광 패널 발전 효율은 0.75~0.85 사이입니다.<br>
          <b>3.</b> 에너지 효율 등급은 국토교통부 고시 제2021-1405호(2021.12.31) 기준을 따릅니다.<br>위도 경도 기준 일사량은 나사 위성 자료를 기반으로 산출되었습니다.<br>
          <b>4.</b> 건축물 에너지 효율 등급 증가에 대한 에너지량은 에너지 등급 구간별 중간값으로 책정되었습니다.<br>
          <b>5.</b> 전기금액은 24년도 한국전력공사 표준 전기세 기준입니다.(kWh당 185.5원)<br>
          <b>6.</b> 탄소배출량은 24년도 국가별 탄소배출계수 기준입니다.(kWh당 0.419)
          
        `,
        icon: 'info',
        confirmButtonText: '닫기',
         customClass: {
          htmlContainer: 'swal-text'     
        },
        focusConfirm: false,
        scrollbarPadding: false,
        heightAuto: false,  
      });
    });
  }
});


//에너지 등급 시뮬레이터
document.addEventListener('DOMContentLoaded', () => {
    const form1 = document.getElementById('simulatorForm1');
    if (!form1) return;
    

    form1.addEventListener('submit', async (e) => {
        e.preventDefault();
        const spinBtn1 = document.getElementById("left");
         spinBtn1.insertAdjacentHTML("beforeend", '<span class="btn-spinner"></span>');


        const box = document.getElementById('resultBox1');
        const items = box.querySelectorAll('.result-item');
        const box3 = document.getElementById("intensityChart1");
        const box4 = document.getElementById("intensityChart2");
        const box5 = document.getElementById("intensityChart3");
        const box2 = document.getElementById('compareText');
        const btn = document.querySelector('.pdfBtn');
        if (!box3) return;


        const formData = new FormData(form1);
        const resp = await fetch('/simulate1', {
          method: 'POST',
          body: formData
        });
        const data = await resp.json();
        window.simulatorData1=data;
        
        if (!box) return;
      
        items.forEach(item => item.classList.remove('show'));
        document.getElementById('propertyTax').textContent = (data.propertyTax ?? '-')+"%";
        document.getElementById('acquireTax').textContent  = (data.acquireTax ?? '-')+"%";
        document.getElementById('areaBonus').textContent   = (data.areaBonus ?? '-')+"%";
        document.getElementById('grade').textContent       = data.grade ?? '-';
        document.getElementById('category').textContent    = data.category ?? '-';
        document.getElementById('energySelf').textContent = (data.energySelf ?? '-')+"%";
        document.getElementById('certificationDiscount').textContent = (data.certificationDiscount ?? '-')+"%";
        document.getElementById('renewableSupport').textContent = data.renewableSupport ?? '-';
        document.getElementById('zebGrade').textContent = data.zebGrade ?? '-';   



        
        box.style.display='block';
        box2.style.display='block';
        box3.style.display='block';
        box4.style.display='block';
        box5.style.display='block';
        runCompare();
        document.getElementById("aiText").style.display = "block";
        document.getElementById("aiResult").style.display = "block";
        document.getElementById("aiSummaryBtn").style.display = "block";
        btn.style.display = "block";
        items.forEach((item, index) => {
          setTimeout(() => item.classList.add('show'), index * 300);
        });
        document.querySelectorAll(".btn-spinner").forEach(s => s.remove());
        document.getElementById("resultBox1").scrollIntoView({ behavior: "smooth", block: "start" });
    });



    const form2 = document.getElementById('simulatorForm2');
    if (!form2) return;

    form2.addEventListener('submit', async (e) => {
        e.preventDefault();
        const spinBtn2 = document.getElementById("right");
        spinBtn2.insertAdjacentHTML("beforeend", '<span class="btn-spinner"></span>');
        const formData = new FormData(form2);

        const resp = await fetch('/simulate2', {
          method: 'POST',
          body: formData
        });
        const data = await resp.json();

        window.simulatorData2=data;

        const box = document.getElementById('resultBox2');
        if (!box) return;     
        const box2 = document.getElementById('compareText');
        const box6 = document.getElementById("solarEfficiencyChart");
        const items = box.querySelectorAll('.result-item');
        const btn = document.querySelector('.pdfBtn');
        items.forEach(item => item.classList.remove('show'));

        document.getElementById('solarRadiation').value = data.solarRadiation;
        document.getElementById('onePanelGeneration').value = data.onePanelGeneration;
        document.getElementById('onePanelGeneForChart').value = data.onePanelGeneForChart;
        document.getElementById('onePanelCO2').value = data.onePanelCO2;
        document.getElementById('onePanelSaveElectric').value = data.onePanelSaveElectric;
        document.getElementById('daySolar').value = data.daySolar;
        document.getElementById('roadAddr').textContent = data.roadAddr;
        animateValue("total", 0, data.total, 2000, 0);
        animateValue("annualSaveElectric", 0, data.annualSaveElectric, 2000, 0);
        animateValue("annualSaveCO2", 0, data.annualSaveCO2, 2000, 1);
        animateValue("requiredPanels", 0, data.requiredPanels, 2000, 0);
        
        
        // sendAiSummary(data)
        console.log("data",data)
        box.style.display = 'block';
        box2.style.display='block'
        box6.style.display = 'block';
        addNewResultToChart()
        document.getElementById("aiText").style.display = "block";
        document.getElementById("aiResult").style.display = "block";
        document.getElementById("aiSummaryBtn").style.display = "block";
        btn.style.display = "block";
      
        items.forEach((item, index) => {
          setTimeout(() => item.classList.add('show'), index * 300);
        });
        document.querySelectorAll(".btn-spinner").forEach(s => s.remove());
        document.getElementById("resultBox2").scrollIntoView({ behavior: "smooth", block: "start" });
    });


const aiBtn = document.getElementById("aiSummaryBtn");

  aiBtn.addEventListener("click", async () => {

    // const spinBtn3 = document.getElementById("aiSummaryBtn");
    //   spinBtn3.insertAdjacentHTML("beforeend", '<span class="btn-spinner"></span>');

    aiBtn.disabled = true;
    aiBtn.innerHTML = '분석 중... <span class="btn-spinner"></span>'; 


    const leftResult = window.simulatorData1 || null;  
    const rightResult = window.simulatorData2 || null; 

  
    let prompt = "";

    if (leftResult && rightResult) {
      prompt = `
          이 시뮬레이터는 건물의 에너지 효율 등급을 평가하고, 
          태양광 패널을 설치했을 때 목표 등급에 도달하기 위해 필요한 패널 수와 
          그에 따른 경제적·환경적 효과를 분석하기 위한 시스템입니다.

          시뮬레이션의 기본 흐름은 다음과 같습니다:
          1. [에너지 효율 시뮬레이터]는 건물의 주소, 면적, 위도·경도, 에너지 사용량, 태양광 패널 정격 출력, 
            에너지 효율 등급 기준 등을 바탕으로 현재 건물의 등급과 세제 감면율을 산출합니다.
          2. [태양광 경제성 시뮬레이터]는 사용자가 에너지 효율 시뮬레이터에서 검색한 현재등급에서 "현재 등급 → 목표 등급" 구간을 바탕으로,
            목표 등급을 달성하기 위해 필요한 태양광 패널 수를 계산하고, 
            예상 발전량, 절약 전기량, 탄소 절감량, 절세 효과 등을 분석합니다.
          3. 이 두 결과를 종합하여, 태양광 설치 전후의 에너지 자립률 변화, 
            세제 인센티브, 환경적 개선 효과를 비교·평가합니다.

          데이터 항목 설명(변수명은 그대로 사용하세요):
          - solarradiation: 연간 태양광 일사량  
          - onePanelGeneration: 패널 1개당 연간 발전량  
          - onePanelCO2: 패널 1개당 연간 CO₂ 절감량  (0.1ton)
          - annualSaveElectric: 연간 절감 전기세(만원)  
          - annualSaveCO2: 연간 절감 CO₂량(ton)  
          - total: 연간 절감 전기에너지량(kWh)
          - requiredPanels: 목표 등급 달성을 위한 필요한 패널 수  
          - propertyTax / acquireTax / areaBonus / certificationDiscount: 재산세/취득세/용적률증가/인증비용감면율
          - grade / zebGrade: 에너지 효율 등급 및 ZEB 등급  
          - energySelf: 에너지 자립률(%)  
          - category: 건물 유형 (예: 공장, 병원, 창고 등)
          - daySolar: 일평균 일사량 (kWh/m²/day)
          - currentGrade: 현재 에너지 효율 등급
          - targetGrade: 목표 에너지 효율 등급
          - 패널1개당 설치 면적 요구치는 약 3.3m²입니다.

          [분석 규칙(반드시 준수)]
          - 각 문장은 반드시 “수치 → 의미(원인→결과)”를 포함하세요. 숫자만 나열 금지.
          - 에너지 자립률은 태양광패널개수가 입력되지 않으면 0%일 수 있으므로 그 가능성을 고려해 해석하세요.
          - 도메인 변수명은 반드시 위에 제시한 이름 그대로 사용하세요(예: acquireTax는 ‘취득세’로 해석하되 변수명 맥락 유지).
          - 퍼센타일/평균 비교 가능하다면 제시하세요.
          - “대안/우선순위”를 반드시 포함해 의사결정 관점의 분석을 하세요(예: 패널 수 증설 vs 효율 개선 vs 배치 최적화).
          - 출력은 항상 딱딱한 보고서형식보단 자연스러운 기사문체로 작성하세요.

          [필수 검증(불일치 시 내부적으로 재계산 후 일관된 수치로 서술; 계산 과정은 노출하지 않음)]
          - total ≈ requiredPanels x onePanelGeneration
          - annualSaveElectric ≈ total x 0.1855 / 10000    (만원)
          - annualSaveCO2 ≈ total x 0.415 / 1000           (톤)
          - onePanelCO2(톤/패널) ≈ annualSaveCO2 / requiredPanels
          - 값이 제공되지 않은 경우에는 추정하지 말고 “데이터 미제공”으로 간결히 언급

          [출력 형식(문단 3개, 15~25줄 내외)]
          ① 현재 상태 분석 — grade, zebGrade, energySelf, propertyTax/acquireTax/areaBonus/certificationDiscount, 
            eik1 vs average1, percent(상위%) 등을 “운영비/정책 인센티브 관점”으로 해석. 
            위험(병목)과 기회(레버리지)를 4~5문장으로 요약.

          ② 목표 등급 달성을 위한 태양광 시나리오 — requiredPanels, total, annualSaveElectric, annualSaveCO2, onePanelGeneration,
            onePanelCO2를 근거로 “투입 대비 효과(만원/패널, 톤/패널), 설치 면적(= requiredPanels x 3.3m²)과 현실성, 
            대안(패널 효율/배치/부분 설치)”을 4~6문장 분석. 단순 나열 금지.

          ③ 종합 평가 — 경제성·환경성·정책 인센티브를 함께 보아 실행 타당성을 2~3문장으로 정리. 
            가정/전제(전력단가 185.5원/kWh, 배출계수 0.415 kgCO₂/kWh 등)를 한 줄로 명시.

          [금지]
          - 표/리스트형 숫자 나열만 하는 문장
          - “데이터가 ~입니다” 같은 정보 나열형 문장 반복
          - 좌/우(왼쪽/오른쪽) 존재 시 무조건 비교로 끝내기 (비교는 가능하되, 최종 문단은 의사결정 인사이트로 마무리)
       

        [왼쪽 결과]
        ${JSON.stringify(leftResult)}

        [오른쪽 결과]
        ${JSON.stringify(rightResult)}
              `;
    } 
    else if (leftResult) {
      prompt = `
        이 시뮬레이터는 건물의 에너지 효율 등급을 평가하기 위한 시스템으로,
        입력된 주소, 면적, 위도·경도, 에너지 사용량, 태양광 패널 정격 출력, 
        에너지 효율 기준을 바탕으로 현재 상태의 등급 및 절세 가능성을 분석합니다.

        데이터 항목 설명:
      - solarradiation: 연간 태양광 일사량  
      - onePanelGeneration: 패널 1개당 연간 발전량  
      - onePanelCO2: 패널 10개당 연간 CO₂ 절감량
      - annualSaveElectric: 연간 절감 전기세(만원)  
      - annualSaveCO2: 연간 절감 CO₂량(ton)  
      - total: 연간 절감 전기에너지량(kWh)
      - requiredPanels: 목표 등급 달성을 위한 필요한 패널 수  
      - propertyTax / acquireTax / areaBonus / certificationDiscount: 재산세/취득세/용적률증가/인증비용감면율
      - grade / zebGrade: 에너지 효율 등급 및 ZEB 등급  
      - energySelf: 에너지 자립률(%)  
      - category: 건물 유형 (예: 공장, 병원, 창고 등)
      - daySolar: 일평균 일사량 (kWh/m²/day)


        결과는 다음 3단 구조로 작성하세요:
        ① 현재 상태 분석 — 건물의 등급, 자립률, 절세 현황을 얘기하지만. 자립률이 0인경우는 미입력이거나 0개일수도있다는 가정을 해야합니다. 몰라서 미입력인데 0이라고 확정짓고 대답하면 흐름이 이상해집니다.
        ② 개선 필요성 — 태양광 설치 또는 효율 개선을 통한 잠재 효과  
        ③ 종합 평가 — 환경적·경제적 기여 가능성, 등급 향상 여지, 정책적인 인사이트를 얘기해주세요.

        추가 지침:
        - 형식적 문체 대신, 보고서나 기사처럼 자연스럽고 이해하기 쉬운 문장으로 15~25줄 내외로 서술해주세요.
        - 에너지 자립률은 태양광패널개수가 입력되지않으면 0%이므로, 그 점을 고려하여 작성해주세요.
        - 에너지 효율등급은 다음과 같이 숫자가 낮을수록 효율이 나쁜 구조입니다."1+++", "1++", "1+", "1", "2", "3", "4", "5", "6", "7" 순서로 존재합니다. 
        - ZEB등급은 다음과 같이 숫자가 높을수록 효율이 나쁜 구조입니다."+", "1", "2", "3", "4", "5" 순서로 존재합니다. +는 1등급보다 더 좋은등급입니다.
        - 절세율은 0%부터 시작하여 최대 20%까지 존재합니다. 퍼센트가 높을수록 좋은구조입니다.
        - 문단 구분은 하되, 문단 번호 제외한 기호는 삼가해주세요. 
        - 데이터 간의 관계와 의미를 분석하되, 단순 수치 나열보다 "개선 인사이트"에 초점을 맞춰주세요.  
        - 주요 수치(예: 절감량, 등급, 감면율 등)는 문장 안에 자연스럽게 포함시켜주세요.  
        - 왼쪽(기존 상태)과 오른쪽(태양광 적용 후) 데이터가 모두 존재한다면 흐름 중심으로,  
          하나만 있을 경우에는 그 데이터의 의미를 중심으로 평가해주세요. 두 데이터의 비교는 하지마세요.
        


        [왼쪽 결과]

        ${JSON.stringify(leftResult)}
              `;
            } 
            else if (rightResult) {
              prompt = `
        이 시뮬레이터는 사용자가 지정한 "현재 등급 → 목표 등급" 구간에 따라, 
        해당 목표를 달성하기 위해 필요한 태양광 패널 수, 
        에너지 절감 효과, 탄소 절감량, 경제적 효과를 분석하는 시스템입니다.

         데이터 항목 설명:
        - solarradiation: 연간 태양광 일사량  
        - onePanelGeneration: 패널 1개당 연간 발전량  
        - onePanelCO2: 패널 1개당 연간 CO₂ 절감량 (0.1ton) 
        - annualSaveElectric: 연간 절감 전기세(만원)  
        - annualSaveCO2: 연간 절감 CO₂량(ton)  
        - total: 연간 절감 전기에너지량(kWh)
        - requiredPanels: 목표 등급 달성을 위한 필요한 패널 수  
        - energySelf: 에너지 자립률(%)  
        - category: 건물 유형 (예: 공장, 병원, 창고 등)
        - daySolar: 일평균 일사량 (kWh/m²/day)
        - currentGrade: 현재 에너지 효율 등급
        - targetGrade: 목표 에너지 효율 등급
        - 패널1개당 설치 면적 요구치는 약 3.3m²입니다.

        - solarRadiation 나누기 366 하면 daySolar가 나옵니다(윤년).
        - solarRadiation 곱하기 efficiency(0.8) 곱하기 정격출력(kw) 곱하기 패널수 = total
        - annualSaveElectric = total 곱하기 0.1855 / 10000
        - annualSaveCO2 = total 곱하기 0.419 / 1000
      

        결과는 다음 3단 구조로 작성하세요:
        ① 시뮬레이터의 필요성에대해 설명해주세요, 이 시뮬레이터는 목표치 달성시 절감예측이 목표이므로 현재상태분석보단 필요성을 대두시키는게 중요합니다.
        ② 필요한 태양광 규모 — 패널 수, 발전량, 절감량, CO₂ 저감 효과  
        ③ 종합 평가 — 경제성, 환경 기여, 설치 타당성 및 정책적 시사점  

        추가 지침:
        - 형식적 문체 대신, 보고서나 기사처럼 자연스럽고 이해하기 쉬운 문장으로 10~15줄 내외로 서술해주세요.
        - 데이터 간의 관계와 의미를 분석하되, 단순 수치 나열보다 "개선 인사이트"에 초점을 맞춰주세요.  
        - 왼쪽(기존 상태)과 오른쪽(태양광 적용 후) 데이터가 모두 존재한다면 비교 중심으로,  
          하나만 있을 경우에는 그 데이터의 의미를 중심으로 평가해주세요. 
        - 계산적 접근이 주인 시뮬레이터기때문에 이 값이 어떻게 나온건지 수치적인 인사이트가 필요하고 이 데이터들로 더 얻을 수 있는 정보가 있으면 서술해주세요.

        [오른쪽 결과]
        ${JSON.stringify(rightResult)}
              `;
    } 
    else {
      alert("아직 시뮬레이터 결과가 없습니다.");
      return;
    }

    const aiResult = document.getElementById("aiResult");
    aiResult.textContent = " AI 분석 중입니다... 잠시만 기다려주세요.";

    const aiText = document.getElementById("aiText");
    const resp = await fetch("/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt })
    });

    const data = await resp.json();
    aiText.style.display = "block";
    aiResult.textContent = data.reply;
    aiResult.classList.add("show");
    aiResult.textContent = data.reply.trim();
    aiBtn.disabled = false;
    aiBtn.innerHTML = '다시 분석하기!';

    setTimeout(() => {
      aiResult.classList.add("show");
    }, 100);
    aiResult.scrollIntoView({ behavior: "smooth", block: "start" });
    
  });
});


// 빌딩에어리어 가져오기
document.addEventListener("DOMContentLoaded", () => {
    const area = sessionStorage.getItem("BuildingArea");
    console.log("세션스토리지에서 가져온 건물면적:", area);
    if (area) {
        document.getElementById("area1").value = area;
        document.getElementById("area2").value = area; 
    }
});

// 위도경도,pnu가져오기
document.addEventListener("DOMContentLoaded",  () => {
    const lat = sessionStorage.getItem("lat");
    const lon = sessionStorage.getItem("lon");
    
    console.log("세션스토리지에서 가져온 좌표:", lat, lon);
    
    if (lat && lon) {
        document.querySelector("#lat1").value = lat;
        document.querySelector("#lon1").value = lon;

        document.querySelector("#lat2").value = lat;
        document.querySelector("#lon2").value = lon;
    }
});

// 주소가져오기
document.addEventListener("DOMContentLoaded", () => {
    const ldCodeNm = sessionStorage.getItem("ldCodeNm");
    const mnnmSlno = sessionStorage.getItem("mnnmSlno");
    console.log("세션스토리지에서 가져온 주소:", ldCodeNm, mnnmSlno);
    if (ldCodeNm && mnnmSlno) {
        const combined = ldCodeNm+" "+mnnmSlno;
        document.getElementById("juso1").value = combined;
        document.getElementById("juso2").value = combined; 
    }
});

// 아이디로 왼쪽 오른쪽 분기하기
let lastTriggeredSimulator = null;

document.getElementById('juso1').addEventListener('focus', () => {
  lastTriggeredSimulator = 'left';
});

document.getElementById('juso2').addEventListener('focus', () => {
  lastTriggeredSimulator = 'right';
});

document.addEventListener("DOMContentLoaded", () => {
  const searchBoxes = document.querySelectorAll(".searchBox");

  searchBoxes.forEach((input) => {
    const resultList = input.parentElement.querySelector(".searchResult");

    input.addEventListener("keyup", async () => {
      const keyword = input.value.trim();
      if (keyword.length < 2) {
        resultList.innerHTML = "";
        resultList.classList.remove("show");
        return;
      }

      const resp = await fetch(`/search?keyword=${encodeURIComponent(keyword)}`);
      const list = await resp.json();

      resultList.innerHTML = "";
      list.forEach(addr => {
        const item = document.createElement("div");
        item.classList.add("dropdown-item");
       
        
        const left = document.createElement("div");
        left.className = "addr-left";

        const road = document.createElement("div");
        road.className = "addr-road";
        road.textContent = addr.roadAddr || "";

        const jibun = document.createElement("div");
        jibun.className = "addr-jibun";
        jibun.textContent = addr.jibunAddr || "";

        left.appendChild(road);
        left.appendChild(jibun);

        const zip = document.createElement("div");
        zip.className="addr-zip";
        zip.textContent =addr.zipNo || "";

        item.appendChild(left);
        item.appendChild(zip);

        

        item.addEventListener("click", () => {
          input.value = addr.roadAddr;
          resultList.innerHTML = "";
          resultList.classList.remove("show");
          // 주소->좌표 변환 AJAX
          $.ajax({
            url: "http://api.vworld.kr/req/address",
            type: "GET",
            dataType: "jsonp",   
            data: {
              service: "address",
              request: "getcoord",
              version: "2.0",
              crs: "epsg:4326",
              address: addr.roadAddr,   
              format: "json",
              type: "road",
              key: "AED66EDE-3B3C-3034-AE11-9DBA47236C69"  
            },
            success: function(data) {
              if (data && data.response && data.response.result && data.response.result.point) {
                const lon = data.response.result.point.x;
                const lat = data.response.result.point.y;

                const currentForm = input.closest("form");
                $(currentForm).find("input[name='lon']").val(lon);
                $(currentForm).find("input[name='lat']").val(lat);

                console.log("선택된 주소:", addr.roadAddr, "→ 좌표:", lat, lon);


                // 좌표 -> pnu
                $.ajax({
                  url: "http://api.vworld.kr/req/data",
                  type: "GET",
                  dataType: "jsonp",
                  data: {
                    service: "data",
                    request: "getfeature",
                    data: "lp_pa_cbnd_bubun",
                    format: "json",
                    geomFilter: `POINT(${lon} ${lat})`,
                    crs: "EPSG:4326",
                    key: "AED66EDE-3B3C-3034-AE11-9DBA47236C69"
                  },
                  success: function (pnuData) {
                    const pnu = pnuData?.response?.result?.featureCollection?.features?.[0]?.properties?.pnu;
                    if (!pnu) {
                      console.warn("PNU 조회 실패:", pnuData);
                      return;
                    }
                    console.log("PNU:", pnu);

                    // pnu로 건물면적조회
                    $.ajax({
                      url: "http://api.vworld.kr/ned/data/getBuildingUse",
                      type: "GET",
                      dataType: "jsonp",
                      data: {
                        key: "AED66EDE-3B3C-3034-AE11-9DBA47236C69",
                        pnu: pnu,
                        format: "json"
                      },
                      success: function (buildData) {
                        const area = buildData?.buildingUses?.field?.[0]?.buldBildngAr;
                        if (area) {
                          // $(currentForm).find("input[name='area']").val(area);
                          const areaInput = $(currentForm).find("input[name='area']")[0];
                          areaInput.value = area; 
                          areaInput.setAttribute("value", area); 
                          areaInput.dispatchEvent(new Event("input", { bubbles: true }));

                          
                          
                          console.log("건물면적:", area);
                        } else {
                          console.warn("면적 정보 없음:", buildData);
                        }
                      },
                      error: function (xhr, status, error) {
                        console.error("건물정보 API 오류:", error);
                      }
                    });


                    


                    fetch(`/simulator/${encodeURIComponent(pnu)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then( data => {
                          if (!data) return;

                          if (lastTriggeredSimulator === 'left') {
                            const energyInput = document.querySelector('#energy1');
                            if (energyInput) energyInput.value = data.electricityUsageKwh;
                            console.log('왼쪽에서 실행됨  energy1 값 세팅됨');
                          } else {
                            console.log('오른쪽에서 실행됨  energy1 무시됨');
                          }

                          const cat = data.buildingType2;
                          const category1 = document.querySelector('#category1');
                          if (category1) category1.value = cat;
                          const category2 = document.querySelector('#category2');
                          if (category2) category2.value = cat;
                          console.log("cat : ",cat);

                          const eik = data.energyIntensityKwhPerM2;
                          const eik1 = document.querySelector('#eik1');
                          if(eik1) eik1.value = eik;
                          const eik2 = document.querySelector('#eik2');
                          if(eik2) eik2.value = eik;
                          console.log("eik : ",eik)
                          
                          // 에버리지
                    fetch(`/energy/avg-intensity?category=${encodeURIComponent(cat)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(average => {
                          if (average == null) return;

                          const avgEl1 = document.querySelector('#average1');
                          if (avgEl1) avgEl1.value = average;
                          const avgEl2 = document.querySelector('#average2');
                          if (avgEl2) avgEl2.value = average;
                          console.log("average : ",average);
                         
                        });
                        //상위 몇퍼센트인지 알아보기
                    fetch(`/energy/percentile?category=${encodeURIComponent(cat)}&value=${eik}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(percentile => {
                          if (percentile == null) return;
                          
                          const percent = document.querySelector('#percent');
                          percent.value = percentile;
                          console.log("상위"+percent.value+"%");
                        });
                    // 선택 건물 퍼센트 가져오기
                    fetch(`/energy/monthly-percent/pnu?pnu=${encodeURIComponent(pnu)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                          if (!data) return;
                          const BM = document.getElementById('buildingMonthly')
                          BM.value = JSON.stringify(data);
                          console.log("선택건물 월별비중:", data);
                          
                        });

                    // 카테고리 평균 퍼센트 가져오기
                    fetch(`/energy/monthly-percent/category?category=${encodeURIComponent(cat)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                          if (!data) return;
                          const CM = document.getElementById('categoryMonthly');
                          CM.value = JSON.stringify(data);
                          console.log("비교군 월별비중:", data);
                        });
                                              })
                        .catch(console.error);
                  },
                  error: function (xhr, status, error) {
                    console.error("PNU API 오류:", error);
                  }
                });
              } else {
                console.warn("지오코딩 결과 없음:", data);
              }
            },
            error: function(err) {
              console.error("지오코딩 API 호출 실패:", err);
            }
          });
        });

        resultList.appendChild(item);
      });

      if (list.length > 0) {
        resultList.classList.add("show");
      } else {
        resultList.classList.remove("show");
      }
    });
  });
});

function animateValue(id, start, end, duration, decimals = 0) {
  const obj = document.getElementById(id);
  if (!obj) return;

  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = start + (end - start) * progress;
    obj.innerText = decimals === 0 ? Math.floor(value) : value.toFixed(decimals);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}





//htmltoimage
document.addEventListener('DOMContentLoaded', () => {
  const h2i = window.htmlToImage;
  if (!h2i) {
    console.error('html-to-image가 로드되지 않았습니다.');
    return;
  }

  document.getElementById("downloadBtn").addEventListener("click", async () => {
    const el = document.querySelector(".captureWrapper");
    console.log(el.getBoundingClientRect());

    if (!el) return;


    //웹 폰트 불러오는거 기다리기
    await document.fonts.ready;

    try {
      // png 생성
      const dataUrl = await h2i.toJpeg(el, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#ffffff",
        useCORS: true
      });
      
     
      // pdf 변환 // jspdf
      const pdf = new jspdf.jsPDF("p", "mm", "a4");
      const img = new Image();
    
      img.onload = function () {
        const pdfW = pdf.internal.pageSize.getWidth();
        const pdfH = pdf.internal.pageSize.getHeight();
        const imgW = pdfW;
        const imgH = (img.height * pdfW) / img.width;

        let hLeft = imgH;
        let pos = 0;

        pdf.addImage(img, "JPEG", 0, pos, imgW, imgH);
        hLeft -= pdfH;

        while (hLeft > 0) {
          pos = hLeft - imgH;
          pdf.addPage();
          pdf.addImage(img, "JPEG", 0, pos, imgW, imgH);
          hLeft -= pdfH;
        }
        const timestamp=getTimestamp();
        const filename =`simulator_${timestamp}`

        pdf.save(filename);
      };
      img.crossOrigin = "anonymous";
      img.src = dataUrl;

    } catch (err) {
      console.error("html-to-image PDF 변환 중 오류:", err);
    }
  });



  document.getElementById("sendMailBtn").addEventListener("click", async () => {
    const el = document.querySelector(".captureWrapper");
    if (!el) return;

    await document.fonts.ready;

     const { value: email } = await Swal.fire({
    title: '시뮬레이터 결과 메일 전송',
    input: 'email',
    inputLabel: '결과를 받을 이메일 주소를 입력하세요',
    inputPlaceholder: 'example@email.com',
    confirmButtonText: '보내기',
    showCancelButton: true,
    cancelButtonText: '취소',
    inputValidator: (value) => {
      if (!value) return '이메일을 입력해주세요!';
    },
  });
  if (!email) return;

  //  진행중 안내창
  Swal.fire({
    title: '메일 전송 중...',
    html: `
      <div id="progressBarContainer" style="width:100%;height:10px;background:#eee;border-radius:5px;">
        <div id="progressBar" style="width:0%;height:100%;background:#28a745;border-radius:5px;transition:width 0.3s;"></div>
      </div>
      <p id="statusText" style="margin-top:10px;">잠시만 기다려주세요</p>
    `,
    allowOutsideClick: false,
    showConfirmButton: false,
    didOpen: () => {
      Swal.showLoading();
      const bar = document.getElementById('progressBar');
      const text = document.getElementById('statusText');
      let progress = 0;
       const stages = [
        { limit: 25, msg: 'PDF 변환 중' },
        { limit: 50, msg: 'Blob 변환 중' },
        { limit: 75, msg: '메일 준비 중' },
        { limit: Infinity, msg: '메일 보내는 중' }
      ];
      const interval = setInterval(() => {
        progress += Math.random() * 3;
        if (progress >= 100) progress = 99;
        bar.style.width = `${progress}%`;

        const current = stages.find(s => progress < s.limit);
        if (current) text.textContent = current.msg;

      }, 500);
      Swal._interval = interval;
    },
  });

    try {
      const dataUrl = await h2i.toJpeg(el, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#ffffff",
        useCORS: true
      });

      const pdf2 = new jspdf.jsPDF("p", "mm", "a4");
      const img2 = new Image();
      img2.crossOrigin = "anonymous";
      img2.src = dataUrl;

      // Promise-pdf
      const pdfBlob = await new Promise((resolve) => {
        img2.onload = function () {
          const pdfW = pdf2.internal.pageSize.getWidth();
          const pdfH = pdf2.internal.pageSize.getHeight();
          const imgW = pdfW;
          const imgH = (img2.height * pdfW) / img2.width;

          pdf2.addImage(img2, "JPEG", 0, 0, imgW, imgH);
          const blob2 = pdf2.output("blob");
          resolve(blob2);
        };
      });

     
      const timestamp = getTimestamp();
      const formData = new FormData();
      formData.append("email", email);
      formData.append("file", pdfBlob, `SimulatorResult_${timestamp}.pdf`);

      const resp = await fetch("/sendMail", {
        method: "POST",
        body: formData
      });

      const result = await resp.text();

      clearInterval(Swal._interval);
      Swal.close();

      Swal.fire({
        icon: "success",
        title: "메일 발송 완료!",
        text: result,
        confirmButtonText: "확인",
      });


    } catch (err) {
      console.error("메일 전송 중 오류:", err);
      clearInterval(Swal._interval);
      Swal.close();
      Swal.fire({
        icon: "error",
        title: "메일 전송 실패",
        text: "메일 발송 중 오류가 발생했습니다.",
      });
    }
  });
});

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}


document.addEventListener('DOMContentLoaded', async () => {
  const pnu = sessionStorage.getItem('pnu');
  if (!pnu) return;
  console.log("세션스토리지에서 가져온 pnu:",pnu)
  const resp = await fetch(`/simulator/${encodeURIComponent(pnu)}`);
  if (!resp.ok) return;
  const data = await resp.json();
  const energyInput = document.querySelector('#energy1');
  if (!energyInput) return;

  const cat = data.buildingType2;

  const category1 = document.querySelector('#category1');
  if (category1) category1.value = cat;

  const category2 = document.querySelector('#category2');
  if (category2) category2.value = cat;

  console.log("분류 : " ,cat)
 
  energyInput.value = data.electricityUsageKwh;
  fetch(`/energy/avg-intensity?category=${encodeURIComponent(cat)}`)
    .then(r => r.ok ? r.json() : null)
    .then(average => {
      if (average == null) return;

      const avgEl1 = document.querySelector('#average1');
      if (avgEl1) avgEl1.value = average;
      const avgEl2 = document.querySelector('#average2');
      if (avgEl2) avgEl2.value = average;
      console.log("average : ",average);
    });

    const eik = data.energyIntensityKwhPerM2;
    const eik1 = document.querySelector('#eik1');
    if(eik1) eik1.value = eik;
    const eik2 = document.querySelector('#eik2');
    if(eik2) eik2.value = eik;
    console.log("eik : ",eik)
    fetch(`/energy/percentile?category=${encodeURIComponent(cat)}&value=${eik}`)
      .then(r => r.ok ? r.json() : null)
      .then(percentile => {
        if (percentile == null) return;
        
        const percent = document.querySelector('#percent');
        percent.value = percentile;
        console.log("상위"+percent.value+"%");
      });
  // 선택 건물 퍼센트 가져오기
  fetch(`/energy/monthly-percent/pnu?pnu=${encodeURIComponent(pnu)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const BM = document.getElementById('buildingMonthly')
        BM.value = JSON.stringify(data);
        console.log("선택건물 월별비중:", data);
        console.log(" 선택건물 월별비중 저장 완료:", BM.value);
      });

  // 카테고리 평균 퍼센트 가져오기
  fetch(`/energy/monthly-percent/category?category=${encodeURIComponent(cat)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const CM = document.getElementById('categoryMonthly');
        CM.value = JSON.stringify(data);
        console.log("비교군 월별비중:", data);
         console.log(" 선택건물 월별비중 저장 완료:", CM.value);
      });
});


document.addEventListener('DOMContentLoaded', () => {
  const currentSelect = document.querySelector('select[name="currentGrade"]');
  const targetSelect = document.querySelector('select[name="targetGrade"]');

  
  currentSelect.addEventListener('change', () => {
    const currentValue = parseInt(currentSelect.value);
    const targetOptions = targetSelect.querySelectorAll('option');

    targetOptions.forEach(option => {
      const targetValue = parseInt(option.value);

     
      if (isNaN(targetValue) || targetValue === 0) {
        option.disabled = false;
        option.style.display = '';
      } else if (targetValue >= currentValue) {
      
        option.disabled = true;
        option.style.display = 'none';
      } else {
      
        option.disabled = false;
        option.style.display = '';
      }
    });

 
    if (parseInt(targetSelect.value) <= currentValue) {
      targetSelect.value = 0;
    }
  });

  
});



//에너지 효율 등급
document.addEventListener("DOMContentLoaded", function () {
  const steps = ["eg1", "eg2", "eg3", "eg4", "eg5"];
  let current = 0;
  const nextBtn = document.getElementById("nextBtn");
  const submitBtn1 = document.getElementById("left");
  const descBox = document.getElementById("stepDescription");

  
  const descriptions = {
  eg1: `
    <strong>① 건물 주소 확인</strong><br>
    입력하신 주소를 기반으로 <strong>면적 정보를 불러왔습니다.</strong><br>
    입력된 정보가 맞다면 <em>‘다음으로’</em> 버튼을 눌러주세요.
  `,

  eg2: `
    <strong>② 에너지 사용량 확인</strong><br>
    시스템이 불러온 <strong>연간 에너지 사용량</strong>이 맞는지 확인해주세요.<br>
    맞다면 <em>‘다음으로’</em> 버튼을 눌러주세요.
  `,

  eg3: `
    <strong>③ 절감 효과 계산</strong><br>
    입력하신 사용량을 기준으로 <strong>절감 효과</strong>를 계산합니다.<br>
    다음 단계로 진행해주세요.
  `,

  eg4: `
    <strong>④ 태양광 설치 여부</strong><br>
    태양광 패널이 설치되어 있나요?<br>
    <strong>‘예 / 아니오’</strong> 중 하나를 선택해주세요.
  `,

  eg5: `
    <strong>⑤ 태양광 패널 정보 입력</strong><br>
    설치된 개수를 입력하고, 사용할 패널의 정격출력을 선택해주세요.<br>
    <em>1000m<sup>2</sup>당 약 250대의 패널 설치가 가능합니다.(패널 면적의 1.8배 필요)</em>
    <ul style="margin-top:5px; line-height:1.3;">
      <li><strong>400Wp</strong> — 소형 (가정용)</li>
      <li><strong>550Wp</strong> — 중형 (일반 건물용)</li>
      <li><strong>700Wp</strong> — 대형 (산업시설용)</li>
    </ul>
  `
};

  nextBtn.addEventListener("click", function () {
    const currentGroup = document.getElementById(steps[current]);
    const input = currentGroup.querySelector("input");

    // 입력 확인
    if (input && input.value.trim() === "") {
      input.focus();
      return;
    }

    // 설명 문구 표시
    if (descriptions[steps[current]]) {
      descBox.innerHTML = descriptions[steps[current]];
      descBox.style.opacity = 1;
    }

    // 다음 단계 처리
    if (current < steps.length - 1) {
      const nextId = steps[current + 1];

      
      if (nextId === "eg4") {
        nextBtn.style.display = "none";
        const choiceDiv = document.getElementById("eg4-buttons");
        choiceDiv.classList.remove("hidden");
        choiceDiv.classList.add("show");
        descBox.innerHTML = descriptions["eg4"];
      } else {
        // 일반 단계는 바로 표시
        const nextGroup = document.getElementById(nextId);
        nextGroup.classList.remove("hidden");
        nextGroup.classList.add("show");
      }

      current++;
    }
  });


  const btnYes = document.querySelector("#eg4-buttons .btn-yes");
  const btnNo = document.querySelector("#eg4-buttons .btn-no");

  // 예 
  btnYes.addEventListener("click", function () {
    
    const buttonsDiv = document.getElementById("eg4-buttons");
    buttonsDiv.classList.add("hidden");
    buttonsDiv.classList.remove("show");

    
    document.getElementById("eg4").classList.remove("hidden");
    document.getElementById("eg5").classList.remove("hidden");
    document.getElementById("eg4").classList.add("show");
    document.getElementById("eg5").classList.add("show");

   
    nextBtn.style.display = "block";

    // 설명 문구 갱신
    descBox.innerHTML = descriptions["eg5"];
  });

  //  아니오
  btnNo.addEventListener("click", function () {
    // eg4, eg5 모두 숨김
    document.getElementById("eg4").classList.add("hidden");
    document.getElementById("eg5").classList.add("hidden");

    // 예/아니오 버튼 숨김
    const buttonsDiv = document.getElementById("eg4-buttons");
    buttonsDiv.classList.add("hidden");
    buttonsDiv.classList.remove("show");

    
    submitBtn1.style.display = "block";
    nextBtn.style.display = "none";

    // 설명 문구 갱신
    descBox.innerHTML = `
    <strong>④ 입력 완료</strong><br>
    모든 정보가 입력되었습니다.<br>
    <strong>‘결과보기’</strong> 버튼을 눌러 시뮬레이션 결과를 확인하세요.<br>

    ※ 조건을 수정하신 후 <strong>결과보기</strong>를 다시 클릭하면 
    입력값을 기준으로 분석이 갱신됩니다. 
  `;
  });

  // 
  nextBtn.addEventListener("click", function () {
    if (current === steps.length - 1) {
      nextBtn.style.display = "none";
      submitBtn1.style.display = "block";
      descBox.innerHTML = `
    <strong>④ 입력 완료</strong><br>
    모든 정보가 입력되었습니다.<br>
    <strong>‘결과보기’</strong> 버튼을 눌러 시뮬레이션 결과를 확인하세요.<br>

    ※ 조건을 수정하신 후 <strong>결과보기</strong>를 다시 클릭하면 
    입력값을 기준으로 분석이 갱신됩니다. 
  `;
    }
  });
});



//태양광 패널

document.addEventListener("DOMContentLoaded", function () {
  const steps = ["sg1", "sg2", "sg3", "sg4" ];
  let current = 0;
  const nextBtn = document.getElementById("nextBtn2");
  const submitBtn2 = document.getElementById("right");
  const descBox = document.getElementById("stepDescription2");

  
  const descriptions = {
  sg1: `
    <strong>① 건물 정보 확인</strong><br>
    입력하신 주소를 기반으로 <strong>면적 정보를 불러왔습니다.</strong><br>
    정보가 맞다면 <em>‘다음으로’</em> 버튼을 눌러주세요.
  `,

  sg2: `
    <strong>② 에너지 효율 등급 선택</strong><br>
    현재 에너지 효율 등급과 <strong>목표 등급</strong>을 선택해주세요.<br>
    목표 등급에 따라 필요한 <strong>태양광 패널 수</strong>가 계산됩니다.
  `,

  sg3: `
    <strong>③ 태양광 패널 선택</strong><br>
    설치 예정인 패널의 정격출력을 선택해주세요.<br>
    <em>1000m<sup>2</sup>당 약 250대의 패널 설치가 가능합니다.(패널 면적의 1.8배 필요)</em>
    <ul style="margin-top:5px; line-height:1.6;">
      <li><strong>400Wp</strong> — 소형 (가정용)</li>
      <li><strong>550Wp</strong> — 중형 (일반 건물용)</li>
      <li><strong>700Wp</strong> — 대형 (산업시설용)</li>
    </ul>
  `,

  sg4: `
    <strong>④ 입력 완료</strong><br>
    모든 정보가 입력되었습니다.<br>
    <strong>‘결과보기’</strong> 버튼을 눌러 시뮬레이션 결과를 확인하세요.<br>

    ※ 조건을 수정하신 후 <strong>결과보기</strong>를 다시 클릭하면 
    입력값을 기준으로 분석이 갱신됩니다. 
  `
};
 
   nextBtn.addEventListener("click", function () {
    const currentGroup = document.getElementById(steps[current]);
    const input = currentGroup.querySelector("input, select");

    // 입력 확인
    if (input && input.value.trim() === "") {
      input.focus();
      return;
    }

    // 설명 문구 갱신
    if (descriptions[steps[current]]) {
      descBox.innerHTML = descriptions[steps[current]];
      descBox.style.opacity = 1;
    }

    // 다음 단계 열기
    if (current < steps.length - 1) {
      const nextId = steps[current + 1];
      const nextGroup = document.getElementById(nextId);
      nextGroup.classList.remove("hidden");
      nextGroup.classList.add("show");
      current++;
    } else {
     
      nextBtn.style.display = "none";
      submitBtn2.style.display = "block";
      descBox.innerHTML = descriptions["sg4"];
    }
  });

  
});



document.addEventListener("DOMContentLoaded", function () {
  convertPyeong("area1");
  convertPyeong("area2");
});

function convertPyeong(id) {
  const input = document.getElementById(id);
  if (!input) return;

  // 평수 표시용 라벨 생성 
  let label = document.createElement("span");
  
  label.style.fontSize = "13px";
  label.style.color = "#555";
  label.classList.add("pyeong-label");

  input.parentNode.appendChild(label);


  // 평수 계산 표시 함수
  function updatePyeong() {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 0) {
      const pyeong = (val / 3.3058).toFixed(1);
      label.textContent = `(약 ${pyeong} 평)`;
    } else {
      label.textContent = "";
    }
  }

  // 직접 입력 시 감지
  input.addEventListener("input", updatePyeong);

 
  if (input.value) {
    updatePyeong();
  }
}





document.addEventListener("DOMContentLoaded", function() {
  const downloadBtn = document.getElementById("downloadAll");

  // downloadBtn.classList.add('show');
  if (downloadBtn) {
    downloadBtn.style.display = "block";  
  }
  const chatbotWin = document.querySelector('.chatbot-window');
  if (chatbotWin) {
    chatbotWin.classList.remove('hidden'); 
    chatbotWin.classList.add('show');      
  }
});


