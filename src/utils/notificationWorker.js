// backend/src/utils/notificationWorker.js
const cron = require('node-cron');
const CropTracking = require('../models/CropTracking');

// This job runs every hour to check for upcoming deadlines
cron.schedule('0 * * * *', async () => {
  console.log("Checking for crop step deadlines...");
  const now = new Date();

  try {
    // Find all active trackings
    const activeTrackings = await CropTracking.find({ status: 'Active' });

    for (let track of activeTrackings) {
      const currentStep = track.steps[track.currentStepIndex];
      
      if (!currentStep.isCompleted && !currentStep.notified) {
        const timeRemainingMs = currentStep.endTime.getTime() - now.getTime();
        const hoursRemaining = timeRemainingMs / (1000 * 60 * 60);

        // Logic 1: 24 Hours before Fertilizer/Pesticide
        if (currentStep.stage.toLowerCase().includes('fertilizer') && hoursRemaining <= 24 && hoursRemaining > 23) {
           console.log(`🚨 ALERT: User ${track.userId}, apply fertilizer for ${track.cropName} tomorrow! Type: ${currentStep.alert}`);
           currentStep.notified = true;
           // TODO: Trigger Email, SMS, or Push Notification here
        }

        // Logic 2: 4 Hours before Irrigation
        if (currentStep.stage.toLowerCase().includes('irrigation') && hoursRemaining <= 4 && hoursRemaining > 3) {
           console.log(`💧 ALERT: User ${track.userId}, water your ${track.cropName} in 4 hours!`);
           currentStep.notified = true;
           // TODO: Trigger Email, SMS, or Push Notification here
        }

        await track.save();
      }
    }
  } catch (error) {
    console.error("Cron Job Error:", error);
  }
});