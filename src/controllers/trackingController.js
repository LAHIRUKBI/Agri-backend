// backend/src/controllers/trackingController.js
const CropTracking = require('../models/CropTracking');

exports.startCropTracking = async (req, res) => {
  try {
    const { userId, cropName, district, steps } = req.body;

    let currentTime = new Date();
    const trackingSteps = steps.map((step, index) => {
      // Calculate end time by adding estimatedDays to current time
      const endTime = new Date(currentTime);
      endTime.setDate(endTime.getDate() + (step.Estimated_Days || step.estimatedDays));

      const trackingStep = {
        stage: step.Stage || step.stage,
        instructions: step.Instructions || step.instructions,
        alert: step.Alert || step.alert,
        estimatedDays: step.Estimated_Days || step.estimatedDays,
        startTime: new Date(currentTime),
        endTime: new Date(endTime),
        isCompleted: false,
        notified: false
      };

      // The next step's start time is this step's end time
      currentTime = new Date(endTime); 
      return trackingStep;
    });

    const newTracking = new CropTracking({
      userId,
      cropName,
      district,
      steps: trackingSteps
    });

    await newTracking.save();
    res.status(201).json({ success: true, message: "Tracking started successfully!", data: newTracking });

  } catch (error) {
    console.error("Tracking Error:", error);
    res.status(500).json({ success: false, message: "Failed to start tracking." });
  }
};

// Endpoint to mark a step as completed
exports.completeStep = async (req, res) => {
  try {
    const { trackingId, stepIndex } = req.body;
    
    const tracking = await CropTracking.findById(trackingId);
    if (!tracking) return res.status(404).json({ success: false, message: "Tracking not found." });

    tracking.steps[stepIndex].isCompleted = true;
    
    // Move to next step if there is one
    if (stepIndex + 1 < tracking.steps.length) {
      tracking.currentStepIndex = stepIndex + 1;
    } else {
      tracking.status = 'Completed';
    }

    await tracking.save();
    res.status(200).json({ success: true, tracking });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update step." });
  }
};