// algorithms/nutrientCalculator.js
exports.calculateGapAndSuitability = (predictedSoil, targetRequirements) => {
    // 1. අවශ්‍ය කරන Standard පරාසයන්
    const reqNMin = parseFloat(targetRequirements.Min_Nitrogen_ppm || 0);
    const reqNMax = parseFloat(targetRequirements.Max_Nitrogen_ppm || 999999);
    const reqPMin = parseFloat(targetRequirements.Min_Phosphorus_ppm || 0);
    const reqPMax = parseFloat(targetRequirements.Max_Phosphorus_ppm || 999999);
    const reqKMin = parseFloat(targetRequirements.Min_Potassium_ppm || 0);
    const reqKMax = parseFloat(targetRequirements.Max_Potassium_ppm || 999999);

    // 2. Midpoints ගණනය කිරීම (Surplus/Deficit බැලීමට)
    const midN = (reqNMin + reqNMax) / 2;
    const midP = (reqPMin + reqPMax) / 2;
    const midK = (reqKMin + reqKMax) / 2;

    // 3. වෙනස ගණනය කිරීම (Predicted NPK - Required Midpoint)
    const diffN = predictedSoil.current_n - midN;
    const diffP = predictedSoil.current_p - midP;
    const diffK = predictedSoil.current_k - midK;

    const evaluateStatus = (diff) => {
        if (diff < -5.0) return "Deficit";
        if (diff > 5.0) return "Surplus";
        return "Stable";
    };

    // 4. වගාවට සුදුසුද යන්න තීරණය කිරීම
    const isSuitable = (
        predictedSoil.current_n >= reqNMin && predictedSoil.current_n <= reqNMax &&
        predictedSoil.current_p >= reqPMin && predictedSoil.current_p <= reqPMax &&
        predictedSoil.current_k >= reqKMin && predictedSoil.current_k <= reqKMax
    );

    return {
        isSuitable,
        requirements: {
            N: { min: reqNMin, max: reqNMax, mid: midN },
            P: { min: reqPMin, max: reqPMax, mid: midP },
            K: { min: reqKMin, max: reqKMax, mid: midK }
        },
        differences: { diffN, diffP, diffK },
        statuses: {
            N: evaluateStatus(diffN),
            P: evaluateStatus(diffP),
            K: evaluateStatus(diffK)
        }
    };
};