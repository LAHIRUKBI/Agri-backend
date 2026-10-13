
const { calculateGapAndSuitability } = require("./nutrientCalculator");

const testSoil = {
  current_n: 75,
  current_p: 60,
  current_k: 250,
};

const tomatoRequirements = {
  Min_Nitrogen_ppm: 50,
  Max_Nitrogen_ppm: 100,
  Min_Phosphorus_ppm: 40,
  Max_Phosphorus_ppm: 80,
  Min_Potassium_ppm: 200,
  Max_Potassium_ppm: 300,
};

const result = calculateGapAndSuitability(
  testSoil,
  tomatoRequirements
);

console.log("Tomato Suitability Test:");
console.log(JSON.stringify(result, null, 2));
console.log(
  "Target Crop Suitability:",
  result.isSuitable ? "RECOMMENDED" : "NOT RECOMMENDED"
);
