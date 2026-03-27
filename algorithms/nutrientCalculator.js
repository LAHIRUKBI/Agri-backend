const calculateMonths = (startMonth, startYear, endMonth, endYear) => {
    const months = { 'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6, 'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12 };
    const diff = (parseInt(endYear) - parseInt(startYear)) * 12 + (months[endMonth] - months[startMonth]);
    return diff > 0 ? diff : 1;
};

exports.calculateCurrentNutrients = (baseConfig, pastCrops) => {
    let n = baseConfig?.nutrients.find(nut => nut.symbol === 'N')?.min || 50;
    let p = baseConfig?.nutrients.find(nut => nut.symbol === 'P')?.min || 20;
    let k = baseConfig?.nutrients.find(nut => nut.symbol === 'K')?.min || 100;

    let deltaN = 0, deltaP = 0, deltaK = 0;

    pastCrops.forEach(crop => {
        const duration = calculateMonths(crop.startMonth, crop.startYear, crop.endMonth, crop.endYear);
        
        deltaN -= (duration * 1.2);
        deltaP -= (duration * 0.4);
        deltaK -= (duration * 0.8);

        const fert = (crop.fertilizers || "").toLowerCase();

        if (fert.includes('urea') || fert.includes('යූරියා')) deltaN += 15;
        if (fert.includes('npk')) { deltaN += 10; deltaP += 10; deltaK += 10; }
        if (fert.includes('compost')) { deltaN += 5; deltaP += 5; deltaK += 5; }
    });

    return {
        baseline: { N: n, P: p, K: k },
        historyImpact: { N: deltaN, P: deltaP, K: deltaK },
        current: {
            N: Math.max(0, n + deltaN),
            P: Math.max(0, p + deltaP),
            K: Math.max(0, k + deltaK)
        }
    };
};