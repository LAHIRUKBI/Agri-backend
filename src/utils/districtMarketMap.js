// Authoritative farmer administrative district -> candidate market mapping.
// Market/town names must not be added as farmer-district aliases here.
const districtMarketMap = Object.freeze({
  colombo: ["meegoda", "kandy"],
  gampaha: ["meegoda", "kandy"],
  kalutara: ["meegoda", "kandy"],

  kandy: ["kandy", "dambulla"],
  matale: ["dambulla", "kandy"],
  "nuwara eliya": ["nuwaraeliya", "kandy"],

  galle: ["meegoda", "kandy"],
  matara: ["meegoda", "kandy"],

  kurunegala: ["kandy", "dambulla"],
  puttalam: ["puttalam", "kandy"],

  badulla: ["nuwaraeliya", "bandarawela"],
  kegalle: ["kandy", "meegoda"],
  ratnapura: ["meegoda", "kandy"],
});

module.exports = districtMarketMap;
