// backend/algorithms/nutrientCalculator.js

exports.calculateGapAndSuitability = (predictedSoil, targetRequirements, baseConfig) => {
    // 1. SoilConfig.js මගින් Database එකෙන් ලබා ගත් සාරවත් පසේ N-P-K සීමාවන්
    const fertileN = baseConfig.nutrients.find(n => n.symbol === 'N');
    const fertileP = baseConfig.nutrients.find(n => n.symbol === 'P');
    const fertileK = baseConfig.nutrients.find(n => n.symbol === 'K');

    const soilNMin = fertileN.min;
    const soilNMax = fertileN.max;
    const soilPMin = fertileP.min;
    const soilPMax = fertileP.max;
    const soilKMin = fertileK.min;
    const soilKMax = fertileK.max;

    // 2. පසේ N-P-K අගයන් සාරවත් සීමාව තුල තිබේදැයි බලා එහි වෙනස සෙවීම (Soil Nutrient Status වගුව සඳහා)
    // සීමාව තුල නම් වෙනස 0 වේ. සීමාවෙන් පිට නම් අදාළ හිඟය හෝ අතිරික්තය ගණනය කෙරේ.
    const calculateSoilDifference = (current, min, max) => {
        if (current >= min && current <= max) {
            return 0; 
        } else if (current < min) {
            return current - min; // සීමාවට වඩා අඩු නම් (Deficit)
        } else {
            return current - max; // සීමාවට වඩා වැඩි නම් (Surplus)
        }
    };

    const diffN = calculateSoilDifference(predictedSoil.current_n, soilNMin, soilNMax);
    const diffP = calculateSoilDifference(predictedSoil.current_p, soilPMin, soilPMax);
    const diffK = calculateSoilDifference(predictedSoil.current_k, soilKMin, soilKMax);

    // පස සාරවත්ද යන්න තීරණය කිරීම (අගයන් 3ම සීමාව තුල තිබේනම් පමණක් සාරවත් වේ)
    const isFertile = (diffN === 0 && diffP === 0 && diffK === 0);

    // 3. Target Crop එකට අවශ්‍ය පරාසයන්
    const reqNMin = parseFloat(targetRequirements.Min_Nitrogen_ppm || 0);
    const reqNMax = parseFloat(targetRequirements.Max_Nitrogen_ppm || 999999);
    const reqPMin = parseFloat(targetRequirements.Min_Phosphorus_ppm || 0);
    const reqPMax = parseFloat(targetRequirements.Max_Phosphorus_ppm || 999999);
    const reqKMin = parseFloat(targetRequirements.Min_Potassium_ppm || 0);
    const reqKMax = parseFloat(targetRequirements.Max_Potassium_ppm || 999999);

    // වගාවට සුදුසුද යන්න තීරණය කිරීම
    const isSuitableForCrop = (
        predictedSoil.current_n >= reqNMin && predictedSoil.current_n <= reqNMax &&
        predictedSoil.current_p >= reqPMin && predictedSoil.current_p <= reqPMax &&
        predictedSoil.current_k >= reqKMin && predictedSoil.current_k <= reqKMax
    );

    // 4. බෝගයට සාපේක්ෂව පසේ තත්වය සෙවීම (Calculation Logic Viewer හි Crop Specific Gap සඳහා)
    const evaluateCropStatus = (current, min, max) => {
        if (current < min) return "Deficit";
        if (current > max) return "Surplus";
        return "Optimal";
    };

    const cropStatusN = evaluateCropStatus(predictedSoil.current_n, reqNMin, reqNMax);
    const cropStatusP = evaluateCropStatus(predictedSoil.current_p, reqPMin, reqPMax);
    const cropStatusK = evaluateCropStatus(predictedSoil.current_k, reqKMin, reqKMax);

    return {
        isSuitable: isSuitableForCrop,
        isFertile: isFertile,
        requirements: {
            N: { min: reqNMin, max: reqNMax, mid: (reqNMin + reqNMax) / 2 },
            P: { min: reqPMin, max: reqPMax, mid: (reqPMin + reqPMax) / 2 },
            K: { min: reqKMin, max: reqKMax, mid: (reqKMin + reqKMax) / 2 }
        },
        // Main Table එකේ Difference කොලම් එකට පසේ සීමාවන්ට අදාළ වෙනස යවයි
        differences: { diffN, diffP, diffK }, 
        // Crop Specific Nutrient Gap එකට බෝගයට අදාළ තත්වය (Deficit/Surplus/Optimal) යවයි
        statuses: { N: cropStatusN, P: cropStatusP, K: cropStatusK } 
    };
};