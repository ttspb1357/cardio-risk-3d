"""API tests. Run from the repo root: python -m pytest tests"""
import pytest
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)
TARGETS = ["cad", "LAD", "LCX", "RCA"]


@pytest.fixture(scope="module")
def sample_result():
    sample = client.get("/samples").json()[0]
    r = client.post("/predict", json=sample["values"])
    assert r.status_code == 200
    return r.json()


def test_predict_shape(sample_result):
    body = sample_result
    assert set(body["vessels"]) == {"LAD", "LCX", "RCA"}
    assert 0 <= body["cad"]["probability"] <= 1
    assert body["cad"]["label"] in ("CAD", "Normal")
    assert all(0 <= v["probability"] <= 1 for v in body["vessels"].values())
    assert "not a substitute" in body["disclaimer"].lower()
    assert body["imputed_features"] == []


def test_explanations_add_up_exactly(sample_result):
    """Average-patient risk + all contributions must equal the displayed probability."""
    body = sample_result
    for t in TARGETS:
        p = body["cad"] if t == "cad" else body["vessels"][t]
        total = p["baseline"] + sum(r["contribution"] for r in body["explanations"][t])
        assert total == pytest.approx(p["probability"], abs=1e-3)


def test_explanations_use_original_feature_names(sample_result):
    names = {r["feature"] for r in sample_result["explanations"]["cad"]}
    assert "BBB" in names and not any(n.startswith("BBB_") for n in names)
    assert not names & {"LAD", "LCX", "RCA", "Cath"}


def test_partial_patient_is_imputed():
    r = client.post("/predict", json={"Age": 70, "Sex": "Male"})
    assert r.status_code == 200
    assert len(r.json()["imputed_features"]) > 40


def test_target_columns_rejected_as_inputs():
    for leaky in ("LAD", "LCX", "RCA", "Cath"):
        assert client.post("/predict", json={leaky: "Stenotic"}).status_code == 422


@pytest.mark.parametrize("bad", [{"Sex": "Other"}, {"Age": "abc"}, {"Age": -5}, {"DM": 7}, {"Obesity": "maybe"}])
def test_invalid_values_rejected(bad):
    assert client.post("/predict", json=bad).status_code == 422


def test_metrics_include_nested_cv():
    m = client.get("/metrics").json()
    for t in TARGETS:
        nested = m["targets"][t]["nested"]
        assert nested is not None
        auc = nested["pooled"]["roc_auc"]
        assert auc["lo"] <= auc["value"] <= auc["hi"]


def test_features_schema_has_display_metadata():
    schema = client.get("/features").json()
    assert schema["key_inputs"]
    assert all(f["label"] and f["group"] in schema["groups"] for f in schema["features"])
