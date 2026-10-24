import pytest

from app.security import validate_local_model_url


def test_model_url_must_be_localhost():
    assert validate_local_model_url("http://127.0.0.1:11434/") == "http://127.0.0.1:11434"
    with pytest.raises(ValueError, match="must be on localhost"):
        validate_local_model_url("https://model-provider.example/api")
