// 1. URL에서 pnu 가져오기
const urlParams = new URLSearchParams(window.location.search);
const pnu = urlParams.get('pnu');

if (!pnu) {
    alert("PNU 값이 없습니다. 건물을 선택해주세요.");
} else {
    // 2. 서버에서 데이터 요청
    fetch(`/GreenFinder/energyCheck/${pnu}`)
        .then(res => {
            if (!res.ok) throw new Error("데이터 없음");
            return res.json();
        })
        .then(data => {
            console.log("서버에서 받은 데이터:", data);

            const buildingData = Array.isArray(data) ? data[0] : data;
            if (!buildingData) {
                alert("데이터가 없습니다.");
                return;
            }

            // 3. 월별 에너지 사용량 차트
            if (buildingData.monthlyConsumption?.length > 0) {
                const monthly = [...buildingData.monthlyConsumption];

                // 현재 달 기준 정렬
                const today = new Date();
                const currentMonth = today.getMonth() + 1; // 1~12

                // 지난달이 맨 앞에 오도록 재정렬
                const sortedMonthly = [];
                for (let i = 1; i <= 12; i++) {
                    let month = ((currentMonth - 1 + i - 1) % 12);
                    // currentMonth-1: 지난달부터 시작, 1~12 순환
                    const found = monthly.find(item => item.month === month);
                    if (found) sortedMonthly.push(found);
                }

                const labels = sortedMonthly.map(item => `${item.month}월`);
                const values = sortedMonthly.map(item => item.electricity);

                const ctx = document.getElementById('monthlyChart').getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: '월별 에너지 사용량 (kWh)',
                            data: values,
                            backgroundColor: 'rgba(54, 162, 235, 0.5)',
                            borderColor: 'rgba(54, 162, 235, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { position: 'top' },
                            tooltip: { mode: 'index', intersect: false }
                        },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }


            // 4. 연도별 에너지 사용량 차트
            if (buildingData.yearlyConsumption?.length > 0) {
                const sortedYearly = [...buildingData.yearlyConsumption].sort(
                    (a, b) => a.year - b.year
                );

                const labels = sortedYearly.map(item => `${item.year}년`);
                const values = sortedYearly.map(item => item.electricity);

                const ctx2 = document.getElementById('usageChart').getContext('2d');
                new Chart(ctx2, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: '연도별 에너지 사용량 (kWh)',
                            data: values,
                            backgroundColor: 'rgba(255, 159, 64, 0.2)',
                            borderColor: 'rgba(255, 159, 64, 1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { position: 'top' },
                            tooltip: { mode: 'index', intersect: false }
                        },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }

        })
        .catch(err => {
            console.error(err);
            alert("해당 건물의 에너지 데이터를 불러오지 못했습니다.");
        });
}

// 페이지 로드 시 시작/종료 월 표시
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();

    // 종료 = 현재 달
    const endMonth = today.toISOString().slice(0, 7);

    // 시작 = 현재 달 기준 1년 전
    const startMonthDate = new Date(today.getFullYear() - 1, today.getMonth(), 1);
    const startMonth = startMonthDate.toISOString().slice(0, 7);

    // 값 설정
    const startInput = document.getElementById('startMonth');
    const endInput = document.getElementById('endMonth');

    if (startInput && endInput) {
        startInput.value = startMonth;
        endInput.value = endMonth;

        startInput.disabled = true;
        endInput.disabled = true;
    }
});
