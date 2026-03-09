const calculateMonths = (startMonth, startYear, endMonth, endYear) => {
    const months = { 'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6, 'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12 };
    
    if (months[startMonth] && months[endMonth]) {
        const yDiff = parseInt(endYear) - parseInt(startYear);
        const mDiff = months[endMonth] - months[startMonth];
        const total = (yDiff * 12) + mDiff;
        return total > 0 ? total : 1; 
    }
    return 3; 
};

exports.calculateCurrentNutrients = (baseConfig, pastCrops) => {
    // 1. Get Base levels from SoilNutrientsPage config
    const baseN = baseConfig?.nutrients.find(n => n.symbol === 'N')?.min || 50;
    const baseP = baseConfig?.nutrients.find(n => n.symbol === 'P')?.min || 20;
    const baseK = baseConfig?.nutrients.find(n => n.symbol === 'K')?.min || 100;

    // 2. Track the exact Increase/Decrease
    let deltaN = 0;
    let deltaP = 0;
    let deltaK = 0;

    pastCrops.forEach(crop => {
        const monthsFarmed = calculateMonths(crop.startMonth, crop.startYear, crop.endMonth, crop.endYear);
        
        // Depletion from growing
        deltaN -= (monthsFarmed * 1.5);
        deltaP -= (monthsFarmed * 0.5);
        deltaK -= (monthsFarmed * 1.0);

        // Additions from fertilizers
        const fertilizers = (crop.fertilizers || '').toLowerCase();
        
        if (fertilizers.includes('urea') || fertilizers.includes('යූරියා')) {
            deltaN += 20;
        }
        if (fertilizers.includes('compost') || fertilizers.includes('කොම්පෝස්ට්')) {
            deltaN += 5; deltaP += 5; deltaK += 5;
        }
        if (fertilizers.includes('npk')) {
            deltaN += 10; deltaP += 10; deltaK += 10;
        }
    });

    return {
        baseline: { N: baseN, P: baseP, K: baseK },
        historyImpact: { 
            N: parseFloat(deltaN.toFixed(2)), 
            P: parseFloat(deltaP.toFixed(2)), 
            K: parseFloat(deltaK.toFixed(2)) 
        },
        current: {
            N: Math.max(0, parseFloat((baseN + deltaN).toFixed(2))),
            P: Math.max(0, parseFloat((baseP + deltaP).toFixed(2))),
            K: Math.max(0, parseFloat((baseK + deltaK).toFixed(2)))
        }
    };
};