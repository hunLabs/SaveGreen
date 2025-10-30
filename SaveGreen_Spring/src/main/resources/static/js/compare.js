function runCompare() {
    var eikEl1 = document.getElementById('eik1');
    var eikEl2 = document.getElementById('eik2');
    var avgEl1 = document.getElementById('average1');
    var avgEl2 = document.getElementById('average2');
    var percent = document.getElementById('percent');
    const cate1 = document.getElementById('category1');
    const cate2 = document.getElementById('category2');
    
    const cat1 = cate1.value;
    const cat2 = cate2.value;

    console.log('runCompare 실행됨');
    console.log('Chart 객체:', window.Chart);
    console.log('캔버스들:', document.getElementById('intensityChart1'), document.getElementById('intensityChart2'), document.getElementById('intensityChart3'));
    console.log("현재 BM:", document.querySelector('#buildingMonthly')?.value);
    console.log("현재 CM:", document.querySelector('#categoryMonthly')?.value);
    console.log(percent);
    if (!eikEl1 && !eikEl2) return;
    if (!avgEl1 && !avgEl2) return;

    var eikStr = '';
    if (eikEl1 && eikEl1.value !== '') {
    eikStr = eikEl1.value;
    } else if (eikEl2 && eikEl2.value !== '') {
    eikStr = eikEl2.value;
    }
    var avgStr = '';
    if (avgEl1 && avgEl1.value !== '') {
    avgStr = avgEl1.value;
    } else if (avgEl2 && avgEl2.value !== '') {
    avgStr = avgEl2.value;
}
    var percent = Number(percent.value);
    if(!percent)return;

    var eik = Number(eikStr);
    var avg = Number(avgStr);
    const BM = document.getElementById('buildingMonthly');
    const CM = document.getElementById('categoryMonthly');
    console.log("서버 응답(raw):", BM.value, CM.value);
    BMlist = JSON.parse(BM.value);
    CMlist = JSON.parse(CM.value);
    
    if(!BMlist||!CMlist){
        console.log('차트 빔');
        return;
    }
    if (isNaN(eik) || isNaN(avg)) return;

    var delta = eik - avg;
    var deltaPct;
    if (avg === 0) {
        deltaPct = 0;
    } else {
        deltaPct = (delta / avg) * 100;
    }

    var absEl = document.getElementById('deltaAbs');
    if (absEl) {
        absEl.textContent = delta.toFixed(1) + ' kWh/㎡·yr';
    }
    var pctEl = document.getElementById('deltaPct');
    if (pctEl) {
        pctEl.textContent = deltaPct.toFixed(1) + ' %';
    }

    console.log(avg,eik);
    console.log(cat1,cat2);

    //차트js
    var canvas1 = document.getElementById('intensityChart1');
  
    if (window.__intensityChart1) {
        const chart = window.__intensityChart1;
        chart.data.datasets[0].data = [eik];
        chart.data.datasets[1].data = [avg];
        chart.update();
        } else {
        window.__intensityChart1 = new Chart(canvas1, {
            type: 'bar',
            data: {
            labels: [''],
            datasets: [
                { label: `선택된 건물`, data: [eik] },
                { label: `평균(${cat1})`, data: [avg] }
            ]
            },
            options: {
                responsive: false,
                plugins: { 
                    legend: { display: true },
                    title: { display: true,
                            text: "단위면적(m²)당 에너지 사용량 비교" ,
                            font:{size:22},
                            color:'#333'}
                },
                scales: { y: { beginAtZero: true } }
            }
        });
    }
    var canvas2 = document.getElementById('intensityChart2');

    if (canvas2 && window.Chart) {
        if (window.__intensityChart2) {
            const chart = window.__intensityChart2;

            chart.data.datasets[0].data = [percent, 100 - percent];
            chart.update(); 
        }      
        else {
            window.__intensityChart2 = new window.Chart(canvas2, {
            type: 'doughnut',
            data: {
                labels: ['선택된 건물'],
                datasets: [{
                data: [percent, 100 - percent],
                backgroundColor: ['#1976D2', '#E0E0E0'],
                borderWidth: 0
                }]
            },
            options: {
                
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    title: { 
                        display: true,
                        text: "에너지 사용량 비교 백분율",
                        font: { size: 24 },
                        color: '#333'
                    },
                    tooltip: { enabled: false }
                }
            },
            plugins: [{
                id: 'centerText',
                afterDraw: chart => {
                const {ctx, chartArea: {width, height}} = chart;
                ctx.save();
                ctx.font = 'bold 14px sans-serif';
                ctx.fillStyle = '#333';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`선택 건물은 ${cat1}분류에서 상위 ${percent}% 입니다`, width / 2, height / 2);
                
                }
            }]
            });
            
        }
    }
    var canvas3 = document.getElementById('intensityChart3');
    
    if (canvas3 && window.Chart) {
         if (window.__intensityChart3) {
            const chart = window.__intensityChart3;

            chart.data.datasets[0].data = BMlist;
            chart.data.datasets[1].data = CMlist;
            chart.update();

            console.log("기존 차트 데이터 업데이트 완료");
            return;
        }
        window.__intensityChart3 = new Chart(canvas3, {
            type: 'line',
            data: {
            labels: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
            datasets: [
                {
                label: '선택된 건물',
                data: BMlist,
                borderColor: '#1976D2',
                borderWidth: 2,
                tension: 0.4,
                fill: false
                },
                {
                label: `${cat1} 평균`,
                data: CMlist,
                borderColor: '#E57373',
                borderDash: [5, 5],
                borderWidth: 2,
                tension: 0.4,
                fill: false
                }
            ]
            },
            options: {
            responsive: false,
            plugins: {
                title: {
                display: true,
                text: '월별 전력 사용 비중 비교(%)',
                font: { size: 22 },
                color: '#333'
                },
                legend: {
                position: 'top',
                labels: { boxWidth: 20, font: { size: 12 } }
                }
            },
            scales: {
                y: {
                beginAtZero: true,
                max: 20,
                ticks: {
                    stepSize: 5,
                    callback: (v) => v + '%'
                },
                title: {
                    display: true,
                    text: '비중(%)'
                }
                },
                x: {
                title: {
                    display: true,
                    text: '시기(월)'
                }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeOutCubic'
            }
            }
        });
    
    }
}



