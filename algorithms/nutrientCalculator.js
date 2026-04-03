const calculateMonths = (startMonth, startYear, endMonth, endYear) => {
    const months = { 'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6, 'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12 };
    const diff = (parseInt(endYear) - parseInt(startYear)) * 12 + (months[endMonth] - months[startMonth]);
    return diff > 0 ? diff : 1;
};

exports.calculateCurrentNutrients = (baseConfig, pastCrops) => {
    console.log("\n--- [CALCULATOR] Starting Nutrient Calculation ---");
    let n = baseConfig?.nutrients.find(nut => nut.symbol === 'N')?.min || 50;
    let p = baseConfig?.nutrients.find(nut => nut.symbol === 'P')?.min || 20;
    let k = baseConfig?.nutrients.find(nut => nut.symbol === 'K')?.min || 100;

    console.log(`[CALCULATOR] Baseline Soil: N=${n}, P=${p}, K=${k}`);

    let deltaN = 0, deltaP = 0, deltaK = 0;

    pastCrops.forEach(crop => {
        const duration = calculateMonths(crop.startMonth, crop.startYear, crop.endMonth, crop.endYear);
        
        // Base depletion
        let cropDeltaN = -(duration * 1.2);
        let cropDeltaP = -(duration * 0.4);
        let cropDeltaK = -(duration * 0.8);

        const fert = (crop.fertilizers || "").toLowerCase();

        // Fertilizer additions
        if (fert.includes('urea') || fert.includes('යූරියා')) cropDeltaN += 15;
        if (fert.includes('npk')) { cropDeltaN += 10; cropDeltaP += 10; cropDeltaK += 10; }
        if (fert.includes('compost')) { cropDeltaN += 5; cropDeltaP += 5; cropDeltaK += 5; }

        console.log(`[CALCULATOR] Crop: ${crop.cropName} (${duration} months) -> N Change: ${cropDeltaN.toFixed(2)}, P Change: ${cropDeltaP.toFixed(2)}, K Change: ${cropDeltaK.toFixed(2)}`);

        deltaN += cropDeltaN;
        deltaP += cropDeltaP;
        deltaK += cropDeltaK;
    });

    const result = {
        baseline: { N: n, P: p, K: k },
        historyImpact: { N: deltaN, P: deltaP, K: deltaK },
        current: {
            N: Math.max(0, n + deltaN),
            P: Math.max(0, p + deltaP),
            K: Math.max(0, k + deltaK)
        }
    };

    console.log(`[CALCULATOR] Final Current Soil Estimation: N=${result.current.N.toFixed(2)}, P=${result.current.P.toFixed(2)}, K=${result.current.K.toFixed(2)}`);
    console.log("--------------------------------------------------\n");

    return result;
};