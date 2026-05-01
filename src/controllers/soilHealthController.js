const SoilHealthRecord = require('../models/SoilHealthRecord');
const SoilHealthRequest = require('../models/SoilHealthRequest');
const {
  createImageOnlyAssessment,
  createFusionAssessment
} = require('../utils/soilHealthScorer');

function ensureOwner(req, ownerId) {
  return String(req.user.id) === String(ownerId);
}

exports.runQuickImageAssessment = async (req, res) => {
  try {
    const { district, location, cropType, season, landSize, imageMetrics, language } = req.body;

    if (!district || !imageMetrics) {
      return res.status(400).json({ success: false, message: 'District and image metrics are required.' });
    }

    const result = createImageOnlyAssessment(imageMetrics, { district, cropType, season, language });

    const record = await SoilHealthRecord.create({
      farmer: req.user.id,
      mode: 'image_only',
      district,
      location,
      cropType,
      season,
      language,
      landSize,
      imageMetrics,
      result
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createSensorRequest = async (req, res) => {
  try {
    const { district, location, cropType, season, landSize, preferredDate, farmerNotes, imageMetrics, language } = req.body;

    if (!district || !imageMetrics) {
      return res.status(400).json({ success: false, message: 'District and image metrics are required.' });
    }

    const imageAssessment = createImageOnlyAssessment(imageMetrics, { district, cropType, season, language });

    const request = await SoilHealthRequest.create({
      farmer: req.user.id,
      district,
      location,
      cropType,
      season,
      language,
      landSize,
      preferredDate,
      farmerNotes,
      imageMetrics,
      imageAssessment: {
        score: imageAssessment.score,
        classification: imageAssessment.classification,
        confidence: imageAssessment.confidence,
        soilType: imageAssessment.soilType
      }
    });

    res.status(201).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyHistory = async (req, res) => {
  try {
    const records = await SoilHealthRecord.find({ farmer: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const requests = await SoilHealthRequest.find({ farmer: req.user.id })
      .populate('assignedAdmin', 'name email phoneNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminRequests = async (req, res) => {
  try {
    const requests = await SoilHealthRequest.find({})
      .populate('farmer', 'name email phoneNumber')
      .populate('assignedAdmin', 'name email phoneNumber')
      .populate('finalRecord')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveRequest = async (req, res) => {
  try {
    const { scheduledDate, adminNotes } = req.body;
    const request = await SoilHealthRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.status = 'approved';
    request.scheduledDate = scheduledDate;
    request.adminNotes = adminNotes || request.adminNotes;
    request.assignedAdmin = req.user.id;
    await request.save();

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const { adminNotes } = req.body;
    const request = await SoilHealthRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.status = 'rejected';
    request.adminNotes = adminNotes || request.adminNotes;
    request.assignedAdmin = req.user.id;
    await request.save();

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.completeRequest = async (req, res) => {
  try {
    const request = await SoilHealthRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const { sensorReadings, adminNotes } = req.body;
    if (!sensorReadings) {
      return res.status(400).json({ success: false, message: 'Sensor readings are required to complete the request.' });
    }

    const result = createFusionAssessment(sensorReadings, request.imageMetrics, {
      district: request.district,
      cropType: request.cropType,
      season: request.season,
      language: request.language
    });

    const record = await SoilHealthRecord.create({
      farmer: request.farmer,
      request: request._id,
      mode: 'full_fusion',
      district: request.district,
      location: request.location,
      cropType: request.cropType,
      season: request.season,
      language: request.language,
      landSize: request.landSize,
      imageMetrics: request.imageMetrics,
      sensorReadings,
      result
    });

    request.status = 'completed';
    request.assignedAdmin = req.user.id;
    request.adminNotes = adminNotes || request.adminNotes;
    request.sensorReadings = sensorReadings;
    request.finalRecord = record._id;
    await request.save();

    res.status(200).json({ success: true, data: { request, record } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRecordById = async (req, res) => {
  try {
    const record = await SoilHealthRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    if (!ensureOwner(req, record.farmer)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this record.' });
    }

    res.status(200).json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteRecordById = async (req, res) => {
  try {
    const record = await SoilHealthRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }

    if (!ensureOwner(req, record.farmer)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this record.' });
    }

    if (record.request) {
      await SoilHealthRequest.findByIdAndUpdate(record.request, { $unset: { finalRecord: 1 } });
    }

    await record.deleteOne();

    res.status(200).json({ success: true, message: 'Assessment history item deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.clearMyHistory = async (req, res) => {
  try {
    const records = await SoilHealthRecord.find({ farmer: req.user.id }).select('_id request');

    if (records.length === 0) {
      return res.status(200).json({ success: true, message: 'No assessment history to clear.' });
    }

    const requestIds = records.map((record) => record.request).filter(Boolean);
    if (requestIds.length > 0) {
      await SoilHealthRequest.updateMany(
        { _id: { $in: requestIds } },
        { $unset: { finalRecord: 1 } }
      );
    }

    await SoilHealthRecord.deleteMany({ farmer: req.user.id });

    res.status(200).json({ success: true, message: 'Assessment history cleared.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
