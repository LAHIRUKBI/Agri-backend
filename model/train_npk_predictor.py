# backend/model/train_npk_predictor.py
import os
import pandas as pd
import numpy as np
import pickle
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

# ---------- Configuration ----------
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")
AGRO_CSV = os.path.join(DATA_DIR, "Agrochemical_compounds.csv")
os.makedirs(MODEL_DIR, exist_ok=True)

# ---------- Load agrochemical composition and clean duplicates ----------
if not os.path.exists(AGRO_CSV):
    raise FileNotFoundError(f"Agrochemical CSV not found at {AGRO_CSV}")

agro_df = pd.read_csv(AGRO_CSV)
print("Original columns:", agro_df.columns.tolist())

# Rename columns (case-insensitive search)
n_col = next((c for c in agro_df.columns if 'nitrogen' in c.lower()), None)
p_col = next((c for c in agro_df.columns if 'phosphorus' in c.lower()), None)
k_col = next((c for c in agro_df.columns if 'potassium' in c.lower()), None)
if not (n_col and p_col and k_col):
    raise ValueError(f"Could not find N,P,K columns. Available: {agro_df.columns.tolist()}")

agro_df.rename(columns={n_col: 'N', p_col: 'P', k_col: 'K'}, inplace=True)

# Find Product_Name column
name_col = next((c for c in agro_df.columns if 'product' in c.lower() and 'name' in c.lower()), None)
if not name_col:
    # If not found, use first column as product name
    name_col = agro_df.columns[0]
    print(f"Using '{name_col}' as product name column.")

# Remove duplicate product names (keep first occurrence)
agro_df = agro_df.drop_duplicates(subset=[name_col], keep='first')
agro_df.set_index(name_col, inplace=True)

# Ensure N,P,K are numeric
agro_df['N'] = pd.to_numeric(agro_df['N'], errors='coerce')
agro_df['P'] = pd.to_numeric(agro_df['P'], errors='coerce')
agro_df['K'] = pd.to_numeric(agro_df['K'], errors='coerce')
agro_df = agro_df.dropna(subset=['N', 'P', 'K'])

print(f"Loaded {len(agro_df)} unique agrochemicals.")
print(agro_df.head())

# ---------- Training data generation parameters ----------
LAND_SIZES = [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100]
AMOUNTS_G = [100, 200, 500, 1000, 2000, 5000, 10000]
MONTHS_RANGE = range(1, 13)
CROP_NAMES = ['Rice', 'Maize', 'Tomato', 'Potato', 'Cabbage', 'Carrot']
DEPLETION = {'N': 1.2, 'P': 0.4, 'K': 0.8}

def generate_random_history(max_crops=4):
    n_crops = np.random.randint(1, max_crops+1)
    history = []
    for _ in range(n_crops):
        crop = {
            'cropName': np.random.choice(CROP_NAMES),
            'landSize': np.random.choice(LAND_SIZES),
            'duration': np.random.choice(MONTHS_RANGE),
            'fertilizers': [],
            'pesticides': []
        }
        n_chems = np.random.randint(0, 4)
        all_chems = list(agro_df.index)
        if n_chems > 0 and len(all_chems) > 0:
            chosen = np.random.choice(all_chems, size=min(n_chems, len(all_chems)), replace=False)
            for chem in chosen:
                amount = np.random.choice(AMOUNTS_G)
                crop['fertilizers'].append({'name': chem, 'amount_g': amount})
        history.append(crop)
    return history

