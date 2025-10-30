const chatbotData = {

  //초기화면
  root: {
    text: "무엇이 궁금하신가요?",
    options: [
      { text: "건물정보검색", next: "finder" },
      { text: "에너지등급과 ZEB", next: "tax" },
      { text: "에너지 리모델링", next: "green" },
      { text: "에너지 시뮬레이터", next: "simulator" },
      { text: "시뮬레이터 계산 기준", next: "calc" }
    ]
  },

  // 건물정보검색
  finder: {
     text: 
    `<div class="text-container">
      <p>
        건물정보검색은 주소를 입력하면<br> 해당 건물의 <b>에너지 사용량</b>, <br> <b>에너지 등급</b>,
        <b>ZEB 등급</b> 등을 <br> <b>ENERGY SIMULATOR, <br> ENERGY REMODELING</b> 페이지로 <br> 연결하여 확인할 수 있습니다.
      </p>
    </div>
    `
    ,
    options: [
      { text: "이전으로", next: "root" }
    ]
  },

  // 에너지 리모델링
  green: {
     text: 
    `에너지 리모델링 페이지는 선택된 건물의 향후 예측을 <b>머신러닝</b>을 통해 제공합니다.
    `
    ,
    options: [
      { text: "머신러닝 계산 기준", next: "calc_m" },
      { text: "머신러닝 예측 모델", next: "predict_model" },
      { text: "이전으로", next: "root" }
    ]
  },
  
  calc_m: {
     text: 
    `카드에 표시되는 항목들의 계산 기준은 다음과 같습니다.
    `
    ,
    options: [
      { text: "연간 절감 비용", next: "yearly_save" },
      { text: "투자 회수 기간", next: "payback" },
      { text: "에너지 절감률", next: "energy_save" },
      { text: "에너지 등급", next: "energy_grade" },
      { text: "이전으로", next: "green" },
      { text: "처음으로", next: "root" }
    ]
  },
  yearly_save: {
     text: 
    `<div class="text-container">
      <p>
        <b>연간 절감 비용</b>은 다음과 같은 식으로 <br> 계산됩니다.
      </p>

      <p class="formula">
        연간 절감 비용 = (연간 절감 전력량) x (전기요금 단가)
      </p>

      <p>
        <b>연간 절감 전력량</b>은 에너지 리모델링을 적용했을 때 예상되는 전력 사용량 <br> 감소량을 의미합니다.<br>
        <b>전기요금 단가</b>는 2024년 산업용 <br> 전기요금 기준으로 <b>185.5원/kWh</b>가 적용됩니다.
      </p>
    </div>
    `
    ,
    options: [
     
      { text: "이전으로", next: "calc_m" },
      { text: "처음으로", next: "root" }
    ]
  },
  payback: {
     text: 
    ` <div class="text-container">
        <p>
          <b>투자 회수기간</b>은 다음과 같은 식으로 계산됩니다.
        </p>

        <p class="formula">
          투자 회수기간 = (초기 투자비) ÷ (연간 절감 비용)
        </p>

        <p>
          <b>초기 투자비</b>는 에너지 리모델링에 소요되는 총 비용을 의미합니다.<br>
          여기에는 <b>건물 옥상 평탄화 공사비</b>와 <b>태양광 패널 설치비</b>가 포함됩니다.<br>
          <b>연간 절감 비용</b>은 리모델링 이후 절감되는 전기요금을 기준으로 산정됩니다.
        </p>
      </div>
    `
    ,
    options: [
      
      { text: "이전으로", next: "calc_m" },
      { text: "처음으로", next: "root" }
    ]
  },
  energy_save: {
     text: 
    `<div class="text-container">
      <p>
        <b>에너지 절감률</b>은 다음과 같은 식으로 <br> 계산됩니다.
      </p>

      <p class="formula">
        에너지 절감률 = (연간 절감 전력량 ÷ 기준 전력 사용량) x 100
      </p>

      <p>
        <b>연간 절감 전력량</b>은 에너지 리모델링으로 인해 감소된 전력 사용량을 의미합니다.<br>
        <b>기준 전력 사용량</b>은 리모델링 이전의 <br> 연간 전력 사용량을 의미합니다.
      </p>
    </div>
    `
    ,
    options: [
      
      { text: "이전으로", next: "calc_m" },
      { text: "처음으로", next: "root" }
    ]
  },
  energy_grade: {
     text: 
    `<div class="text-container">
      <p>
        <b>에너지 등급</b>은 다음 기준으로 <br> 책정됩니다.
      </p>

      <p class="formula">
        에너지 등급 = 단위면적(m²)당 <br> 에너지 사용량 (kWh/m<sup>2</sup>)
      </p>

      <p>
        에너지 등급은 <b>1+++ 등급</b>부터 <br> <b>7등급</b>까지 존재하며,
        숫자가 낮을수록 에너지 효율이 높습니다.<br>
        그중 <b>1+++ 등급</b>이 가장 높은 효율을 <br> 의미합니다.
      </p>
    </div>
    `
    ,
    options: [
      
      { text: "이전으로", next: "calc_m" },
      { text: "처음으로", next: "root" }
    ]
  },

  predict_model: {
     text: 
    `에너지 리모델링 페이지에 사용된 머신 러닝 예측 모델은 다음과 같습니다.
    `
    ,
    options: [
      { text: "A : 엘라스틱 네트", next: "elastic" },
      { text: "B : 랜덤 포레스트", next: "randomforest" },
      { text: "C : 앙상블", next: "ensemble" },
      { text: "이전으로", next: "green" },
      { text: "처음으로", next: "root" }
    ]
  },
  elastic: {
     text: 
    `<div class="text-container">
      <p>
        <b>모델 A </b>는 <br>  <b>엘라스틱 네트(Elastic Net)</b> 회귀 모델로,
        라쏘(Lasso) 회귀와 <br> 릿지(Ridge) 회귀의 장점을 결합한 <br> <b>선형 회귀 모델</b>입니다.
      </p>

      <p>
        두 규제 항(<b>L1</b>, <b>L2</b>)을 함께 사용하여 <br> <b>과적합을 억제</b>하고,
        가중치의 안정성과 <br> 해석 가능성을 동시에 확보할 수 <br> 있습니다.
      </p>

      <p>
        또한 변수 간 상관관계가 높은 데이터에서도
        <b>보다 균형 잡힌 가중치 분배</b>를 제공하는 특징이 있습니다.
      </p>
    </div>
    `
    ,
    options: [
      
      { text: "이전으로", next: "predict_model" },
      { text: "처음으로", next: "root" }
    ]
  },
  randomforest: {
     text: 
    `<div class="text-container">
      <p>
        <b>모델 B</b>는 <br> <b>랜덤 포레스트(Random Forest)</b> 모델로,
        여러 개의 <b>결정 트리(Decision Tree)</b> 예측 결과를 결합한 <b>앙상블 학습 기법</b>입니다.
      </p>

      <p>
        각 트리는 데이터의 일부 특징과 표본을 무작위로 선택해 학습하며,<br>
        모든 트리의 예측값을 <b>평균(또는 다수결)</b>하여 최종 결과를 도출합니다.
      </p>

      <p>
        단일 트리보다 <b>과적합에 강하고</b>,<br>
        <b>비선형적인 관계</b>를 효과적으로 해석할 수 있다는 장점이 있습니다.
      </p>
    </div>
    `
    ,
    options: [
      
      { text: "이전으로", next: "predict_model" },
      { text: "처음으로", next: "root" }
    ]
  },
  ensemble: {
     text: 
    `<div class="text-container">
      <p>
        <b>모델 C</b>는 <br>  <b>앙상블(Ensemble)</b> 모델로,<br>
        <b>엘라스틱 네트(Elastic Net)</b>과 <br> <b>랜덤 포레스트(Random Forest)</b>의 예측을 결합한 모델입니다.
      </p>

      <p>
        두 모델의 예측값을 <b>가중 평균</b>하여,<br>
        더 높은 성능을 보이는 모델에 <b>가중치</b>를 두는 방식으로 결과를 산출합니다.
      </p>

      <p>
        이를 통해 <b>선형적 해석력(엘라스틱넷)</b>과<br>
        <b>비선형적 표현력(랜덤 포레스트)</b>을 모두 반영할 수 있는 장점이 있습니다.
      </p>
    </div>
    `
    ,
    options: [
      
      { text: "이전으로", next: "predict_model" },
      { text: "처음으로", next: "root" }
    ]
  },


  // 시뮬레이터
  simulator: {
    text: "두 가지 시뮬레이터중 선택 해 주세요.",
    options: [
      { text: "에너지 등급 시뮬레이터", next: "simulator_detail_grade" },
      { text: "태양광 패널 시뮬레이터", next: "simulator_detail_solar" },
      { text: "이전으로", next: "root" }
    ]
  },
  simulator_detail_grade: {
    text: 
    `<div class="text-container">
      <p>
        검색된 <b>건물의 에너지 등급</b>을 알 수 있는 시뮬레이터로,
        <b>건물 면적, 에너지 사용량, 발전량</b>(태양광 패널 규격 및 수량 입력 시)을 고려하여
        <b>책정된 등급</b>과 이에 따른 <b>혜택</b>이 표시됩니다.
      </p>
      <p>
        또한 결과 창 아래의 표는, 검색된 건물의 <b>에너지 사용량</b>과 <b>월별 사용량</b>을
        동일 <br> 카테고리의 <b>평균과 비교</b>한 것입니다.
      </p>
    </div>`,
    options: [
      { text: "이전으로", next: "simulator" },
      { text: "처음으로", next: "root" }
    ]
  },
  simulator_detail_solar: {
    text: 
    `<div class="text-container">
      <p>
        태양광 패널 시뮬레이터는 <br> <b>건물, 면적, 패널 규격을 입력</b>하면
        <b>필요한 패널 수량</b>과 <b>예상 발전량, 탄소 절감량</b>을 계산해줍니다.
      </p>
      <p>
        또한 결과 창 아래의 표는 입력된 결과창에서 표시되지 않는<br>
        <b>패널 1개당 정보</b>를 포함하고 있으며,<br>
        여러 번 검색 시 <b>최대 3개</b>까지 누적되어<br>
        각 검색 <b>결과를 상호 비교</b>할 수 있습니다.
      </p>
    </div>`,
    options: [
      { text: "이전으로", next: "simulator" },
      { text: "처음으로", next: "root" }
    ]
  },


  tax: {
    text: 
    `<div class="text-container">
    <p>
      <b>에너지 등급</b>과 <b>ZEB 등급</b>은 각각의 기준과 정책을 가지고 있습니다.
    </p>

    <h4>에너지 등급 기준</h4>
    <p>단위면적(m²)당 에너지 사용량 기준 (kWh/m<sup>2</sup>)</p>
    <ul>
      <li>1+++ 등급 : 0 ~ 80</li>
      <li>1++ 등급 : 80 ~ 140</li>
      <li>1+ 등급 : 140 ~ 200</li>
      <li>1등급 : 200 ~ 260</li>
      <li>2등급 : 260 ~ 320</li>
      <li>3등급 : 320 ~ 380</li>
      <li>4등급 : 400 ~ 450</li>
      <li>5등급 : 480 ~ 520</li>
      <li>6등급 : 560 ~ 610</li>
      <li>7등급 : 610 이상</li>
    </ul>

    <h4>ZEB 등급 기준</h4>
    <p>전체 에너지 사용량 대비 에너지 자립률 기준 (%)</p>
    <ul>
      <li>+ 등급 : 120% 이상</li>
      <li>1등급 : 100% ~ 120%</li>
      <li>2등급 : 80% ~ 100%</li>
      <li>3등급 : 60% ~ 80%</li>
      <li>4등급 : 40% ~ 60%</li>
      <li>5등급 : 20% ~ 40%</li>
    </ul>

    <p>
      각 등급에 따른 감면 및 혜택 정책은 아래에서 확인할 수 있습니다.
    </p>
    </div>`,
    options: [
      { text: "에너지등급 정책", next: "energyGrade" },
      { text: "ZEB등급 정책", next: "ZEBGrade" },
      { text: "이전으로", next: "root" }
    ]
  },
  energyGrade: {
    text:  
    `<div class="text-container">
      <p>
        에너지 등급은 단위면적(m²)당 에너지 사용량(kWh/m<sup>2</sup>)으로 책정되며,<br>
        1+++ 등급부터 7등급까지 존재합니다.<br>
        <b>1+++ 등급</b>이 가장 높은 등급입니다.
      </p>

      <h4>재산세 감면 기준</h4>
      <ul>
        <li>1+++ 등급 : 10% 감면</li>
        <li>1++ 등급 : 9% 감면</li>
        <li>1+ 등급 : 5% 감면</li>
        <li>1등급 : 3% 감면</li>
        <li>그 이하는 감면 없음</li>
      </ul>

      <h4>취득세 감면 기준</h4>
      <ul>
        <li>1+++ 등급 : 10% 감면</li>
        <li>1++ 등급 : 9% 감면</li>
        <li>1+ 등급 : 7% 감면</li>
        <li>1등급 : 3% 감면</li>
        <li>그 이하는 감면 없음</li>
      </ul>

      <h4>용적률 증가 기준</h4>
      <ul>
        <li>1+++ 등급 : 14% 증가</li>
        <li>1++ 등급 : 12% 증가</li>
        <li>1+ 등급 : 6% 증가</li>
        <li>1등급 : 3% 증가</li>
        <li>그 이하는 증가 없음</li>
      </ul>

      <p>
        에너지 등급은 별도의 <b>인증 감면 혜택</b>이 없습니다.
      </p>
    </div>

  `,
    options: [
      { text: "이전으로", next: "tax" },
      { text: "처음으로", next: "root" }
    ]
  },

  ZEBGrade: {
    text: 
    `<div class="text-container">
      <p>
        ZEB 등급은 전체 에너지 사용량 대비 <b>에너지 자립률</b>로 책정되며,<br>
        <b>+ 등급</b>부터 <b>5등급</b>까지 존재합니다.<br>
        <b>+ 등급</b>이 가장 높은 등급입니다.
      </p>

      <h4>재산세 감면 기준</h4>
      <ul>
        <li>5등급 : 15% 감면</li>
        <li>4등급 : 18% 감면</li>
        <li>3등급 : 20% 감면</li>
        <li>2등급 : 20% 감면</li>
        <li>1등급 : 20% 감면</li>
        <li>+ 등급 : 20% 감면</li>
      </ul>

      <h4>취득세 감면 기준</h4>
      <ul>
        <li>5등급 : 5% 감면</li>
        <li>4등급 : 10% 감면</li>
        <li>3등급 : 15% 감면</li>
        <li>2등급 : 15% 감면</li>
        <li>1등급 : 15% 감면</li>
        <li>+ 등급 : 15% 감면</li>
      </ul>

      <h4>용적률 증가 기준</h4>
      <ul>
        <li>5등급 : 11% 증가</li>
        <li>4등급 : 12% 증가</li>
        <li>3등급 : 13% 증가</li>
        <li>2등급 : 14% 증가</li>
        <li>1등급 : 15% 증가</li>
        <li>+ 등급 : 15% 증가</li>
      </ul>

      <h4>인증비용 지원 기준</h4>
      <ul>
        <li>5등급 : 30% 지원</li>
        <li>4등급 : 50% 지원</li>
        <li>3등급 : 100% 지원</li>
        <li>2등급 : 100% 지원</li>
        <li>1등급 : 100% 지원</li>
        <li>+ 등급 : 100% 지원</li>
      </ul>
    </div>
`,
    options: [
      { text: "이전으로", next: "tax" },
      { text: "처음으로", next: "root" }
    ]
  },

  calc: {
    text: "시뮬레이터 계산에 사용된 변수입니다.",
    options: [
      { text: "연간 일사량", next: "solarRadiation" },
      { text: "연간 패널 발전량", next: "panelGeneration" },
      { text: "전기세, 탄소배출계수", next: "referenceValue" },
      { text: "이전으로", next: "root" }
    ]
  },
  solarRadiation: {
    text:  
    `<div class="text-container">
      <p>
        <b>연간 일사량</b>은 다음과 같이 계산됩니다.
      </p>

      <p class="formula">
        연간 일사량 = (일사량) x (연간 일수)
      </p>

      <p>
        주소를 입력하면 해당 지역의 <b>일사량</b>이 NASA API를 통해 호출 됩니다.<br>
        2025년은 윤년이므로 <br> <b>366일</b>로 계산됩니다.
      </p>
      </div>`,
    options: [
      { text: "이전으로", next: "calc" },
      { text: "처음으로", next: "root" }
    ]
  },
  panelGeneration: {
    text: 
    `<div class="text-container">
      <p>
        <b>연간 발전량</b>은 다음과 같은 식으로 계산됩니다.
      </p>
      <p class="formula">
        연간 발전량 = (일사량) x (연간 일수) x (패널 정격 출력 Wp) x (패널 효율) x (패널 개수)
      </p>

      <p>각 변수의 의미는 다음과 같습니다:</p>
      <ul>
        <li><b>패널 정격 출력(Wp)</b> : 페이지 내 선택 항목으로, 시중에 판매되는 패널 모델 중 선택 가능합니다.</li>
        <li><b>패널 효율</b> : 고정값 0.8로 설정되어 있습니다.</li>
        <li><b>패널 개수</b> : 입력된 건물 면적과 패널 <br> 규격을 기준으로 자동 계산됩니다.</li>
      </ul>
    </div>`,
    options: [
      { text: "이전으로", next: "calc" },
      { text: "처음으로", next: "root" }
    ]
  }, 
  referenceValue: {
    text: 
    `<div class="text-container">
      <p>
        <b>연간 전기세</b>와 <b>연간 탄소 절감량</b>은 <br> 다음의 공식으로 계산됩니다.
      </p>

      <h4>연간 전기세 계산</h4>
      <p class="formula">
        연간 전기세 = (연간 발전량) x (2024년 산업시설 전기요금 단가)
      </p>
      <p>
        현재 산업시설 전기요금은 평균 <b>185.5원/kWh</b>으로 책정되어 있습니다.
      </p>

      <h4>연간 탄소 절감량 계산</h4>
      <p class="formula">
        연간 탄소 절감량 = (연간 발전량) x (2025년 국가 탄소배출계수)
      </p>
      <p>
        2025년 대한민국의 <b>탄소배출계수</b>는 <b>0.419 kgCO₂/kWh</b>입니다.
      </p>
    </div>`,
    options: [
      { text: "이전으로", next: "calc" },
      { text: "처음으로", next: "root" }
    ]
  }
};

