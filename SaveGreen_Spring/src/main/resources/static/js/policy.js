document.addEventListener("DOMContentLoaded", () => {

  //  다운로드
  const downloadAllBtn = document.getElementById("downloadAll");
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener("click", async () => {
      try {
        const resp = await fetch("/policy/download-all");
        if (!resp.ok) throw new Error("다운로드 실패");

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `policy_${getTimestamp()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        Swal.fire("완료", "정책 CSV 다운로드가 완료되었습니다.", "success");
      } catch (e) {
        Swal.fire("오류", "다운로드 중 문제가 발생했습니다.", "error");
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