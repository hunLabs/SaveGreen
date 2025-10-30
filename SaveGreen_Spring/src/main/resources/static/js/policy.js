document.addEventListener("DOMContentLoaded", () => {

  //  다운로드
  // const downloadAllBtn = document.getElementById("downloadAll");
  // if (downloadAllBtn) {
  //   downloadAllBtn.addEventListener("click", async () => {
  //     try {
  //       const resp = await fetch("/policy/download-all");
  //       if (!resp.ok) throw new Error("다운로드 실패");

  //       const blob = await resp.blob();
  //       const url = window.URL.createObjectURL(blob);
  //       const a = document.createElement("a");
  //       a.href = url;
  //       a.download = `policy_${getTimestamp()}.csv`;
  //       document.body.appendChild(a);
  //       a.click();
  //       document.body.removeChild(a);
  //       Swal.fire("완료", "정책 CSV 다운로드가 완료되었습니다.", "success");
  //     } catch (e) {
  //       Swal.fire("오류", "다운로드 중 문제가 발생했습니다.", "error");
  //     }
  //   });
  // }

const loadPoliciesBtn = document.getElementById("downloadAll"); 
if (loadPoliciesBtn) {
  loadPoliciesBtn.addEventListener("click", async () => {
    try {
      const resp = await fetch("/policy/list-all");
      if (!resp.ok) throw new Error("데이터 조회 실패");
      const data = await resp.json();

     
      let html = `
        <div style="max-height:500px; overflow:auto; text-align:left;">
        <h3>세제감면 정책 (TAX)</h3>
        <table class="policy-table">
          <thead>
            <tr>
              <th>ID</th><th>사용량 구간</th><th>재산세</th><th>취득세</th><th>면적보너스</th>
              <th>등급</th><th>비고</th>
            </tr>
          </thead>
          <tbody>`;

      data.tax.forEach(t => {
        html += `
          <tr>
            <td>${t.taxPolicyId}</td>
            <td>${t.energyUsageMin} ~ ${t.energyUsageMax}</td>
            <td>${t.tax1Discount}%</td>
            <td>${t.tax2Discount}%</td>
            <td>${t.areaBonus}%</td>
            <td>${t.energyGradeLabel || '-'}</td>
            <td>${t.note || '-'}</td>
          </tr>`;
      });

      html += `</tbody></table>
        <br>
        <h3>ZEB 인증 정책 (ZEB)</h3>
        <table class="policy-table">
          <thead>
            <tr>
              <th>ID</th><th>이름</th><th>범위(%)</th>
              <th>재산세</th><th>취득세</th><th>인증감면</th>
              <th>재생에너지지원</th><th>보너스</th>
            </tr>
          </thead>
          <tbody>`;

      data.zeb.forEach(z => {
        html += `
          <tr>
            <td>${z.zebPolicyId}</td>
            <td>${z.zebName}</td>
            <td>${z.minPercent} ~ ${z.maxPercent}</td>
            <td>${z.tax1Discount}%</td>
            <td>${z.tax2Discount}%</td>
            <td>${z.certificationDiscount}%</td>
            <td>${z.renewableSupport || '-'}</td>
            <td>${z.areaBonus}%</td>
          </tr>`;
      });

      html += `</tbody></table></div>`;

      
      Swal.fire({
        title: "정책 데이터",
        html: html,
        width: "80%",
        confirmButtonText: "닫기",
        allowOutsideClick: false,  
        allowEscapeKey: true,       
        scrollbarPadding: false,  
        customClass: {
          popup: "swal-wide"
        },
        didOpen: () => {
          document.body.style.overflow = 'hidden';  
        },
        willClose: () => {
          document.body.style.overflow = '';       
        }
      });

    } catch (e) {
      Swal.fire("오류", "정책 데이터를 불러오는데 실패했습니다.", "error");
      console.error(e);
    }
  });
}










  // 업로드
  const uploadBtn = document.getElementById("uploadAll");
  const fileInput = document.getElementById("csvFile");

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      if (!fileInput.files.length) return;

      const formData = new FormData();
      formData.append("file", fileInput.files[0]);

      Swal.fire({ title: "업로드 중...", didOpen: () => Swal.showLoading(), allowOutsideClick: false });

      try {
        const resp = await fetch("/policy/upload-all", { method: "POST", body: formData });
        const msg = await resp.text();
        Swal.fire("업로드 결과", msg, resp.ok ? "success" : "error");
      } catch (e) {
        Swal.fire("오류", "업로드 중 문제가 발생했습니다.", "error");
      }
    });
  }

});
function getTimestamp() {
  const now = new Date();
  console.log(now);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}