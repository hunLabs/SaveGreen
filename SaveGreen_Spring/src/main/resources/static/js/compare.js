function runCompare() {
    var eikEl1 = document.getElementById('eik1');
    var eikEl2 = document.getElementById('eik2');
    var avgEl1 = document.getElementById('average1');
    var avgEl2 = document.getElementById('average2');
    

    console.log('runCompare 실행됨');
console.log('Chart 객체:', window.Chart);
console.log('캔버스들:', document.getElementById('intensityChart1'), document.getElementById('intensityChart2'), document.getElementById('intensityChart3'));

    if (!eikEl1 && !eikEl2) return;
    if (!avgEl1 && !avgEl2) return;

    var eikStr = eikEl1 && eikEl1.value !== '' ? eikEl1.value : (eikEl2 ? eikEl2.value : '');
    var avgStr = avgEl1 && avgEl1.value !== '' ? avgEl1.value : (avgEl2 ? avgEl2.value : '');

    var eik = Number(eikStr);
    var avg = Number(avgStr);

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

    //차트js
    var canvas1 = document.getElementById('intensityChart1');
    if (canvas1 && window.Chart) {
        if (window.__intensityChart1 && typeof window.__intensityChart1.destroy === 'function') {
        window.__intensityChart1.destroy();
        }
        window.__intensityChart1 = new window.Chart(canvas1, {
        type: 'bar',
        data: {
        labels: ['비교'],
        datasets: [
            { label: '선택',  data: [eik] },
            { label: '평균',  data: [avg] }
        ]
        },
        options: {
        responsive: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } }
        }
        
    });
    
    }
    var canvas2 = document.getElementById('intensityChart2');
    if (canvas2 && window.Chart) {
        if (window.__intensityChart2 && typeof window.__intensityChart2.destroy === 'function') {
        window.__intensityChart2.destroy();
        }
        window.__intensityChart2 = new window.Chart(canvas2, {
        type: 'bar',
        data: {
        labels: ['비교'],
        datasets: [
            { label: '선택',  data: [eik] },
            { label: '평균',  data: [avg] }
        ]
        },
        options: {
                
            responsive: false,
            plugins: { legend: { display: true } ,
                        title: { display: true,
                                text: "단위면적당 에너지 사용량 비교",
                                font: {size:16},
                                color:'#333'},
                    },
            scales: { y: { beginAtZero: true } }
        }
        
    });
    
    }
    var canvas3 = document.getElementById('intensityChart3');
    if (canvas3 && window.Chart) {
        if (window.__intensityChart3 && typeof window.__intensityChart3.destroy === 'function') {
        window.__intensityChart3.destroy();
        }
        window.__intensityChart3 = new window.Chart(canvas3, {
        type: 'bar',
        data: {
        labels: ['비교'],
        datasets: [
            { label: '선택',  data: [eik] },
            { label: '평균',  data: [avg] }
        ]
        },
        options: {
        responsive: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } }
        }
        
    });
    
    }
}



