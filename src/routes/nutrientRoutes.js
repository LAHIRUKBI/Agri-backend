// backend/src/routes/nutrientRoutes.js
const express = require('express');
const router = express.Router();
const { getSoilConfig, updateSoilConfig, deleteNutrient } = require('../controllers/nutrientController');


router.get('/', getSoilConfig);
router.put('/', updateSoilConfig);
router.delete('/:nutrientId', deleteNutrient);

module.exports = router;