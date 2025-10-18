// forecast.models.js — 모델 러너/어댑터 + 종합(Ensemble) (IIFE, 전역/네임스페이스 동시 노출)
(function () {
   // 네임스페이스 보장
   window.SaveGreen = window.SaveGreen || {};
   window.SaveGreen.Forecast = window.SaveGreen.Forecast || {};

   // 내부 유틸
   function _range(a, b) { const out = []; for (let y = a; y <= b; y++ ) out.push(String(y)); return out; }
   function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
   function _mean(arr) { if (!arr?.length) return 0; return arr.reduce((s, v) => s + v, 0) / arr.length; }
   function _mape(y, yhat) {
      const n = Math.min(y.length, yhat.length);
      if (!n) return 0;
      let acc = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
         const a = Number(y[i]); const f = Number(yhat[i]);
         if (!Number.isFinite(a) || !Number.isFinite(f) || a === 0) continue;
         acc += Math.abs((a - f) / a) * 100; cnt ++;
      }
      return cnt ? acc / cnt : 0;
   }
   function _mae(y, yhat) {
      const n = Math.min(y.length, yhat.length);
      if (!n) return 0;
      let acc = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
         const a = Number(y[i]); const f = Number(yhat[i]);
         if (!Number.isFinite(a) || !Number.isFinite(f)) continue;
         acc += Math.abs(a - f);
         cnt++;
      }
      return cnt ? acc / cnt : 0;
   }
   function _rmse(y, yhat) {
      const n = Math.min(y.length, yhat.length);
      if (!n) return 0;
      let acc = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
         const a = Number(y[i]); const f = Number(yhat[i]);
         if (!Number.isFinite(a) || !Number.isFinite(f)) continue;
         const d = a - f; acc += d * d; cnt++;
      }
      return cnt ? Math.sqrt(acc / cnt) : 0;
   }

   // years 파생(컨텍스트 / 베이스 중 가능한 소스에서)
   function deriveYears(ctx, base) {
      if (Array.isArray(base?.years) && base.years.length) return base.years.map(String);
      const now = new Date().getFullYear();
      let from = parseInt(String(ctx?.from ?? now), 10);
      let to = parseInt(String(ctx?.to ?? (now + 10)), 10);
      if (!Number.isFinite(from)) from = now;
      if (!Number.isFinite(to)) to = from + 10;
      if (to < from) [from, to] = [to, from];
      return _range(from, to);
   }

   // 베이스값 추출(없으면 기본값)
   function baselevel(base) {
      // 베이스 포캐스트가 있으면 첫 해 after 사용, 없으면 2,000,000 kwh 권장
      const a0 = Number(base?.series?.after?.[0]);
      return Number.isFinite(a0) && a0 > 0 ? a0 : 2_000_000;
   }

   // 모델 A - 선형 경향(완만 감소) + CI 밴드
   function runModelA(ctx, base) {
      const years = deriveYears(ctx, base);
      const n = years.length;
      const y0 = baselevel(base);

      // 선형 감소 경향 : 연 -4%(초반만 조금 가파르고 점차 완만)
      const yhat = Array.from({ length:n}, (_, i) => {
         const rate = _clamp(0.04 - i * 0.002, 0.015, 0.04); // 4% -> 1.5%
         const val = Math.round(y0 * Math.pow(1 - rate, i));
         return val;
      });

      // 신뢰구간(±7%)
      const lo = yhat.map(v => Math.round(v * 0.93));
      const hi = yhat.map(v => Math.round(v * 1.07));

      // 검증 지표(베이스 after와 비교 가능하면 산출, 아니면 0)
      const ref = Array.isArray(base?.series?.after) ? base.series.after.slice(0, n) : [];
      const kpi = {
         mae : _mae(ref, yhat),
         mape : _mape(ref, yhat),
         rmse : _rmse(ref, yhat)
      };

      return {
         model : { id : 'A', name : '선형회귀', version : '1.0'},
         years,
         yhat,
         yhat_ci : { lo, hi },
         cost : {},
         kpi,
         explain : {}
      };
   }

   // 모델 B - 지수 평활(감쇠율 일정) + 넓은 CI
   function runModelB(ctx, base) {
      const years = deriveYears(ctx, base);
      const n = years.length;
      const y0 = baselevel(base);

      // 지수 감쇠 : 연 -6% 고정
      const rate = 0.06;
      const yhat = Array.from({ length: n}, (_, i) => Math.round(y0 * Math.pow(1 - rate, i)));

      // 신뢰 구간(±12%)
      const lo = yhat.map(v => Math.round(v * 0.88));
      const hi = yhat.map(v => Math.round(v * 1.12));

      const ref = Array.isArray(base?.series?.after) ? base.series.after.slice(0, n) : [];
      const kpi = {
         mae : _mae(ref, yhat),
         mape : _mape(ref, yhat),
         rmse : _rmse(ref, yhat)
      };

      return {
         model : { id : 'B', name : '시계열(지수평활)', version : '1.0'},
         years,
         yhat,
         yhat_ci : { lo, hi },
         cost : {},
         kpi,
         explain : {}
      };
   }

   // 종합(Ensemble) - 가중 평균(기본 1/MAPE)
   function makeEnsemble(results) {
      const ok = Array.isArray(results) ? results.filter(r => Array.isArray(r?.yhat)) : [];
      if (!ok.length) return null;

      const years = ok[0].years.map(String);
      const n = years.length;

      // 가중치: 1/(mape + ε), 정상화
      const eps = 1e-6;
      const rawW = ok.map(r => 1 / (Math.max(0, Number(r?.kpi?.mape) || 0) + eps));
      const sumW = rawW.reduce((s, v) => s + v, 0) || 1;
      const w = rawW.map(v => v / sumW);

      // yhat 가중 평균
      const yhat = Array.from({ length: n}, (_, i) => {
         let acc = 0;
         for (let m = 0; m < ok.length; m++) acc += (ok[m].yhat[i] || 0) * w[m];
         return Math.round(acc);
      });

      // CI 가중 평균(단순)
      const lo = Array.from({ length: n}, (_, i) => {
         let acc = 0;
         for (let m = 0; m < ok.length; m++) acc += ((ok[m].yhat_ci?.lo?.[i] || ok[m].yhat[i] || 0) * w[m]);
         return Math.round(acc);
      });
      const hi = Array.from({ length: n}, (_, i) => {
         let acc = 0;
         for (let m = 0; m < ok.length; m++) acc += ((ok[m].yhat_ci?.hi?.[i] || ok[m].yhat[i] || 0) * w[m]);
         return Math.round(acc);
      });

      // 종합 KPI(단순 평균)
      const mae = _mean(ok.map(r => Number(r?.kpi?.mae) || 0));
      const mape = _mean(ok.map(r => Number(r?.kpi?.mape) || 0));
      const rmse = _mean(ok.map(r => Number(r?.kpi?.rmse) || 0));

      return {
         model : { id : 'ENS', name : 'Ensemble(가중 평균)', version : '1.0'},
         years,
         yhat,
         yhat_ci : { lo, hi },
         cost : {},
         kpi : { mae, mape, rmse },
         explain : { weights: w }
      };
   }

   // 모든 모델 실행(기본 : A, B) -> { list: [...], ensemble}
   function runAllModels(ctx, baseForecast) {
      const a = runModelA(ctx, baseForecast);
      const b = runModelB(ctx, baseForecast);
      const list = [a, b];
      const ensemble = makeEnsemble(list);
      return { list, ensemble };
   }

   // 전역 / 네임스페이스 노출
   window.SaveGreen.Forecast.runModelA = runModelA;
   window.SaveGreen.Forecast.runModelB = runModelB;
   window.SaveGreen.Forecast.runAllModels = runAllModels;
   window.SaveGreen.Forecast.makeEnsemble = makeEnsemble;
})();
