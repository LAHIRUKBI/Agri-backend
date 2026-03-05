// backend/src/utils/algorithms.js

/**
 * Suggest suitable crops based on previously grown crops.
 * @param {string[]} previousCrops - Array of crop names grown before.
 * @param {Array} allCrops - Array of crop rule objects from DB.
 * @returns {Array} - Array of suggested crops with reasons.
 */
exports.suggestCrops = (previousCrops, allCrops) => {
  const suggestions = [];

  // Simple AI: For each candidate crop, evaluate compatibility
  allCrops.forEach(crop => {
    const reasons = [];
    let compatible = true;

    // Check incompatibility
    const incompatible = previousCrops.some(prev =>
      crop.incompatiblePredecessors.includes(prev)
    );
    if (incompatible) {
      compatible = false;
      reasons.push(`Incompatible with one of the previous crops.`);
    } else {
      // Check compatibility
      previousCrops.forEach(prev => {
        if (crop.compatiblePredecessors.includes(prev)) {
          reasons.push(`Compatible with ${prev}.`);
        }
      });

      // Nutrient balancing (simplified)
      if (previousCrops.some(p => {
        const prevCrop = allCrops.find(c => c.name === p);
        return prevCrop && prevCrop.isNitrogenFixer;
      })) {
        reasons.push(`Previous nitrogen-fixing crop enriches soil – good for nitrogen-demanding crops like ${crop.name}.`);
      }

      // Pest cycle reasoning
      const pestOverlap = previousCrops.some(prev => {
        const prevCrop = allCrops.find(c => c.name === prev);
        return prevCrop && prevCrop.commonPests.some(pest => crop.commonPests.includes(pest));
      });
      if (!pestOverlap) {
        reasons.push(`No shared pests with previous crops – reduces pest pressure.`);
      } else {
        // If there is overlap, it's not ideal but we can still note it
        reasons.push(`May share pests with previous crops – consider pest management.`);
      }
    }

    if (compatible && reasons.length > 0) {
      suggestions.push({
        cropName: crop.name,
        reasons: reasons.slice(0, 3) // limit to top 3 reasons
      });
    }
  });

  // Sort by number of positive reasons (simple ranking)
  suggestions.sort((a, b) => b.reasons.length - a.reasons.length);
  return suggestions;
};