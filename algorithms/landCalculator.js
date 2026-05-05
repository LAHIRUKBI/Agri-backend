// backend/algorithms/landCalculator.js

const SQ_FT_PER_ACRE = 43560;

/**
 * අක්කර ගණන වර්ග අඩි බවට පරිවර්තනය කරයි.
 */
exports.acresToSqFt = (acres) => {
    return acres * SQ_FT_PER_ACRE;
};

/**
 * යොදන ලද සම්පූර්ණ පොහොර ප්‍රමාණය භූමියේ වර්ග අඩි ගණනින් බෙදා, 
 * වර්ග අඩියකට කොපමණ ප්‍රමාණයක් එකතු වූවාදැයි ගණනය කරයි.
 */
exports.calculatePerSqFtAddition = (totalAmountGrams, acres) => {
    const sqFt = this.acresToSqFt(acres);
    return totalAmountGrams / sqFt;
};