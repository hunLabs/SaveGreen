// forecast.models.js — 모델 러너/어댑터 + 종합(Ensemble) + 월/분기 분해 유틸 (IIFE, 전역/네임스페이스 동시 노출)
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
   // [추가] R² (결정계수): 1 - SS_res/SS_tot
   function _r2(y, yhat) {
      const n = Math.min(y.length, yhat.length);
      if (!n) return 0;
      const yy = []; const ff = [];
      for (let i = 0; i < n; i++) {
         const a = Number(y[i]); const f = Number(yhat[i]);
         if (Number.isFinite(a) && Number.isFinite(f)) { yy.push(a); ff.push(f); }
      }
      if (!yy.length) return 0;
      const ybar = _mean(yy);
      let ssRes = 0, ssTot = 0;
      for (let i = 0; i < yy.length; i++) {
         const d = yy[i] - ff[i];
         ssRes += d * d;
         const t = yy[i] - ybar;
         ssTot += t * t;
      }
      return ssTot === 0 ? 0 : (1 - ssRes / ssTot);
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

      const lo = yhat.map(v => Math.round(v * 0.93));
      const hi = yhat.map(v => Math.round(v * 1.07));

      const ref = Array.isArray(base?.series?.after) ? base.series.after.slice(0, n) : [];
      const kpi = {
         mae : _mae(ref, yhat),
         mape : _mape(ref, yhat),
         rmse : (function(){ // 간단 RMSE
            const n = Math.min(ref.length, yhat.length);
            if (!n) return 0;
            let acc=0,c=0; for (let i=0;i<n;i++){ const a=+ref[i], f=+yhat[i]; if(isFinite(a)&&isFinite(f)){ acc+=(a-f)*(a-f); c++; } }
            return c? Math.sqrt(acc/c):0;
         })(),
         r2  : _r2(ref, yhat)
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

      const lo = yhat.map(v => Math.round(v * 0.88));
      const hi = yhat.map(v => Math.round(v * 1.12));

      const ref = Array.isArray(base?.series?.after) ? base.series.after.slice(0, n) : [];
      const kpi = {
         mae : _mae(ref, yhat),
         mape : _mape(ref, yhat),
         rmse : (function(){ const n=Math.min(ref.length,yhat.length); if(!n)return 0; let a=0,c=0; for(let i=0;i<n;i++){const A=+ref[i],F=+yhat[i]; if(isFinite(A)&&isFinite(F)){a+=(A-F)*(A-F);c++;}} return c?Math.sqrt(a/c):0;})(),
         r2  : _r2(ref, yhat)
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
      const r2 = _mean(ok.map(r => Number(r?.kpi?.r2) || 0));

      return {
         model : { id : 'ENS', name : 'Ensemble(가중 평균)', version : '1.0'},
         years,
         yhat,
         yhat_ci : { lo, hi },
         cost : {},
         kpi : { mae, mape, rmse, r2 },
         explain : { weights: w }
      };
   }

   // ───────────────────────────────────────────────────────────
   // [추가] 연→월 분해 (계절 가중 + 보정 → 재정규화)
   //   - 입력: years[] (문자/숫자), yhat[] (연간 kWh)
   //   - 출력: [{ year, month, electricity }, ...]  // month=1..12
   //   - 옵션:
   //       • summerBoostPct (기본 0.12 → 6~8월 총합에 +12%)
   //       • winterBoostPct (기본 0.10 → 12~2월 총합에 +10%)
   //       • historyMonthly : 과거 월별 실측 배열(12개 단위 비중) 있으면 혼합
   //       • blendAlpha     : history 가중(0..1) 기본 0.7
   // ───────────────────────────────────────────────────────────
   const SEASON_WEIGHTS_DEFAULT = [ // 합계 1.0
     0.095, 0.085, 0.080, 0.070, 0.075, 0.085,
     0.105, 0.110, 0.085, 0.080, 0.065, 0.095
   ];
   function _norm(arr) {
      const s = arr.reduce((a,b)=>a+Number(b||0),0) || 1;
      return arr.map(v => Number(v||0)/s);
   }
   function expandYearlyToMonthly(years, yhat, opts = {}) {
      const Y = (years || []).map(x => Number(x));
      const F = Array.isArray(yhat) ? yhat.slice() : [];
      const summerBoostPct = Number(opts.summerBoostPct ?? 0.12);
      const winterBoostPct = Number(opts.winterBoostPct ?? 0.10);
      const hist = Array.isArray(opts.historyMonthly) ? opts.historyMonthly.slice() : null;
      const alpha = Number(opts.blendAlpha ?? 0.7);

      // 1) 기본 weights
      let w = SEASON_WEIGHTS_DEFAULT.slice();

      // 2) 역사 혼합
      if (hist && hist.length >= 12) {
         const h12 = hist.slice(-12).map(Number);
         if (h12.every(Number.isFinite)) {
            const hN = _norm(h12);
            w = w.map((v,i) => alpha*hN[i] + (1-alpha)*v);
         }
      }

      // 3) 계절 보정: 여름(6–8), 겨울(12–2)
      const w2 = w.slice();
      // 여름 합산 후 +(boost) → 재정규화
      const idxSummer = [5,6,7]; // 0-indexed: 6~8월
      const sumS = idxSummer.reduce((s,i)=>s+w2[i],0);
      for (const i of idxSummer) w2[i] *= (1 + summerBoostPct);
      // 겨울: 12,1,2
      const idxWinter = [11,0,1];
      const sumW = idxWinter.reduce((s,i)=>s+w2[i],0);
      for (const i of idxWinter) w2[i] *= (1 + winterBoostPct);
      const wN = _norm(w2);

      // 4) 분해
      const out = [];
      for (let i=0;i<Y.length;i++){
         const y = Number(Y[i]); const total = Number(F[i])||0;
         for (let m=1;m<=12;m++){
            out.push({ year: y, month: m, electricity: Math.round(total * wN[m-1]) });
         }
      }
      return out;
   }

   // [추가] 월→분기 집계
   // 입력: [{year, month, electricity}]
   // 출력: [{year, quarter:1..4, electricity}]
   function toQuarterly(monthly) {
      const out = [];
      const byKey = new Map();
      for (const r of (monthly||[])) {
         const q = Math.ceil(Number(r.month)/3);
         const key = `${r.year}-${q}`;
         const prev = byKey.get(key) || 0;
         byKey.set(key, prev + Number(r.electricity||0));
      }
      for (const [k,v] of byKey.entries()) {
         const [y,q] = k.split('-').map(Number);
         out.push({ year: y, quarter: q, electricity: v });
      }
      // 정렬
      out.sort((a,b)=> (a.year===b.year ? a.quarter-b.quarter : a.year-b.year));
      return out;
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

   // [추가 노출] 월/분기 분해 & 메트릭
   window.SaveGreen.Forecast.expandYearlyToMonthly = expandYearlyToMonthly;
   window.SaveGreen.Forecast.toQuarterly = toQuarterly;
   window.SaveGreen.Forecast.metrics = {
      mae: _mae,
      r2: _r2
   };
})();
