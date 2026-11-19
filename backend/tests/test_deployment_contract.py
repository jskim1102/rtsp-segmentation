"""Docker/Compose와 Git 체크아웃 안전성 계약의 정적 회귀 검사."""

from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_backend_entrypoint_is_normalized_and_invoked_safely():
    dockerfile = (PROJECT_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY --chmod=0755 docker-entrypoint.sh /app/docker-entrypoint.sh" in dockerfile
    assert "sed -i 's/\\r$//' /app/docker-entrypoint.sh" in dockerfile
    assert "sed -i '1s/^\\xEF\\xBB\\xBF//' /app/docker-entrypoint.sh" in dockerfile
    assert 'ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]' in dockerfile


def test_entrypoint_source_has_no_bom_or_crlf():
    entrypoint = (PROJECT_ROOT / "backend" / "docker-entrypoint.sh").read_bytes()

    assert not entrypoint.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" not in entrypoint


def test_compose_uses_public_backend_and_builds_frontend_with_client_settings() -> None:
    services = yaml.safe_load((PROJECT_ROOT / "docker-compose.yml").read_text())["services"]
    backend, frontend = services["backend"], services["frontend"]
    assert backend["image"] == "ghcr.io/jskim1102/rtsp-segmentation-backend:latest"
    assert "pull_policy" not in backend
    assert frontend["pull_policy"] == "build"
    assert "http://127.0.0.1:8000/api/health" in backend["healthcheck"]["test"][-1]
    assert "http://127.0.0.1/" in frontend["healthcheck"]["test"]
    assert frontend["depends_on"]["backend"]["condition"] == "service_healthy"


def test_backend_weights_directory_uses_persistent_volume() -> None:
    backend = yaml.safe_load((PROJECT_ROOT / "docker-compose.yml").read_text())["services"]["backend"]
    assert backend["environment"]["YOLO_WEIGHTS_DIR"] == "/app/models"
    assert "yolo_weights:/app/models" in backend["volumes"]


def test_only_gpu_overlay_reserves_devices() -> None:
    base = yaml.safe_load((PROJECT_ROOT / "docker-compose.yml").read_text())
    overlay = yaml.safe_load((PROJECT_ROOT / "docker-compose.gpu.yml").read_text())
    assert "deploy" not in base["services"]["backend"]
    resources = overlay["services"]["backend"]["deploy"]["resources"]
    assert resources["reservations"]["devices"][0]["capabilities"] == ["gpu"]


def test_git_attributes_keep_shell_scripts_on_lf():
    attributes = (PROJECT_ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines()

    assert "* text=auto eol=lf" in attributes
    assert "*.sh text eol=lf" in attributes
    assert "setup.cmd text eol=crlf" in attributes