let currentState = "root";

function renderChatbot(state) {
  const body = document.querySelector('.chatbot-body');
  body.innerHTML = "";

  const data = chatbotData[state];
  if (!data) return;

  const p = document.createElement('p');
  p.innerHTML = data.text;
  body.appendChild(p);

  data.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.classList.add('chatbot-btn');
    btn.innerHTML = opt.text;
    btn.dataset.next = opt.next;
    body.appendChild(btn);
      if (opt.text === "이전으로") {
        btn.classList.add('chatbot-prev');
      } else if (opt.text === "처음으로") {
        btn.classList.add('chatbot-home');
      } else {
        btn.classList.add('chatbot-cbtn');
      }
    });

  currentState = state;
}

document.addEventListener('click', function(e) {

  if (e.target.closest('#chatbot')) {
    const win = document.querySelector('.chatbot-window');
    win.classList.toggle('hidden');
    renderChatbot('root'); 
  }


  if (e.target.closest('.chatbot-close')) {
    const win = document.querySelector('.chatbot-window');
    win.classList.add('hidden');
  }


  if (e.target.classList.contains('chatbot-btn')) {
    const next = e.target.dataset.next;
    renderChatbot(next);
  }
});


document.addEventListener('DOMContentLoaded', () => {
  renderChatbot('root');
});
