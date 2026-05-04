Soil Image Model

Files:
- `train_soil_image_assessor.py`: trains the quick image model
- `data/soil_image_labels_template.csv`: sample dataset format
- `saved_models/soil_image_assessor.pkl`: trained model output

What this model learns:
- Input: image-derived metrics + district + season
- Output: estimated `ph`, `nitrogen`, `phosphorus`, `potassium`, `moisture`, `organicMatter`

Dataset you need:
1. Soil photo path
2. District
3. Season
4. Crop type
5. Ground-truth values for `ph`, `nitrogen`, `phosphorus`, `potassium`, `moisture`, `organicMatter`

How to train:
1. Copy `data/soil_image_labels_template.csv` to `data/soil_image_labels.csv`
2. Replace sample rows with your real labelled data
3. Put the soil images in the referenced paths
4. Run:
   `python train_soil_image_assessor.py`
5. The trained model will be saved in `saved_models/soil_image_assessor.pkl`

How inference works:
1. Frontend extracts image metrics from the uploaded soil image
2. Node backend sends those metrics to Python endpoint `/soil_image_assess`
3. Python model predicts the readings
4. Node backend converts those readings to score/classification/recommendations

Fallback behavior:
- If `soil_image_assessor.pkl` is missing, quick image check falls back to the current heuristic rules.