function addNewResultToChart() {
    const solar = Number(document.getElementById('solarRadiation').value);
    const generation = Number(document.getElementById('onePanelGeneration').value);
    const onePanelGeneForChart = Number(document.getElementById('onePanelGeneForChart').value);
    const co2 = Number(document.getElementById('onePanelCO2').value);
    const money = Number(document.getElementById('onePanelSaveElectric').value);
    const road = document.getElementById('juso2').value || '미상 지역';
    const lat = Number(document.getElementById('lat2').value);
    const lon = Number(document.getElementById('lon2').value);
    const daySolar = Number(document.getElementById('daySolar').value);
    

    const newData = {
        location: road,
        solarRadiation: solar,
        panelGeneration: onePanelGeneForChart,
        co2PerPanel: co2,
        taxPerPanel: money,
        lat:lat,
        lon:lon,
        daySolar:daySolar
    };

    addChartData(newData); 
    console.log("차트그리기함수시작");
}

let chartDataList = [];
function addChartData(newData) {
    if (chartDataList.length >= 3) {
        chartDataList.shift();
    }
    chartDataList.push(newData);

    updateSolarEfficiencyChart();
    console.table(chartDataList);
}

function updateSolarEfficiencyChart() {
  const canvas4 = document.getElementById('solarEfficiencyChart');
  if (!canvas4) return;


  const labels = ['일평균 일사량 (kWh/m²/day)', '패널당 발전량 (100kWh)', '패널당 탄소절감 (0.1ton)', '패널당 절감액 (만원)'];

  // 지역별 데이터셋 생성
  const datasets = chartDataList.map((d, i) => ({
    label: d.location || `지역${i + 1}`,
    data: [d.daySolar, d.panelGeneration, d.co2PerPanel, d.taxPerPanel],
    backgroundColor: getColor(i), 
    borderWidth: 1
  }));

  
  if (window.__solarEfficiencyChart) {
    const chart = window.__solarEfficiencyChart;
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
  } else {
    window.__solarEfficiencyChart = new Chart(canvas4, {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: false,
        plugins: {
          legend: { position: 'top' },
          title: {
            display: true,
            text: '요소별 건물 누적 비교 차트',
            font: { size: 20 }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: '값' }
          },
          x: {
            title: { display: true, text: '요소' }
          }
        }
      }
    });
  }
}


function getColor(index) {
  const colors = [
    'rgba(25, 118, 210, 0.8)',   
    'rgba(255, 99, 132, 0.8)',  
    'rgba(76, 175, 80, 0.8)',  
    'rgba(255, 193, 7, 0.8)',   
    'rgba(156, 39, 176, 0.8)'   
  ];
  return colors[index % colors.length];
}

