from fastapi.testclient import TestClient

from app.main import API_TOKEN, app


def test_redaction_end_to_end_and_authentication():
    with TestClient(app) as client:
        unauthorized = client.post("/redact/start", json={"filename": "demo.md", "content": "alice@example.test"})
        assert unauthorized.status_code == 401
        headers = {"X-Bharosa-Token": API_TOKEN}
        started = client.post("/redact/start", headers=headers, json={
            "filename": "synthetic.md",
            "content": "Contact alice@example.test; test card 4111111111111111; INR 200.00 on 2026-10-25.",
        })
        assert started.status_code == 200
        data = started.json()
        assert data["session_id"]
        assert data["findings"]
        # A caller cannot export the original document before submitting review decisions.
        blocked_export = client.post("/redact/export", headers=headers, json={
            "session_id": data["session_id"], "format": "md",
        })
        assert blocked_export.status_code == 409
        premature_verify = client.post("/redact/verify", headers=headers, json={"session_id": data["session_id"]})
        assert premature_verify.json()["status"] == "fail"
        decisions = {item["id"]: True for item in data["findings"]}
        updated = client.post("/redact/update", headers=headers, json={
            "session_id": data["session_id"], "decisions": decisions,
        })
        assert updated.status_code == 200
        assert "alice@example.test" not in updated.json()["redacted_preview"]
        verified = client.post("/redact/verify", headers=headers, json={"session_id": data["session_id"]})
        assert verified.status_code == 200
        assert verified.json()["status"] == "pass"
