// backend/src/utils/cronJobs.js
const cron = require('node-cron');
const { GoogleGenAI } = require('@google/genai');
const RotationRule = require('../models/RotationRule');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const fetchNewRotationRules = async () => {
  console.log("Running scheduled job: Fetching new crop rotation rules via Gemini...");
  try {
    const prompt = `
      Search your agricultural knowledge base for 3 proven crop rotation rules suitable for tropical climates.
      Respond strictly with a JSON array where each object has:
      1. "ruleName": Name of the rotation pattern.
      2. "description": Why it works.
      3. "sequence": An array of crop types (e.g. ["Legumes", "Leafy Greens"]).
      4. "source": The name of a reliable agricultural institution or source this is derived from.
      Only output the raw JSON array.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const rawText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const rules = JSON.parse(rawText);

    for (let rule of rules) {
      await RotationRule.create({
        ruleName: rule.ruleName,
        description: rule.description,
        sequence: rule.sequence,
        source: rule.source,
        status: 'pending'
      });
    }
    console.log("Successfully fetched and stored new pending rotation rules.");
  } catch (error) {
    console.error("Cron Job Error fetching rules:", error);
  }
};

// Schedule to run every 2 hours
const startCronJobs = () => {
  cron.schedule('0 */2 * * *', fetchNewRotationRules);
};

module.exports = startCronJobs;