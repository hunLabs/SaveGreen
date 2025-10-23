// 시뮬레이터 사용법 안내
document.addEventListener("DOMContentLoaded", () => {
Swal.fire({
    title: '시뮬레이터 사용법',
    html: '<h4>에너지 등급 시뮬레이터</h4>'
         +'<b>1.</b>지도 클릭(서비스) 혹은 주소검색으로 주소,면적 입력하기<br>'
         +'<b>2.</b>태양광 패널 갯수,정격출력 입력하기<br>'
         +'<b>3.</b> 결과확인 버튼 누르기<br>'
         +'<h4>태양광 에너지 효율 경제성 시뮬레이터</h4>'
         +'<b>1.</b>지도 클릭(건물 정보 입력)<br>   혹은 주소검색으로 주소,면적 입력하기<br>'
         +'<b>2.</b>현재 등급,목표 등급 선택하기<br>'
         +'<b>3.</b>태양광 패널 정격출력 입력하기<br>'
         +'<b>4.</b> 결과확인 버튼 누르기<br>',
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
        const box = document.getElementById('resultBox1');
        const items = box.querySelectorAll('.result-item');
        const box3 = document.getElementById("intensityChart1");
        const box4 = document.getElementById("intensityChart2");
        const box5 = document.getElementById("intensityChart3");
        const box2 = document.getElementById('compareText');
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

        
        // sendAiSummary(data)
        box.style.display='block';
        box2.style.display='block';
        box3.style.display='block';
        box4.style.display='block';
        box5.style.display='block';
        runCompare();
        document.getElementById('aiSummaryBtn').style.display = 'block';
      
        items.forEach((item, index) => {
          setTimeout(() => item.classList.add('show'), index * 300);
        });
    });



    const form2 = document.getElementById('simulatorForm2');
    if (!form2) return;

    form2.addEventListener('submit', async (e) => {
        e.preventDefault();
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
        document.getElementById('aiSummaryBtn').style.display = 'block';

      
        items.forEach((item, index) => {
          setTimeout(() => item.classList.add('show'), index * 300);
        });
    });


const aiBtn = document.getElementById("aiSummaryBtn");

  aiBtn.addEventListener("click", async () => {

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

        
        실제계산은 이 기준으로 합니다:
        패널 규격: 2.2 ㎡ / 500 Wp(=0.5 kW) / 장
        설치 필요 면적(간격 포함): 패널 면적 x 1.8 = 3.96 ㎡/장
        패널 단가: 400,000원/장
        설치비(시공): 100,000원/장
        전력요금: 185.5 원/kWh
        전력 배출계수: 0.415 kgCO₂/kWh
        발전 효율 상수: 0.8

        데이터 항목 설명:
        - solarradiation: 태양광 일사량  
        - onePanelGeneration: 패널 1개당 연간 발전량  
        - onePanelCO2: 패널 1개당 연간 CO₂ 절감량  
        - annualSaveElectric: 연간 절감 전기세(만원)  
        - annualSaveCO2: 연간 절감 CO₂량(ton)  
        - total: 연간 절감 전기에너지량(kWh)
        - requiredPanels: 목표 등급 달성을 위한 필요한 패널 수  
        - propertyTax / acquireTax / areaBonus / certificationDiscount: 재산세/소득세/용적률증가/인증비용감면율
        - grade / zebGrade: 에너지 효율 등급 및 ZEB 등급  
        - energySelf: 에너지 자립률(%)  
        - category: 건물 유형 (예: 공장, 병원, 창고 등)

        ---

        결과는 반드시 다음의 3단 구조로 서술해주세요:
        ① 현재 상태 분석 — 건물의 에너지 효율, 자립률, 등급, 절세 현황  
        ② 목표 등급 달성을 위한 태양광 시나리오 — 필요한 패널 수, 절감량, CO₂ 저감 효과, 경제성  
        ③ 종합 평가 — 환경적·경제적 개선 효과, 등급 상승 가능성, 지속 가능성 관점 요약

        추가 지침:
        - 형식적 문체 대신, 보고서나 기사처럼 자연스럽고 이해하기 쉬운 문장으로 15~25줄 내외로 서술해주세요.
        - 에너지 자립률은 태양광패널개수가 입력되지않으면 0%이므로, 그 점을 고려하여 작성해주세요.
        - 에너지 효율등급은 1+++,1++,1+,1,2,3,4,5,6,7등급까지 존재합니다.예를들어 1등급은 사실상 10개중 4번째 등급이므로 중간에위치한 등급임을 인지하고 설명해주세요
        - 문단 구분은 하되, 문단 번호 제외한 기호는 삼가해주세요. 
        - 데이터 간의 관계와 의미를 분석하되, 단순 수치 나열보다 "개선 인사이트"에 초점을 맞춰주세요.  
        - 주요 수치(예: 절감량, 등급, 감면율 등)는 문장 안에 자연스럽게 포함시켜주세요.  
        - 왼쪽(기존 상태)과 오른쪽(태양광 적용 후) 데이터가 모두 존재한다면 흐름 중심으로,  
          하나만 있을 경우에는 그 데이터의 의미를 중심으로 평가해주세요.
        - 계산 기준을 가지고 이 건물의 최대 태양광 설치 가능 개수같은 수치적 접근을 해주세요

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

       실제계산은 이 기준으로 합니다:
        패널 규격: 2.2 ㎡ / 500 Wp(=0.5 kW) / 장
        설치 필요 면적(간격 포함): 패널 면적 x 1.8 = 3.96 ㎡/장
        패널 단가: 400,000원/장
        설치비(시공): 100,000원/장
        전력요금: 185.5 원/kWh
        전력 배출계수: 0.415 kgCO₂/kWh
        발전 효율 상수: 0.8

        결과는 다음 3단 구조로 작성하세요:
        ① 현재 상태 분석 — 건물의 등급, 자립률, 절세 현황  
        ② 개선 필요성 — 태양광 설치 또는 효율 개선을 통한 잠재 효과  
        ③ 종합 평가 — 향후 절감, 환경 개선, 정책 연계 가능성  

        추가 지침:
        - 형식적 문체 대신, 보고서나 기사처럼 자연스럽고 이해하기 쉬운 문장으로 10~15줄 내외로 서술해주세요.
        - 에너지 자립률은 태양광패널개수가 입력되지않으면 0%이므로, 몰라서 입력을 안했거나, 0개일수도있다는 두가지 가정을 고려하여 작성해주세요.
        - 에너지 효율등급은 1+++,1++,1+,1,2,3,4,5,6,7등급까지 존재합니다.예를들어 1등급은 사실상 10개중 4번째 등급이므로 중간에위치한 등급임을 인지하고 설명해주세요
        - 문단 구분은 하되, 문단 번호 제외한 기호는 삼가해주세요. 
        - 데이터 간의 관계와 의미를 분석하되, 단순 수치 나열보다 "개선 인사이트"에 초점을 맞춰주세요.  
        - 주요 수치(예: 절감량, 등급, 감면율 등)는 문장 안에 자연스럽게 포함시켜주세요.  
        - 왼쪽(기존 상태)과 오른쪽(태양광 적용 후) 데이터가 모두 존재한다면 비교 중심으로,  
          하나만 있을 경우에는 그 데이터의 의미를 중심으로 평가해주세요.  
        - 계산 기준을 가지고 이 건물의 최대 태양광 설치 가능 개수같은 수치적 접근을 해주세요

        [왼쪽 결과]

        ${JSON.stringify(leftResult)}
              `;
            } 
            else if (rightResult) {
              prompt = `
        이 시뮬레이터는 사용자가 지정한 "현재 등급 → 목표 등급" 구간에 따라, 
        해당 목표를 달성하기 위해 필요한 태양광 패널 수, 
        에너지 절감 효과, 탄소 절감량, 경제적 효과를 분석하는 시스템입니다.

        실제계산은 이 기준으로 합니다:
        패널 규격: 2.2 ㎡ / 500 Wp(=0.5 kW) / 장
        설치 필요 면적(간격 포함): 패널 면적 x 1.8 = 3.96 ㎡/장
        패널 단가: 400,000원/장
        설치비(시공): 100,000원/장
        전력요금: 185.5 원/kWh
        전력 배출계수: 0.415 kgCO₂/kWh
        발전 효율 상수: 0.8

        결과는 다음 3단 구조로 작성하세요:
        ① 목표 등급 분석 — 설정된 목표의 의미와 달성 기준  
        ② 필요한 태양광 규모 — 패널 수, 발전량, 절감량, CO₂ 저감 효과  
        ③ 종합 평가 — 경제성, 환경 기여, 설치 타당성 및 정책적 시사점  

        추가 지침:
        - 형식적 문체 대신, 보고서나 기사처럼 자연스럽고 이해하기 쉬운 문장으로 10~15줄 내외로 서술해주세요.
        - 에너지 자립률은 태양광패널개수가 입력되지않으면 0%이므로, 몰라서 입력을 안했거나, 0개일수도있다는 두가지 가정을 고려하여 작성해주세요.
        - 문단 구분은 하되, 문단 번호 제외한 기호는 삼가해주세요. 
        - 데이터 간의 관계와 의미를 분석하되, 단순 수치 나열보다 "개선 인사이트"에 초점을 맞춰주세요.  
        - 주요 수치(예: 절감량, 등급, 감면율 등)는 문장 안에 자연스럽게 포함시켜주세요.  
        - 왼쪽(기존 상태)과 오른쪽(태양광 적용 후) 데이터가 모두 존재한다면 비교 중심으로,  
          하나만 있을 경우에는 그 데이터의 의미를 중심으로 평가해주세요. 
        - 계산 기준을 가지고 이 건물의 최대 태양광 설치 가능 개수같은 수치적 접근을 여러가지로 해주세요

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


    const resp = await fetch("/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt })
    });

    const data = await resp.json();
    aiResult.textContent = data.reply;
    aiResult.classList.add("show");
    aiResult.textContent = data.reply.trim();

    setTimeout(() => {
      aiResult.classList.add("show");
    }, 100);
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
                          $(currentForm).find("input[name='area']").val(area);

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
                          const BM = document.querySelector('#buildingMonthly')
                          BM.value = JSON.stringify(data);
                          console.log("선택건물 월별비중:", data);
                        });

                    // 카테고리 평균 퍼센트 가져오기
                    fetch(`/energy/monthly-percent/category?category=${encodeURIComponent(cat)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                          if (!data) return;
                          const CM = document.querySelector('#categoryMonthly');
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
        const BM = document.querySelector('#buildingMonthly')
        BM.value = JSON.stringify(data);
        console.log("선택건물 월별비중:", data);
      });

  // 카테고리 평균 퍼센트 가져오기
  fetch(`/energy/monthly-percent/category?category=${encodeURIComponent(cat)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const CM = document.querySelector('#categoryMonthly');
        CM.value = JSON.stringify(data);
        console.log("비교군 월별비중:", data);
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


