// AI Radar 레이아웃 계측 — 브라우저 콘솔(또는 자동화 도구의 page.evaluate)에 붙여 넣어 실행한다.
// 화면 밖으로 밀려난 요소(boundingBox.x < 0 또는 오른쪽 끝 > 뷰포트)와 페이지 가로 넘침을 센다.
// 의도된 가로 스크롤 영역(카테고리 칩 줄 등 overflow-x: auto/scroll) 안의 요소는 제외한다.
(() => {
  const vw = document.documentElement.clientWidth;
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth) return true;
    }
    return false;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const offenders = [...document.querySelectorAll("body *")]
    .filter((el) => visible(el) && !inScroller(el))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.left < -0.5 || r.right > vw + 0.5)
    .map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 30),
      left: Math.round(r.left),
      right: Math.round(r.right),
    }));
  return {
    viewport: vw,
    pageScrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth - vw,
    offscreenCount: offenders.length,
    offenders: offenders.slice(0, 10),
  };
})();