def true_current_npk(baseline, history):
    n, p, k = baseline['N'], baseline['P'], baseline['K']
    for crop in history:
        dur = crop['duration']
        land = crop['landSize']
        n -= dur * DEPLETION['N']
        p -= dur * DEPLETION['P']
        k -= dur * DEPLETION['K']
        for chem in crop['fertilizers'] + crop['pesticides']:
            name = chem['name']
            amount_g = chem['amount_g']
            if name in agro_df.index:
                n_per_100g = agro_df.loc[name, 'N']
                p_per_100g = agro_df.loc[name, 'P']
                k_per_100g = agro_df.loc[name, 'K']
                # Ensure scalars
                if isinstance(n_per_100g, pd.Series): n_per_100g = n_per_100g.iloc[0]
                if isinstance(p_per_100g, pd.Series): p_per_100g = p_per_100g.iloc[0]
                if isinstance(k_per_100g, pd.Series): k_per_100g = k_per_100g.iloc[0]
                multiplier = amount_g / 100.0
                n += (n_per_100g * multiplier) / land
                p += (p_per_100g * multiplier) / land
                k += (k_per_100g * multiplier) / land
    return max(0, n), max(0, p), max(0, k)

def extract_features(baseline, history):
    total_n_added = 0.0
    total_p_added = 0.0
    total_k_added = 0.0
    total_months = 0
    for crop in history:
        dur = crop['duration']
        land = crop['landSize']
        total_months += dur
        for chem in crop['fertilizers'] + crop['pesticides']:
            name = chem['name']
            amount_g = chem['amount_g']
            if name in agro_df.index:
                n_val = agro_df.loc[name, 'N']
                p_val = agro_df.loc[name, 'P']
                k_val = agro_df.loc[name, 'K']
                if isinstance(n_val, pd.Series): n_val = n_val.iloc[0]
                if isinstance(p_val, pd.Series): p_val = p_val.iloc[0]
                if isinstance(k_val, pd.Series): k_val = k_val.iloc[0]
                multiplier = amount_g / 100.0
                total_n_added += (n_val * multiplier) / land
                total_p_added += (p_val * multiplier) / land
                total_k_added += (k_val * multiplier) / land
    return [
        baseline['N'], baseline['P'], baseline['K'],
        total_n_added, total_p_added, total_k_added,
        total_months
    ]

# ---------- Generate training data ----------
print("Generating synthetic training data...")
num_samples = 20000
X_list = []
y_list = []

for _ in range(num_samples):
    baseline = {
        'N': np.random.uniform(30, 80),
        'P': np.random.uniform(10, 40),
        'K': np.random.uniform(50, 150)
    }
    history = generate_random_history()
    features = extract_features(baseline, history)
    true_n, true_p, true_k = true_current_npk(baseline, history)
    X_list.append(features)
    y_list.append([true_n, true_p, true_k])

X = np.array(X_list)
y = np.array(y_list)

# Split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Scale
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

# Train model
print("Training Random Forest Regressor...")
model = RandomForestRegressor(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
model.fit(X_train_scaled, y_train)

# Evaluate
y_pred = model.predict(X_test_scaled)
mae_n = mean_absolute_error(y_test[:, 0], y_pred[:, 0])
mae_p = mean_absolute_error(y_test[:, 1], y_pred[:, 1])
mae_k = mean_absolute_error(y_test[:, 2], y_pred[:, 2])
print(f"Test MAE - N: {mae_n:.2f} ppm, P: {mae_p:.2f} ppm, K: {mae_k:.2f} ppm")

# Save
with open(os.path.join(MODEL_DIR, "npk_predictor_model.pkl"), "wb") as f:
    pickle.dump(model, f)
with open(os.path.join(MODEL_DIR, "npk_predictor_scaler.pkl"), "wb") as f:
    pickle.dump(scaler, f)

print("✅ NPK predictor model saved successfully.")

# Save chemical composition dictionary for inference (no CSV needed later)
chem_composition = {}
for chem in agro_df.index:
    chem_composition[chem] = {
        'N': float(agro_df.loc[chem, 'N']),
        'P': float(agro_df.loc[chem, 'P']),
        'K': float(agro_df.loc[chem, 'K'])
    }
with open(os.path.join(MODEL_DIR, "chemical_composition.pkl"), "wb") as f:
    pickle.dump(chem_composition, f)
print("✅ Chemical composition dictionary saved.")