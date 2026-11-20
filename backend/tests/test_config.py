"""config.py 빈 env 안전 기본값 — 빈 문자열(set-but-empty)=미설정으로 폴백 (codex #3).

버그: 빈 문자열을 진짜값으로 취급해 MAX_IPCAMS="" → int("") → ValueError(import 크래시),
CORS_ORIGINS="" → main.py 에서 [""] (기본 * 아님 → 프론트 CORS 차단). 고침: 빈값=미설정.
config 는 import 시점에 env 를 읽으므로, env 를 세팅하고 importlib.reload 로 재평가해 검증한다.
"""

import importlib
from pathlib import Path

import pytest

from app.inference.models_dir import resolve_model_path


@pytest.fixture(autouse=True)
def _restore_config():
    """각 테스트 후 config 를 실제 env 로 재로드 — reload 로 오염된 모듈 전역을 원복(타 테스트 격리)."""
    yield
    import app.config
    importlib.reload(app.config)


def _reload_config(monkeypatch, **env):
    import app.config

    for key, val in env.items():
        monkeypatch.setenv(key, val)
    # load_dotenv(override=False) 라 monkeypatch 로 먼저 세팅한 env 가 .env 보다 우선한다.
    return importlib.reload(app.config)


def test_empty_max_ipcams_falls_back_to_16(monkeypatch):
    config = _reload_config(monkeypatch, MAX_IPCAMS="")
    assert config.MAX_IPCAMS == 16


def test_empty_cors_origins_falls_back_to_star(monkeypatch):
    config = _reload_config(monkeypatch, CORS_ORIGINS="")
    assert config.CORS_ORIGINS == "*"


def test_both_empty_imports_without_crash(monkeypatch):
    """둘 다 빈값이어도 import(=reload) 가 ValueError 없이 통과 + 안전기본 적용."""
    config = _reload_config(monkeypatch, MAX_IPCAMS="", CORS_ORIGINS="")
    assert config.MAX_IPCAMS == 16
    assert config.CORS_ORIGINS == "*"


def test_set_values_are_respected(monkeypatch):
    """빈값이 아니면 실제 값을 쓴다(폴백이 정상값을 덮지 않는다)."""
    config = _reload_config(monkeypatch, MAX_IPCAMS="32", CORS_ORIGINS="http://example.com:5182")
    assert config.MAX_IPCAMS == 32
    assert config.CORS_ORIGINS == "http://example.com:5182"


@pytest.mark.parametrize("directory", ["", "weights/segmentation"])
def test_weights_directory_is_relative_to_backend(monkeypatch, tmp_path, directory):
    monkeypatch.chdir(tmp_path)
    _reload_config(monkeypatch, YOLO_WEIGHTS_DIR=directory)
    name = "yolo26n-seg.pt"
    expected = Path(__file__).resolve().parents[1] / (directory or "models") / name
    assert Path(resolve_model_path(name)) == expected


def test_absolute_weights_directory_is_used_as_configured(monkeypatch, tmp_path):
    _reload_config(monkeypatch, YOLO_WEIGHTS_DIR=str(tmp_path))
    name = "yolo26x-seg.pt"
    assert Path(resolve_model_path(name)) == tmp_path / name


@pytest.mark.parametrize("name", ["custom.pt", "../yolo26n-seg.pt", "/tmp/yolo26n-seg.pt"])
def test_weights_directory_only_accepts_preset_names(name):
    with pytest.raises(ValueError):
        resolve_model_path(name)


def test_yolo_default_model_outside_presets_falls_back(monkeypatch):
    """목록 밖 · 빈 YOLO_DEFAULT_MODEL 은 기본 모델로 — 그대로 쓰면 기본 lane 이 로드 실패로 추론이 조용히 멈춘다."""
    assert _reload_config(monkeypatch, YOLO_DEFAULT_MODEL="nope.pt").YOLO_DEFAULT_MODEL == "yolo26n-seg.pt"
    assert _reload_config(monkeypatch, YOLO_DEFAULT_MODEL="").YOLO_DEFAULT_MODEL == "yolo26n-seg.pt"
    assert _reload_config(monkeypatch, YOLO_DEFAULT_MODEL="yolo26x-seg.pt").YOLO_DEFAULT_MODEL == "yolo26x-seg.pt"
