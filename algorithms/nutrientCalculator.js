// backend/algorithms/nutrientCalculator.js

exports.calculateGapAndSuitability = (predictedSoil, targetRequirements, baseConfig, phLevel, rainfall, previousCrops) => {
  // 1. Database එකෙන් ලබා ගත් සාරවත් පසේ N-P-K අවම සීමාවන් (Baseline)
  const fertileN = baseConfig.nutrients.find(n => n.symbol === 'N');
  const fertileP = baseConfig.nutrients.find(n => n.symbol === 'P');
  const fertileK = baseConfig.nutrients.find(n => n.symbol === 'K');

  const baseN = fertileN.min;
  const baseP = fertileP.min;
  const baseK = fertileK.min;

  // 2. ML මොඩල් එක මගින් Predict කල අගයන් - strictly non-negative
  const mlN = Math.max(0, predictedSoil.ml_n || 0);
  const mlP = Math.max(0, predictedSoil.ml_p || 0);
  const mlK = Math.max(0, predictedSoil.ml_k || 0);

  // 3. Environmental Loss ගණනය කිරීම 
  const CROP_DEPLETION = {
      'Rice':   {N: 0.15, P: 0.04, K: 0.09},
      'Maize':  {N: 0.18, P: 0.05, K: 0.12},
      'Tomato': {N: 0.12, P: 0.06, K: 0.15},
      'Potato': {N: 0.10, P: 0.05, K: 0.20},
      'Cabbage':{N: 0.16, P: 0.03, K: 0.11}
  };

  let cropDepletionN = 0;
  let cropDepletionP = 0;
  let cropDepletionK = 0;

  const monthsMap = {'January':1, 'February':2, 'March':3, 'April':4, 'May':5, 'June':6, 'July':7, 'August':8, 'September':9, 'October':10, 'November':11, 'December':12};

  if (previousCrops && previousCrops.length > 0) {
      previousCrops.forEach(crop => {
          let start = parseInt(crop.startYear) * 12 + monthsMap[crop.startMonth];
          let end = parseInt(crop.endYear) * 12 + monthsMap[crop.endMonth];
          let dur = Math.max(1, end - start);
          let rates = CROP_DEPLETION[crop.cropName] || {N: 0.10, P: 0.04, K: 0.10};
          
          cropDepletionN += dur * rates.N;
          cropDepletionP += dur * rates.P;
          cropDepletionK += dur * rates.K;
      });
  }

  // 3.2 වර්ෂාව සහ pH අගය මත සේදී යාම (Leaching Loss)
  let p_availability = 0.95;
  if (phLevel < 6.0) {
      p_availability = Math.max(0.4, 0.95 - (6.0 - phLevel) * 0.2);
  } else if (phLevel > 7.0) {
      p_availability = Math.max(0.4, 0.95 - (phLevel - 7.0) * 0.2);
  }

  let rain_leaching_factor_N = Math.max(0.5, 1.0 - (rainfall / 5000));
  let rain_leaching_factor_K = Math.max(0.7, 1.0 - (rainfall / 8000)); 

  // 4. Baseline + ML එකතුවෙන් Depletion අඩු කිරීම
  let totalN = Math.max(0, baseN + mlN - cropDepletionN);
  let totalP = Math.max(0, baseP + mlP - cropDepletionP);
  let totalK = Math.max(0, baseK + mlK - cropDepletionK);

  // 5. ඉතිරි අගයෙන් සේදී යාම (Leaching) අඩු කර Current අගය සෑදීම
  let currentN = totalN * rain_leaching_factor_N;
  let currentP = totalP * p_availability;
  let currentK = totalK * rain_leaching_factor_K;

  // සමස්ත Environmental Loss අගය (Leaching + Crop Depletion) - සෘණ අගයන් වළක්වා ඇත
  let envLossN = Math.max(0, (baseN + mlN) - currentN); 
  let envLossP = Math.max(0, (baseP + mlP) - currentP);
  let envLossK = Math.max(0, (baseK + mlK) - currentK);

  const safeCurrentN = currentN || 0;
  const safeCurrentP = currentP || 0;
  const safeCurrentK = currentK || 0;

  const diffN = safeCurrentN >= fertileN.min && safeCurrentN <= fertileN.max ? 0 : (safeCurrentN < fertileN.min ? safeCurrentN - fertileN.min : safeCurrentN - fertileN.max);
  const diffP = safeCurrentP >= fertileP.min && safeCurrentP <= fertileP.max ? 0 : (safeCurrentP < fertileP.min ? safeCurrentP - fertileP.min : safeCurrentP - fertileP.max);
  const diffK = safeCurrentK >= fertileK.min && safeCurrentK <= fertileK.max ? 0 : (safeCurrentK < fertileK.min ? safeCurrentK - fertileK.min : safeCurrentK - fertileK.max);

  const isFertile = (diffN === 0 && diffP === 0 && diffK === 0);

  const reqNMin = parseFloat(targetRequirements.Min_Nitrogen_ppm || 0);
  const reqNMax = parseFloat(targetRequirements.Max_Nitrogen_ppm || 999999);
  const reqPMin = parseFloat(targetRequirements.Min_Phosphorus_ppm || 0);
  const reqPMax = parseFloat(targetRequirements.Max_Phosphorus_ppm || 999999);
  const reqKMin = parseFloat(targetRequirements.Min_Potassium_ppm || 0);
  const reqKMax = parseFloat(targetRequirements.Max_Potassium_ppm || 999999);

  const isSuitableForCrop = (
      safeCurrentN >= reqNMin && safeCurrentN <= reqNMax &&
      safeCurrentP >= reqPMin && safeCurrentP <= reqPMax &&
      safeCurrentK >= reqKMin && safeCurrentK <= reqKMax
  );

  const evaluateCropStatus = (current, min, max) => {
      if (current < min) return "Deficit";
      if (current > max) return "Surplus";
      return "Optimal";
  };

  return {
      isSuitable: isSuitableForCrop,
      isFertile: isFertile,
      currentLevels: { N: safeCurrentN, P: safeCurrentP, K: safeCurrentK },
      breakdown: {
          N: { base: baseN, ml: mlN, loss: envLossN },
          P: { base: baseP, ml: mlP, loss: envLossP },
          K: { base: baseK, ml: mlK, loss: envLossK }
      },
      requirements: {
          N: { min: reqNMin, max: reqNMax },
          P: { min: reqPMin, max: reqPMax },
          K: { min: reqKMin, max: reqKMax }
      },
      differences: { diffN, diffP, diffK }, 
      statuses: { 
          N: evaluateCropStatus(safeCurrentN, reqNMin, reqNMax), 
          P: evaluateCropStatus(safeCurrentP, reqPMin, reqPMax), 
          K: evaluateCropStatus(safeCurrentK, reqKMin, reqKMax) 
      } 
  };
};