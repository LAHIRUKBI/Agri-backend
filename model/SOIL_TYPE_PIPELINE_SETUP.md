# Soil Type + Nutrient Pipeline Setup

This soil-health quick image flow now supports two layers:

1. `Roboflow classification` for soil type
2. `CSV-backed nutrient estimation` for pH, N, P, K, moisture, and organic matter

## Files Used

- `D:\agro new one\Agri-backend\model\train_soil_type_nutrient_estimator.py`
- `D:\agro new one\Agri-backend\model\data\soil_type_nutrient_profiles_cleaned.csv`

## Roboflow Config

Add these values to your backend `.env` file if you want the hosted Roboflow model to classify real photos:

```env
ROBOFLOW_API_KEY=your_private_api_key
ROBOFLOW_MODEL_ID=my-first-project-glvql/1
```

Notes:

- `ROBOFLOW_MODEL_ID` should be `dataset-slug/version-number`
- for your current project, that is `my-first-project-glvql/1`
- if these env vars are missing, the backend falls back to the local soil-type heuristic

## Current Behavior

When a farmer uploads a photo:

1. Frontend extracts image metrics and sends them to backend
2. Frontend also sends the image as base64
3. Python backend checks whether the photo looks like soil
4. If Roboflow env vars are set, the photo is sent to Roboflow classification API
5. Predicted soil type is combined with:
   - district
   - season
   - crop type
6. Backend estimates:
   - pH
   - nitrogen
   - phosphorus
   - potassium
   - moisture
   - organic matter
7. Node backend converts readings into:
   - soil health score
   - classification
   - recommendations

## CSV Dataset

Runtime dataset:

- `D:\agro new one\Agri-backend\model\data\soil_type_nutrient_profiles_cleaned.csv`

It contains the cleaned rows for:

- `Reddish Brown Earth`
- `Red Yellow Podzolic`
- `Alluvial`
- `Regosol`

## Optional Training

If `pandas` and `scikit-learn` are installed in your Python environment, you can train a `.pkl` model from the cleaned CSV:

```powershell
python "D:\agro new one\Agri-backend\model\train_soil_type_nutrient_estimator.py"
```

This saves:

- `D:\agro new one\Agri-backend\model\saved_models\soil_type_nutrient_estimator.pkl`

If the `.pkl` model is not available, the backend will still work by using the cleaned CSV directly as a fallback estimator.
