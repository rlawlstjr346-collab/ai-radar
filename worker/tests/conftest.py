import os

# 단위 테스트는 네트워크 없이: 스냅샷 정제 단계의 og:image 원격 조회를 끈다
os.environ.setdefault("SNAPSHOT_FETCH_IMAGES", "0")
os.environ.setdefault("SNAPSHOT_USE_GEMINI", "0")
