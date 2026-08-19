const SoilHealthRecord = require('../models/SoilHealthRecord');
const SoilHealthRequest = require('../models/SoilHealthRequest');
const User = require('../models/User');
const {
  createImageOnlyAssessment,
  createAssessmentFromReadings,
  createFusionAssessment
} = require('../utils/soilHealthScorer');

function ensureOwner(req, ownerId) {
  return String(req.user.id) === String(ownerId);
}

function mapImageAssessment(result) {
  return {
    score: result.score,
    classification: result.classification,
    confidence: result.confidence,
    soilType: result.soilType
  };
}

function buildProfileAddress(user) {
  if (!user) return '';

  return [
    user.address,
    user.addressLine2,
    user.city,
    user.state,
    user.country,
    user.zipCode
  ]
    .filter(Boolean)
    .join(', ')
    .trim();
}

async function resolveVisitAddress(userId, providedAddress) {
  const farmer = await User.findById(userId).select('address addressLine2 city state country zipCode');
  const profileAddress = buildProfileAddress(farmer);
  const manualAddress = String(providedAddress || '').trim();

  if (manualAddress) {
    return { visitAddress: manualAddress, addressSource: 'manual' };
  }

  if (profileAddress) {
    return { visitAddress: profileAddress, addressSource: 'profile' };
  }

  return null;
}

async function deleteRequestWithLinkedRecord(requestId) {
  const request = await SoilHealthRequest.findById(requestId);
  if (!request) {
    return false;
  }

  if (request.finalRecord) {
    await SoilHealthRecord.findByIdAndDelete(request.finalRecord);
  }

  await request.deleteOne();
  return true;
}

async function generateQuickImageAssessment(imageMetrics, metadata) {
  try {
    const response = await fetch('http://localhost:8000/soil_image_assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        district: metadata.district,
        season: metadata.season,
        cropType: metadata.cropType,
        language: metadata.language,
        imageMetrics
      })
    });

    if (!response.ok) {
      throw new Error('Python soil-image model endpoint is unavailable.');
    }

    const payload = await response.json();
    if (!payload.success || !payload.predictedReadings) {
      throw new Error(payload.message || 'Python soil-image model did not return predictions.');
    }

    return createAssessmentFromReadings(payload.predictedReadings, { ...metadata, imageMetrics }, 'image_only');
  } catch (error) {
    return createImageOnlyAssessment(imageMetrics, metadata);
  }
}

exports.runQuickImageAssessment = async (req, res) => {
  try {
    const { district, location, cropType, season, landSize, imageMetrics, language } = req.body;

    if (!district || !imageMetrics) {
      return res.status(400).json({ success: false, message: 'District and image metrics are required.' });
    }

    const result = await generateQuickImageAssessment(imageMetrics, { district, cropType, season, language });

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
    const { district, location, visitAddress, cropType, season, landSize, preferredDate, farmerNotes, imageMetrics, language } = req.body;

    if (!district || !imageMetrics) {
      return res.status(400).json({ success: false, message: 'District and image metrics are required.' });
    }

    const resolvedAddress = await resolveVisitAddress(req.user.id, visitAddress);
    if (!resolvedAddress) {
      return res.status(400).json({
        success: false,
        message: 'A visit address is required. Add it in your profile or enter it when creating the request.'
      });
    }

    const imageAssessment = await generateQuickImageAssessment(imageMetrics, { district, cropType, season, language });

    const request = await SoilHealthRequest.create({
      farmer: req.user.id,
      district,
      location,
      visitAddress: resolvedAddress.visitAddress,
      addressSource: resolvedAddress.addressSource,
      cropType,
      season,
      language,
      landSize,
      preferredDate,
      farmerNotes,
      imageMetrics,
      imageAssessment: mapImageAssessment(imageAssessment)
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

exports.updateMyRequest = async (req, res) => {
  try {
    const request = await SoilHealthRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    if (!ensureOwner(req, request.farmer)) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this request.' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending requests can be edited.' });
    }

    const {
      district,
      location,
      visitAddress,
      cropType,
      season,
      language,
      landSize,
      preferredDate,
      farmerNotes
    } = req.body;

    if (!district) {
      return res.status(400).json({ success: false, message: 'District is required.' });
    }

    request.district = district;
    request.location = location;
    const resolvedAddress = await resolveVisitAddress(req.user.id, visitAddress);
    if (!resolvedAddress) {
      return res.status(400).json({
        success: false,
        message: 'A visit address is required. Add it in your profile or enter it when updating the request.'
      });
    }

    request.visitAddress = resolvedAddress.visitAddress;
    request.addressSource = resolvedAddress.addressSource;
    request.cropType = cropType;
    request.season = season;
    request.language = language || request.language;
    request.landSize = landSize;
    request.preferredDate = preferredDate || undefined;
    request.farmerNotes = farmerNotes;

    const refreshedImageAssessment = await generateQuickImageAssessment(request.imageMetrics, {
      district,
      cropType,
      season,
      language: request.language
    });
    request.imageAssessment = mapImageAssessment(refreshedImageAssessment);

    await request.save();

    const updatedRequest = await SoilHealthRequest.findById(request._id).populate('assignedAdmin', 'name email phoneNumber');
    res.status(200).json({ success: true, data: updatedRequest, message: 'Request updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMyRequestById = async (req, res) => {
  try {
    const request = await SoilHealthRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    if (!ensureOwner(req, request.farmer)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this request.' });
    }

    await deleteRequestWithLinkedRecord(request._id);

    res.status(200).json({ success: true, message: 'Sensor request deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.clearMyRequests = async (req, res) => {
  try {
    const requests = await SoilHealthRequest.find({ farmer: req.user.id }).select('_id');

    if (requests.length === 0) {
      return res.status(200).json({ success: true, message: 'No sensor requests to clear.' });
    }

    await Promise.all(requests.map((request) => deleteRequestWithLinkedRecord(request._id)));

    res.status(200).json({ success: true, message: 'All sensor requests cleared.' });
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

exports.deleteAdminRequestById = async (req, res) => {
  try {
    const deleted = await deleteRequestWithLinkedRecord(req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    res.status(200).json({ success: true, message: 'Request deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.clearAdminRequests = async (req, res) => {
  try {
    const requests = await SoilHealthRequest.find({}).select('_id');

    if (requests.length === 0) {
      return res.status(200).json({ success: true, message: 'No incoming requests to clear.' });
    }

    await Promise.all(requests.map((request) => deleteRequestWithLinkedRecord(request._id)));

    res.status(200).json({ success: true, message: 'All incoming requests cleared.' });
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
