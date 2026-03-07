const fs = require('fs');
const path = require('path');

const saveNutrientsToCSV = (config) => {
  // Define where the dataset will be saved
  const dirPath = path.join(__dirname, '../../datasets');
  const filePath = path.join(dirPath, 'soil_nutrients.csv');

  // Ensure the datasets directory exists, create it if it doesn't
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  // 1. Create the CSV header row
  const header = 'Name,Symbol,Type,Min_ppm,Max_ppm,Unit\n';

  // 2. Map the nutrient array to CSV rows
  const rows = config.nutrients.map(nut => {
    return `${nut.name},${nut.symbol},${nut.type},${nut.min},${nut.max},${nut.unit}`;
  }).join('\n');

  // 3. Optional: Add pH levels as a system note at the bottom or top
  const phData = `\nTarget_pH_Min,${config.phMin},Target_pH_Max,${config.phMax}\n`;

  // 4. Write the file to the server's hard drive
  fs.writeFileSync(filePath, header + rows + phData);
  console.log(`Dataset successfully updated at: ${filePath}`);
};

module.exports = { saveNutrientsToCSV };